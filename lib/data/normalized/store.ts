import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import type { DB } from "../mock/seed";
import { LifecycleError } from "@/lib/domain/transitions";
import { deliverySchemaSql, enqueueAlerts } from "@/lib/notify/outbox";
import type { AppNotification } from "@/lib/domain/types";
import { dbFromRecords, putRecord, recordsOf, removeRecord, SPECS, type ChildSpec, type Row, type Spec } from "./spec";
import { Slice } from "./slice";
import { applySqlOnce } from "../schema";
import { Reader } from "./reader";

/**
 * Live-marketplace persistence on normalized tables (0004_live_normalized.sql).
 *
 * Reads ("targeted", the default): nothing is cached in the process. Each request reads
 * only the rows its page needs into its own slice (lib/data/normalized/needs.ts), and
 * each write reads only the rows its rules need inside its own transaction
 * (lib/data/normalized/plans.ts).
 *
 * Reads ("snapshot", rollback/diagnostics only, CLUTCH_LIVE_READS=snapshot): the earlier
 * design, a cached copy of every live record, refreshed when another writer commits.
 *
 * Writes (both): each transaction runs the domain mutation against its OWN copy of the
 * records it read (AsyncLocalStorage), diffs it, and writes only the changed rows in one
 * database transaction. Every update is compare-and-swap on the row's version; inserts rely on
 * primary and unique keys. If another instance changed any row this one read-and-wrote,
 * or a unique rule fires (one accepted estimate, one active job…), nothing is written and
 * the mutation is re-run on fresh data — where the domain rules then refuse or return the
 * existing result. Correctness never depends on an in-process lock or in-memory rollback:
 * a failed or refused transaction just discards its private copy.
 */

type Doc = Record<string, unknown>;
type Key = string;
interface Snapshot {
  db: DB;
  /** JSON of each record as last read from the database. */
  persisted: Map<Key, string>;
  /** Row version of each record as last read. */
  versions: Map<Key, number>;
  seq: string;
  loadedAt: number;
}

export interface Committed {
  written: { key: Key; spec: Spec; doc: Doc; version: number }[];
  removed: { key: Key; spec: Spec; id: string }[];
}

export class StoreConflict extends Error {
  constructor(message = "concurrent update") {
    super(message);
    this.name = "StoreConflict";
  }
}

let schemaSql: string | undefined;
function schema() {
  return (schemaSql ??= readFileSync(path.join(process.cwd(), "supabase/migrations/0004_live_normalized.sql"), "utf8"));
}
let statsSql: string | undefined;
/** Per-mechanic evidence numbers (0008_mechanic_stats.sql). */
export function statsSchema() {
  return (statsSql ??= readFileSync(path.join(process.cwd(), "supabase/migrations/0008_mechanic_stats.sql"), "utf8"));
}
let policySql: string | undefined;
/** Booking-verification rules (0007_booking_verification.sql). */
export function policySchema() {
  return (policySql ??= readFileSync(path.join(process.cwd(), "supabase/migrations/0007_booking_verification.sql"), "utf8"));
}
let canonSql: string | undefined;
/** Canonical verification statuses (0009_verification_canonical.sql). */
export function canonicalVerificationSchema() {
  return (canonSql ??= readFileSync(path.join(process.cwd(), "supabase/migrations/0009_verification_canonical.sql"), "utf8"));
}
let readsSql: string | undefined;
/** Indexes and helpers for targeted reads (0006_live_reads.sql). */
export function readsSchema() {
  return (readsSql ??= readFileSync(path.join(process.cwd(), "supabase/migrations/0006_live_reads.sql"), "utf8"));
}

export interface NormalizedOptions {
  /**
   * "targeted" (default): per-request slices and per-write reads; nothing process-wide.
   * "snapshot": the whole-marketplace cache. Only as an explicit rollback or diagnostic path.
   */
  reads?: "targeted" | "snapshot";
  /** Longest a read may be served from cache without checking for other writers. */
  cacheMs?: number;
  /** Test hook: runs inside the write transaction after the first statement (to simulate a crash). */
  afterFirstWrite?: (tx: postgres.TransactionSql) => Promise<void>;
  maxAttempts?: number;
}

export class NormalizedLiveStore {
  private snap?: Snapshot;
  /** This instance's recent commits, re-applied after a reload that may have started before them. */
  private recent: Committed[] = [];
  private loading?: Promise<void>;
  private schemaReady?: Promise<void>;
  private readonly als = new AsyncLocalStorage<{ db: DB }>();
  /** Counters for tests and the reconciliation report. */
  readonly stats = { commits: 0, conflicts: 0, loads: 0, txRows: 0 };
  readonly reads: "targeted" | "snapshot";

  constructor(
    readonly sql: postgres.Sql,
    private readonly opts: NormalizedOptions = {},
  ) {
    this.reads = opts.reads ?? "targeted";
  }

  get targeted() {
    return this.reads === "targeted";
  }

  /** The records the current write transaction is working on, if inside one. */
  txDb(): DB | undefined {
    return this.als.getStore()?.db;
  }

  static connect(url: string, opts?: NormalizedOptions) {
    return new NormalizedLiveStore(postgres(url, { prepare: false, max: 5, idle_timeout: 20, onnotice: () => undefined }), opts);
  }

  /** The normalized schema (0004 + 0005 + 0006 + 0007 + 0008), applied once per version, never on an ordinary start. */
  ensureSchema() {
    return (this.schemaReady ??= (async () => {
      const text = `${schema()}\n${deliverySchemaSql()}\n${readsSchema()}\n${policySchema()}\n${statsSchema()}\n${canonicalVerificationSchema()}`;
      await applySqlOnce(this.sql, "live_normalized", text);
    })().catch((e) => {
      this.schemaReady = undefined;
      throw e;
    }));
  }

  private markStale() {
    if (this.snap) this.snap = { ...this.snap, loadedAt: 0, seq: "stale" };
  }

  /** The records a mutation or page should read: the transaction's own copy if inside one. */
  current(): DB {
    const tx = this.als.getStore();
    if (tx) return tx.db;
    if (this.targeted) throw new Error("Targeted live reads: read through a request slice (lib/data getRepo + needs), not the store.");
    if (!this.snap) throw new Error("Live data not loaded: call ready() first.");
    return this.snap.db;
  }

  /**
   * Make sure the cache exists and reflects other writers. "cache" may serve a recent cache
   * (page reads); "check" always asks the database whether anyone committed (every write);
   * "force" reloads.
   */
  async ready(mode: "cache" | "check" | "force" | boolean = "cache") {
    const how = mode === true ? "force" : mode === false ? "cache" : mode;
    const force = how === "force";
    await this.ensureSchema();
    if (this.targeted) return;
    const st = this.snap;
    if (st && how === "cache" && Date.now() - st.loadedAt < (this.opts.cacheMs ?? 1000)) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        if (st && !force) {
          const [row] = await this.sql<{ last_value: string; is_called: boolean }[]>`select last_value::text, is_called from lv_change_seq`;
          const seq = `${row.last_value}:${row.is_called}`;
          // Refresh fully every 30s regardless, in case of commits that finished out of sequence order.
          if (seq === st.seq && Date.now() - st.loadedAt < 30_000) {
            st.loadedAt = Date.now();
            return;
          }
        }
        this.snap = await this.load();
        // A reload that began before one of our own commits finished can't include it: fold those back in.
        for (const c of this.recent) this.applyCommitted(c);
      } finally {
        this.loading = undefined;
      }
    })();
    return this.loading;
  }

  private async load(): Promise<Snapshot> {
    this.stats.loads++;
    return this.sql.begin("isolation level repeatable read", async (tx) => {
      const [row] = await tx<{ last_value: string; is_called: boolean }[]>`select last_value::text, is_called from lv_change_seq`;
      const rows: { spec: Spec; data: Doc; version: number }[] = [];
      for (const spec of SPECS) {
        const got = await tx<{ data: Doc; v: string }[]>`select data, ${tx(spec.versionCol)}::text as v from ${tx(spec.table)} order by created_at, id collate "C"`;
        for (const g of got) rows.push({ spec, data: g.data, version: Number(g.v) });
      }
      const db = dbFromRecords(rows);
      const records = recordsOf(db);
      const versions = new Map<Key, number>();
      for (const r of rows) versions.set(`${r.spec.collection}\u0000${r.spec.id(r.data)}`, r.version);
      const persisted = new Map<Key, string>();
      for (const [k, rec] of records) persisted.set(k, JSON.stringify(rec.doc));
      return { db, persisted, versions, seq: `${row.last_value}:${row.is_called}`, loadedAt: Date.now() };
    }) as Promise<Snapshot>;
  }

  /**
   * Run a mutation and persist it atomically. Re-runs on fresh data after a conflict; a
   * rule refusal (thrown by the mutation) writes nothing.
   */
  async transact<T>(fn: () => T | Promise<T>, plan?: unknown): Promise<T> {
    if (this.targeted) return (await this.transactPlanned(typeof plan === "function" ? (plan as (r: Reader) => Promise<void>) : async () => undefined, fn)).result;
    const max = this.opts.maxAttempts ?? 6;
    for (let attempt = 0; attempt < max; attempt++) {
      await this.ready(attempt > 0 ? "force" : "check");
      const snap = this.snap!;
      // A private working copy: nothing this mutation does is visible to anyone until it commits.
      // Its base (what it read, and at which row versions) is copied too: a concurrent commit on this
      // instance folds its rows into the shared cache, and must not change what THIS write diffs against.
      const base = { persisted: new Map(snap.persisted), versions: new Map(snap.versions) };
      const work = { db: structuredClone(snap.db) };
      const result = await this.als.run(work, fn);
      try {
        const committed = await this.commit(base, work.db);
        // Read-your-writes: fold exactly the committed rows into this instance's cache.
        if (committed) {
          this.recent.push(committed);
          if (this.recent.length > 200) this.recent.shift();
          this.applyCommitted(committed);
        }
        return result;
      } catch (e) {
        // The cache is still a valid (older) state — transactions only ever change private copies —
        // but it may be behind the database: reload before the next use.
        this.markStale();
        if (e instanceof StoreConflict) {
          this.stats.conflicts++;
          continue;
        }
        throw e;
      }
    }
    throw new LifecycleError("This changed several times while you were working. Refresh and try again.", "stale");
  }

  /**
   * Put committed rows into the shared cache. A row is only replaced by a newer version, so a
   * concurrent commit folded in first is never overwritten by an older one.
   */
  private applyCommitted(c: Committed) {
    const st = this.snap;
    if (!st) return;
    for (const w of c.written) {
      if ((st.versions.get(w.key) ?? 0) >= w.version) continue;
      putRecord(st.db, w.spec, w.doc);
      st.persisted.set(w.key, JSON.stringify(w.doc));
      st.versions.set(w.key, w.version);
    }
    for (const d of c.removed) {
      removeRecord(st.db, d.spec, d.id);
      st.persisted.delete(d.key);
      st.versions.delete(d.key);
    }
  }

  /**
   * Targeted write: in ONE repeatable-read transaction, read what `plan` (and the closure
   * around it) needs, run the domain mutation on that private slice, and write back only
   * the rows it changed, each compare-and-swap on the version it was read at. A concurrent
   * change to any of those rows fails the transaction and the whole thing re-runs on fresh
   * rows; a rule refusal (thrown by the mutation) writes nothing.
   */
  async transactPlanned<T>(plan: (r: Reader) => Promise<void>, fn: () => T | Promise<T>): Promise<{ result: T; committed: Committed | null; returned?: Committed["written"][number] }> {
    const max = this.opts.maxAttempts ?? 6;
    await this.ensureSchema();
    for (let attempt = 0; attempt < max; attempt++) {
      try {
        const out = await this.sql.begin("isolation level repeatable read", async (tx) => {
          const slice = new Slice();
          const reader = new Reader(tx, slice);
          await plan(reader);
          await reader.closeForWrite();
          this.stats.txRows += slice.stats.rows;
          const result = await this.als.run({ db: slice.db }, fn);
          const committed = await this.writeChanges(tx, slice, slice.db);
          return { result, committed, returned: returnedRecord(slice, result) };
        });
        if (out.committed) this.stats.commits++;
        return out as { result: T; committed: Committed | null; returned?: Committed["written"][number] };
      } catch (e) {
        const c = classify(e);
        if (c instanceof StoreConflict) {
          this.stats.conflicts++;
          continue;
        }
        throw c;
      }
    }
    throw new LifecycleError("This changed several times while you were working. Refresh and try again.", "stale");
  }

  /** Diff `next` against `base` and write the changes in one transaction. Returns what was written (or null if nothing changed). */
  private async commit(base: { persisted: Map<Key, string>; versions: Map<Key, number> }, next: DB): Promise<Committed | null> {
    let committed: Committed | null = null;
    try {
      await this.sql.begin(async (tx) => {
        committed = await this.writeChanges(tx, base, next);
      });
    } catch (e) {
      throw classify(e);
    }
    if (committed) this.stats.commits++;
    return committed;
  }

  /** Write the rows of `next` that differ from `base` (as read), inside `tx`. */
  private async writeChanges(tx: postgres.TransactionSql, base: { persisted: Map<Key, string>; versions: Map<Key, number> }, next: DB): Promise<Committed | null> {
    const before = base.persisted;
    const after = recordsOf(next);
    const changed: { key: Key; spec: Spec; id: string; doc: Doc; prev?: Doc }[] = [];
    const removed: { key: Key; spec: Spec; id: string }[] = [];
    for (const [key, rec] of after) {
      const json = JSON.stringify(rec.doc);
      const old = before.get(key);
      if (old !== json) changed.push({ key, spec: rec.spec, id: rec.id, doc: rec.doc, prev: old ? (JSON.parse(old) as Doc) : undefined });
    }
    for (const key of before.keys()) if (!after.has(key)) {
      const [collection, id] = key.split("\u0000");
      removed.push({ key, spec: SPECS.find((x) => x.collection === collection)!, id });
    }
    if (!changed.length && !removed.length) return null;

    const versions = new Map(base.versions);
    {
      {
        let first = true;
        const hook = async () => {
          if (first && this.opts.afterFirstWrite) await this.opts.afterFirstWrite(tx);
          first = false;
        };
        for (const c of changed) {
          const table = c.spec.table;
          const vcol = c.spec.versionCol;
          const cols: Row = { ...c.spec.cols(c.doc), data: tx.json(c.doc as postgres.JSONValue) };
          if (c.prev === undefined) {
            await tx`insert into ${tx(table)} ${tx({ id: c.id, ...cols })}`;
            versions.set(c.key, 1);
          } else {
            const expected = base.versions.get(c.key) ?? 1;
            const res = await tx`update ${tx(table)} set ${tx(cols)}, ${tx(vcol)} = ${tx(vcol)} + 1, updated_at = now() where id = ${c.id} and ${tx(vcol)} = ${expected}`;
            if (res.count !== 1) throw new StoreConflict(`${table} ${c.id} changed`);
            versions.set(c.key, expected + 1);
          }
          await hook();
          for (const child of c.spec.children ?? []) await writeChildren(tx, child, c.doc, c.prev);
          if (c.spec.collection === "notifications" && c.prev === undefined) await this.outbox(tx, c.doc);
        }
        for (const r of removed) {
          const expected = base.versions.get(r.key) ?? 1;
          const res = await tx`delete from ${tx(r.spec.table)} where id = ${r.id} and ${tx(r.spec.versionCol)} = ${expected}`;
          if (res.count !== 1) throw new StoreConflict(`${r.spec.table} ${r.id} changed`);
          versions.delete(r.key);
        }
        await tx`select nextval('lv_change_seq')`;
      }
    }
    return {
      written: changed.map((c) => ({ key: c.key, spec: c.spec, doc: structuredClone(c.doc), version: versions.get(c.key)! })),
      removed: removed.map((r) => ({ key: r.key, spec: r.spec, id: r.id })),
    };
  }

  /** The optional alert for a new notification, queued in this same transaction (lib/notify/outbox.ts). */
  private async outbox(tx: postgres.TransactionSql, n: Doc) {
    await enqueueAlerts(tx, [n as unknown as AppNotification]);
  }

  /** Record that an uploaded file belongs to a live account (same transaction as the bytes). */
  async recordUpload(tx: postgres.TransactionSql, mediaId: string, ownerUserId: string) {
    await tx`insert into lv_uploads ${tx({ media_id: mediaId, owner_user_id: ownerUserId })}`;
  }

  async end() {
    await this.sql.end({ timeout: 5 });
  }
}

/**
 * The record a write returned (e.g. the existing request an idempotent retry hands back),
 * as it stands in the write's slice. Only that record goes back to the caller's request
 * slice: never the rest of what the transaction read for its rules.
 */
function returnedRecord(slice: Slice, result: unknown): Committed["written"][number] | undefined {
  if (!result || typeof result !== "object") return undefined;
  for (const spec of SPECS) {
    if (spec.map) continue;
    const list = slice.db[spec.collection] as unknown as Doc[];
    if (!list.includes(result as Doc)) continue;
    const doc = result as Doc;
    const key = `${spec.collection}\u0000${spec.id(doc)}`;
    const version = slice.versions.get(key);
    // Newly written records are already in `committed`; this is for ones returned unchanged.
    if (version === undefined || slice.persisted.get(key) !== JSON.stringify(doc)) return undefined;
    return { key, spec, doc: structuredClone(doc), version };
  }
  return undefined;
}

/** Write a record's child rows (see ChildSpec modes), given what they were derived from before (`prev`). */
export async function writeChildren(tx: postgres.TransactionSql, child: ChildSpec, doc: Doc, prev?: Doc) {
  const rows = child.rows(doc);
  const parentId = rows[0]?.[child.parentCol] ?? doc.id;
  if (child.mode === "replace") {
    await tx`delete from ${tx(child.table)} where ${tx(child.parentCol)} = ${String(parentId)}`;
    for (const r of rows) await tx`insert into ${tx(child.table)} ${tx(jsonCols(tx, r))}`;
    return;
  }
  if (child.mode === "append") {
    // Earlier rows must be unchanged; new rows are added. Only rows new since `prev` are written.
    const prevRows = prev ? child.rows(prev) : [];
    for (const r of rows) {
      const known = prevRows.find((p) => child.pk.every((k) => p[k] === r[k]));
      if (known && same(known, r)) continue;
      if (known) throw new LifecycleError("A recorded entry can't be changed.", "invalid_transition");
      const inserted = await tx`insert into ${tx(child.table)} ${tx(jsonCols(tx, r))} on conflict do nothing`;
      if (inserted.count === 0) throw new StoreConflict(`${child.table} row exists`);
    }
    return;
  }
  // upsert: write rows that differ from before; remove rows that disappeared.
  const prevRows = prev ? child.rows(prev) : [];
  for (const r of rows) {
    const known = prevRows.find((p) => child.pk.every((k) => p[k] === r[k]));
    if (known && same(known, r)) continue;
    const nonKey = Object.keys(r).filter((k) => !child.pk.includes(k));
    if (nonKey.length) {
      await tx`insert into ${tx(child.table)} ${tx(jsonCols(tx, r))} on conflict (${tx(child.pk)}) do update set ${tx(jsonCols(tx, r) as Record<string, postgres.ParameterOrJSON<never>>, ...nonKey)}`;
    } else {
      await tx`insert into ${tx(child.table)} ${tx(jsonCols(tx, r))} on conflict do nothing`;
    }
  }
  for (const p of prevRows) {
    if (rows.some((r) => child.pk.every((k) => p[k] === r[k]))) continue;
    // Table and column names come from the fixed specs, never from input.
    await tx.unsafe(`delete from "${child.table}" where ${child.pk.map((k, i) => `"${k}" = $${i + 1}`).join(" and ")}`, child.pk.map((k) => p[k] as string));
  }
}


/** Equal as data, whatever the key order. */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
const same = (a: unknown, b: unknown) => stable(a) === stable(b);

/** jsonb columns need tx.json; everything else is passed as is. */
export function jsonCols(tx: postgres.TransactionSql, r: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(r)) out[k] = k === "data" ? tx.json(v as postgres.JSONValue) : v;
  return out;
}

/** Postgres errors → retryable conflict, a rule the database refused, or a real error. */
function classify(e: unknown): unknown {
  if (e instanceof StoreConflict || e instanceof LifecycleError) return e;
  const pg = e as { code?: string; message?: string };
  // Unique violation (another instance created the same thing first) or serialization failure: re-run on fresh data.
  if (pg.code === "23505" || pg.code === "40001" || pg.code === "40P01") return new StoreConflict(pg.message);
  // A database rule refused the change (transition, frozen estimate, cross-owner link, append-only…).
  if (pg.code === "23514" || pg.code === "23503" || pg.code === "P0001") {
    console.error("[live-store] database rule refused a write:", pg.message);
    return new LifecycleError("That change isn't allowed in the current state. Refresh to see where it stands.", "invalid_transition");
  }
  return e;
}
