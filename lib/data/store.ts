import "server-only";
import postgres from "postgres";
import { buildSeed, type DB } from "./mock/seed";
import { crossScopeLeaks, splitByScope } from "./classify";
import { NormalizedLiveStore } from "./normalized/store";
import { deliverySchemaSql, enqueueAlerts } from "@/lib/notify/outbox";
import { applyOnce, applySqlOnce } from "./schema";
import type { AppNotification } from "@/lib/domain/types";
import type { Scope } from "./scope";

/**
 * Persistence for the MVP, per data scope ("live" real marketplace, "demo"
 * fictional showcase; see lib/data/scope.ts).
 *
 * The domain logic (lib/data/mock/repository.ts) runs synchronously against an
 * in-memory snapshot of one scope's records. This module keeps each scope's
 * snapshot in step with Postgres (Supabase):
 *
 *  - `ready(scope)` loads the snapshot, or reloads it when another server
 *    instance has committed since (a version number per scope in `app_meta`).
 *  - `transact(scope, fn)` runs a mutation against that snapshot, diffs it, and
 *    commits the changed records in one transaction guarded by the version.
 *
 * Records live in `app_records (scope, collection, id, data jsonb)`. The live
 * scope is never seeded; the demo scope is seeded with the fictional
 * marketplace while demo access is enabled. Without DATABASE_URL everything
 * stays in memory, the same way.
 */

type Doc = Record<string, unknown>;
const KV = "_kv";
/** DB fields that are maps rather than lists; stored as one record each under `_kv`. */
const MAP_FIELDS = new Set<keyof DB>(["profileShares", "drafts", "customerNotes"]);
/** Analytics events are append-only and live in their own table (`app_events`), not the snapshot. */
const SKIP_FIELDS = new Set<keyof DB>(["events"]);
const LIST_FIELDS: (keyof DB)[] = [
  "users", "mechanics", "customers", "vehicles", "screenings", "insurance", "credentials", "employment", "pastRepairs",
  "confirmations", "verifications", "requests", "quotes", "jobs", "reviews", "saved", "events", "notifications", "supportReports",
];
const keyOf = (collection: string, d: Doc) =>
  collection === "saved" ? `${d.customerId}:${d.mechanicId}` : String(d.id);

/** app_meta key holding each scope's version ("main" predates scopes and stays the live key). */
const META_KEY: Record<Scope, string> = { live: "main", demo: "demo" };
const MIGRATION_MARKER = "scope_v1";
/** Second step: the standing link check (lib/data/classify.ts `crossScopeLeaks`) over already-split data. */
const LEAK_MARKER = "scope_v2";

function toDocs(db: DB) {
  const out = new Map<string, string>();
  for (const [field, value] of Object.entries(db) as [keyof DB, unknown][]) {
    if (SKIP_FIELDS.has(field)) continue;
    if (MAP_FIELDS.has(field)) out.set(`${KV}\u0000${field}`, JSON.stringify(value));
    else for (const d of value as Doc[]) out.set(`${field}\u0000${keyOf(field, d)}`, JSON.stringify(d));
  }
  return out;
}

export function fromRows(rows: { collection: string; id: string; data: unknown }[]): DB {
  const db = { profileShares: {}, drafts: {}, customerNotes: {} } as unknown as Record<string, unknown>;
  for (const field of LIST_FIELDS) db[field] = [];
  for (const r of rows) {
    if (r.collection === KV) db[r.id] = r.data;
    else ((db[r.collection] ??= []) as unknown[]).push(r.data);
  }
  return db as unknown as DB;
}

/** The real marketplace starts empty: no fictional mechanics, customers or reviews. */
export function emptyDB(): DB {
  return fromRows([]);
}

/**
 * Demo snapshots saved before every seeded profile had an account (fixed 2026-09-26) are
 * missing some fictional customer accounts, so anything that notified those customers failed.
 * Fill them in from the seed when the demo loads. Demo scope only; it only adds seed accounts
 * that a saved profile points at, and changes nothing else.
 */
function withSeedAccounts(db: DB) {
  const have = new Set(db.users.map((u) => u.id));
  const missing = new Set([...db.customers.map((c) => c.userId), ...db.mechanics.map((m) => m.userId)].filter((id) => !have.has(id)));
  if (!missing.size) return;
  for (const u of buildSeed().users) if (missing.has(u.id)) db.users.push(u);
}

/** What a scope starts with the first time it's used. */
function initialFor(scope: Scope): DB {
  return scope === "demo" ? buildSeed() : emptyDB();
}

class Conflict extends Error {}

type State = { db: DB; persisted: Map<string, string>; version: number; checkedAt: number };
const g = globalThis as unknown as {
  __clutchStores?: Partial<Record<Scope, State>>;
  __clutchLoading?: Partial<Record<Scope, Promise<void>>>;
  __clutchSql?: postgres.Sql;
  __clutchTx?: Partial<Record<Scope, Promise<unknown>>>;
  __clutchMigrated?: Promise<void>;
};
const stores = (g.__clutchStores ??= {});
const loading = (g.__clutchLoading ??= {});
const txChain = (g.__clutchTx ??= {});

export const persistent = () => Boolean(process.env.DATABASE_URL);

/**
 * The real marketplace on normalized tables (lib/data/normalized/store.ts) instead of the
 * record snapshot. Off unless CLUTCH_LIVE_STORE=normalized (and a database is configured);
 * the demo always stays on its own snapshot, so demo records can't reach the live tables.
 */
export const liveNormalized = () => persistent() && process.env.CLUTCH_LIVE_STORE === "normalized";
/**
 * How the normalized live store is read. "targeted" (the default): each request reads only
 * what its page needs. "snapshot": the earlier whole-marketplace cache, kept ONLY as an
 * explicit rollback/diagnostic path (CLUTCH_LIVE_READS=snapshot); it logs a warning.
 */
export const liveReadMode = (): "targeted" | "snapshot" => (process.env.CLUTCH_LIVE_READS === "snapshot" ? "snapshot" : "targeted");
export const liveReadsTargeted = () => liveNormalized() && liveReadMode() === "targeted";
const gl = globalThis as unknown as { __clutchLiveStore?: NormalizedLiveStore; __clutchLiveStoreMode?: string };
export function liveStore() {
  const mode = liveReadMode();
  if (gl.__clutchLiveStore && gl.__clutchLiveStoreMode !== mode) gl.__clutchLiveStore = undefined;
  if (!gl.__clutchLiveStore && mode === "snapshot") console.warn("[live-store] CLUTCH_LIVE_READS=snapshot: every live record is cached in this process. Rollback/diagnostics only.");
  gl.__clutchLiveStoreMode = mode;
  return (gl.__clutchLiveStore ??= new NormalizedLiveStore(sql(), { reads: mode }));
}
const normalized = (scope: Scope) => scope === "live" && liveNormalized();

function sql() {
  return (g.__clutchSql ??= postgres(process.env.DATABASE_URL!, {
    // Supabase's pooler (transaction mode) doesn't support prepared statements.
    prepare: false,
    max: 5,
    idle_timeout: 20,
    onnotice: () => undefined,
  }));
}

/** The shared connection (delivery worker, health page). Only with DATABASE_URL. */
export function dbSql() {
  return sql();
}

/** Create the alert delivery tables if needed (0005_delivery.sql). Idempotent; once per process. */
const gd = globalThis as unknown as { __clutchDeliverySchema?: Promise<void> };
export function ensureDeliverySchema() {
  return (gd.__clutchDeliverySchema ??= applySqlOnce(sql(), "delivery", deliverySchemaSql())
    .then(() => undefined)
    .catch((e) => {
      gd.__clutchDeliverySchema = undefined;
      throw e;
    }));
}

/** A scope's live snapshot. Always `await ready(scope)` earlier in the request. */
export function current(scope: Scope): DB {
  if (normalized(scope)) return liveStore().current();
  const st = stores[scope];
  if (!st) {
    if (persistent()) throw new Error(`Data not loaded: call \`await ready("${scope}")\` before reading.`);
    const db = initialFor(scope);
    stores[scope] = { db, persisted: toDocs(db), version: 0, checkedAt: Date.now() };
    return db;
  }
  return st.db;
}

// ---------------------------------------------------------------- migration
/**
 * One-time, idempotent upgrade of a database from before data scopes:
 * adds the `scope` columns, then splits the old single store into live, demo
 * and quarantine (lib/data/classify.ts). Every row is copied to
 * `app_scope_backup` first; nothing is deleted.
 */
/** Bump when the DDL in `appStoreDdl` changes, so it runs once more. */
const APP_STORE_DDL_VERSION = "app_store:v1";

async function appStoreDdl(tx: postgres.TransactionSql) {
  await tx`alter table app_records add column if not exists scope text not null default 'live'`;
  const [pk] = await tx<{ cols: string }[]>`
    select string_agg(a.attname, ',' order by array_position(i.indkey, a.attnum)) as cols
    from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'app_records'::regclass and i.indisprimary`;
  if (pk?.cols !== "scope,collection,id") {
    await tx`alter table app_records drop constraint if exists app_records_pkey`;
    await tx`alter table app_records add primary key (scope, collection, id)`;
  }
  await tx`create index if not exists app_records_scope on app_records (scope)`;
  await tx`alter table app_events add column if not exists scope text not null default 'live'`;
  await tx`create index if not exists app_events_scope_mechanic on app_events (scope, mechanic_id, name)`;
  await tx`alter table app_media add column if not exists scope text not null default 'live'`;
  await tx`create table if not exists app_scope_backup (
    collection text not null, id text not null, scope text not null, data jsonb not null, backed_up_at timestamptz not null default now())`;
  await tx`alter table app_scope_backup enable row level security`;
  await tx`alter table app_scope_backup add column if not exists migration text`;
}

async function migrate() {
  const s = sql();
  // DDL once per version (lib/data/schema.ts): no table locks on an ordinary server start.
  await applyOnce(s, APP_STORE_DDL_VERSION, appStoreDdl);
  // Alert delivery queue (0005_delivery.sql), used by both live storage paths.
  await applySqlOnce(s, "delivery", deliverySchemaSql());
  // The one-time data steps: skipped outright once both are recorded.
  const marks = await s<{ n: number }[]>`select count(*)::int as n from app_meta where key in (${MIGRATION_MARKER}, ${LEAK_MARKER})`;
  if (marks[0].n === 2) return;
  await s.begin(async (tx) => {
    // One instance at a time.
    await tx`select pg_advisory_xact_lock(hashtext('clutch_scope_migration'))`;
    const [main] = await tx<{ version: string }[]>`select version from app_meta where key = 'main'`;
    if (!main) {
      // A brand-new database: nothing to split or check.
      await tx`insert into app_meta (key, version) values (${MIGRATION_MARKER}, 1), (${LEAK_MARKER}, 1) on conflict do nothing`;
      return;
    }
    const [done] = await tx`select 1 from app_meta where key = ${MIGRATION_MARKER}`;
    if (!done) await splitPreScope(tx);
    const [checked] = await tx`select 1 from app_meta where key = ${LEAK_MARKER}`;
    if (!checked) await quarantineLeaks(tx);
  });
}

/** Records that point into the other scope move to quarantine (backed up first); list links are moved aside. */
async function quarantineLeaks(tx: postgres.TransactionSql) {
  const load = async (scope: Scope) => fromRows(await tx<{ collection: string; id: string; data: unknown }[]>`select collection, id, data from app_records where scope = ${scope}`);
  const dbs = { live: await load("live"), demo: await load("demo") };
  const before = { live: toDocs(dbs.live), demo: toDocs(dbs.demo) };
  const found = [
    { scope: "live" as const, ...crossScopeLeaks(dbs.live, dbs.demo) },
    { scope: "demo" as const, ...crossScopeLeaks(dbs.demo, dbs.live) },
  ];
  let touched = 0;
  for (const { scope, quarantine } of found) {
    const after = toDocs(dbs[scope]);
    for (const [k, json] of before[scope]) {
      if (after.get(k) === json) continue;
      const [collection, id] = k.split("\u0000");
      await tx`insert into app_scope_backup (collection, id, scope, data, migration) select collection, id, scope, data, ${LEAK_MARKER} from app_records where scope = ${scope} and collection = ${collection} and id = ${id}`;
      touched++;
      const next = after.get(k);
      if (next !== undefined) {
        await tx`update app_records set data = ${tx.json(JSON.parse(next) as postgres.JSONValue)}, updated_at = now() where scope = ${scope} and collection = ${collection} and id = ${id}`;
        continue;
      }
      const q = quarantine.find((x) => x.collection === collection && x.id === id);
      await tx`update app_records set scope = 'quarantine', data = ${tx.json({ ...(JSON.parse(json) as object), quarantineReason: q?.reason ?? "links the other scope", quarantinedFrom: scope } as postgres.JSONValue)}, updated_at = now()
        where scope = ${scope} and collection = ${collection} and id = ${id}`;
    }
    // Entries lifted out of map records (e.g. a customer note) are kept as their own quarantine rows.
    for (const q of quarantine.filter((x) => x.collection === "customerNotes")) {
      await tx`insert into app_records (scope, collection, id, data) values ('quarantine', ${q.collection}, ${q.id}, ${tx.json({ ...q.data, quarantineReason: q.reason, quarantinedFrom: scope } as postgres.JSONValue)}) on conflict do nothing`;
    }
  }
  if (touched) {
    await tx`update app_meta set version = version + 1 where key in ('main', 'demo')`;
    console.log(`[store] scope check: ${found.map((f) => `${f.scope}: ${f.quarantine.length} quarantined, ${f.changed.length} links moved aside`).join("; ")}`);
  }
  await tx`insert into app_meta (key, version) values (${LEAK_MARKER}, 1) on conflict do nothing`;
}

/** The one-time split of a database from before scopes (every row was 'live'). */
async function splitPreScope(tx: postgres.TransactionSql) {
  {

    // Split the pre-scope store.
    const rows = await tx<{ collection: string; id: string; data: unknown }[]>`select collection, id, data from app_records where scope = 'live'`;
    await tx`insert into app_scope_backup (collection, id, scope, data, migration) select collection, id, scope, data, ${MIGRATION_MARKER} from app_records where scope = 'live'`;
    const events = await tx<{ id: string; mechanic_id: string | null; actor_id: string | null }[]>`select id, mechanic_id, actor_id from app_events`;
    const mixed = fromRows(rows);
    const seed = buildSeed();
    const split = splitByScope(mixed, seed);

    // Demo records keep their content and just change scope (batched). Records whose content
    // changed (cross-scope links moved aside) and the per-scope map records are written in full.
    const changed = new Set(split.changed.map((c) => `${c.collection}\u0000${c.id}`));
    const moveKeys: [string, string][] = [];
    const writeFull: [string, string, string][] = [];
    for (const [scope, db] of [["demo", split.demo], ["live", split.live]] as const) {
      for (const [k, json] of toDocs(db)) {
        const [collection, id] = k.split("\u0000");
        if (collection === KV || changed.has(k)) writeFull.push([scope, k, json]);
        else if (scope === "demo") moveKeys.push([collection, id]);
      }
    }
    for (let i = 0; i < moveKeys.length; i += 500) {
      const batch = moveKeys.slice(i, i + 500);
      await tx`update app_records set scope = 'demo', updated_at = now()
        where scope = 'live' and (collection, id) in (select * from unnest(${batch.map((x) => x[0])}::text[], ${batch.map((x) => x[1])}::text[]))`;
    }
    for (const [scope, k, json] of writeFull) {
      const [collection, id] = k.split("\u0000");
      const data = tx.json(JSON.parse(json) as postgres.JSONValue);
      const moved = await tx`update app_records set scope = ${scope}, data = ${data}, updated_at = now() where scope = 'live' and collection = ${collection} and id = ${id} returning 1`;
      if (!moved.length) {
        await tx`insert into app_records (scope, collection, id, data) values (${scope}, ${collection}, ${id}, ${data})
          on conflict (scope, collection, id) do update set data = excluded.data, updated_at = now()`;
      }
    }
    for (const qr of split.quarantine) {
      const data = tx.json({ ...qr.data, quarantineReason: qr.reason } as postgres.JSONValue);
      const moved = await tx`update app_records set scope = 'quarantine', data = ${data}, updated_at = now() where scope = 'live' and collection = ${qr.collection} and id = ${qr.id} returning 1`;
      if (!moved.length) await tx`insert into app_records (scope, collection, id, data) values ('quarantine', ${qr.collection}, ${qr.id}, ${data}) on conflict do nothing`;
    }

    // Side tables follow the records they describe.
    const demoIds = new Set([...split.demoIds.users, ...split.demoIds.customers, ...split.demoIds.mechanics]);
    const seedEvents = new Set(seed.events.map((e) => e.id));
    const demoEvents = events.filter((e) => seedEvents.has(e.id) || (e.mechanic_id && demoIds.has(e.mechanic_id)) || (e.actor_id && demoIds.has(e.actor_id))).map((e) => e.id);
    for (let i = 0; i < demoEvents.length; i += 500) await tx`update app_events set scope = 'demo' where id in ${tx(demoEvents.slice(i, i + 500))}`;
    const demoOwners = [...split.demoIds.users];
    if (demoOwners.length) await tx`update app_media set scope = 'demo' where owner_id in ${tx(demoOwners)}`;

    await tx`insert into app_meta (key, version) values ('demo', 1) on conflict (key) do update set version = app_meta.version + 1`;
    await tx`update app_meta set version = version + 1 where key = 'main'`;
    await tx`insert into app_meta (key, version) values (${MIGRATION_MARKER}, 1)`;
    console.log(
      `[store] scope migration: ${split.live.users.length} live users, ${split.demo.users.length} demo users, ${split.quarantine.length} quarantined, ${split.changed.length} records had cross-scope links moved aside`,
    );
  }
}

async function load(scope: Scope) {
  const s = sql();
  await (g.__clutchMigrated ??= migrate().catch((e) => {
    g.__clutchMigrated = undefined;
    throw e;
  }));
  const key = META_KEY[scope];
  let [meta] = await s<{ version: string }[]>`select version from app_meta where key = ${key}`;
  if (!meta) {
    // First use of this scope: exactly one instance wins the insert and seeds it.
    const won = await s`insert into app_meta (key, version) values (${key}, 0) on conflict do nothing returning key`;
    if (won.length) {
      const db = initialFor(scope);
      const docs = toDocs(db);
      await s.begin(async (tx) => {
        const rows = [...docs].map(([k, json]) => {
          const [collection, id] = k.split("\u0000");
          return { scope, collection, id, data: JSON.parse(json) };
        });
        for (let i = 0; i < rows.length; i += 500) {
          await tx`insert into app_records ${tx(rows.slice(i, i + 500).map((r) => ({ ...r, data: tx.json(r.data as postgres.JSONValue) })), "scope", "collection", "id", "data")}`;
        }
        for (const e of db.events) {
          await tx`insert into app_events (id, name, mechanic_id, actor_id, variant, props, created_at, scope)
            values (${e.id}, ${e.name}, ${e.mechanicId ?? null}, ${e.actorId ?? null}, ${e.variant ?? null}, ${tx.json(e.props as postgres.JSONValue)}, ${e.createdAt}, ${scope})
            on conflict (id) do nothing`;
        }
        await tx`update app_meta set version = 1 where key = ${key}`;
      });
    } else await new Promise((r) => setTimeout(r, 1500));
    [meta] = await s<{ version: string }[]>`select version from app_meta where key = ${key}`;
  }
  const rows = await s<{ collection: string; id: string; data: unknown }[]>`select collection, id, data from app_records where scope = ${scope}`;
  const db = fromRows(rows);
  if (scope === "demo") withSeedAccounts(db);
  stores[scope] = { db, persisted: toDocs(db), version: Number(meta.version), checkedAt: Date.now() };
}

/** Make sure a scope's snapshot exists and is no older than the last commit anywhere. */
export async function ready(scope: Scope, force = false) {
  if (normalized(scope)) return liveStore().ready(force ? "force" : "cache");
  if (!persistent()) {
    current(scope);
    return;
  }
  const st = stores[scope];
  if (st && !force && Date.now() - st.checkedAt < 250) return;
  if (loading[scope]) return loading[scope];
  loading[scope] = (async () => {
    try {
      if (st && !force) {
        const [meta] = await sql()<{ version: string }[]>`select version from app_meta where key = ${META_KEY[scope]}`;
        if (meta && Number(meta.version) === st.version) {
          st.checkedAt = Date.now();
          return;
        }
      }
      await load(scope);
    } finally {
      loading[scope] = undefined;
    }
  })();
  return loading[scope];
}

async function commit(scope: Scope, st: State) {
  const next = toDocs(st.db);
  const upserts: { collection: string; id: string; data: string }[] = [];
  const deletes: { collection: string; id: string }[] = [];
  for (const [k, json] of next) if (st.persisted.get(k) !== json) {
    const [collection, id] = k.split("\u0000");
    upserts.push({ collection, id, data: json });
  }
  for (const k of st.persisted.keys()) if (!next.has(k)) {
    const [collection, id] = k.split("\u0000");
    deletes.push({ collection, id });
  }
  if (!upserts.length && !deletes.length) return;
  if (!persistent()) {
    st.persisted = next;
    return;
  }
  const key = META_KEY[scope];
  const version = await sql().begin(async (tx) => {
    const [meta] = await tx<{ version: string }[]>`select version from app_meta where key = ${key} for update`;
    if (!meta || Number(meta.version) !== st.version) throw new Conflict();
    for (const u of upserts) {
      await tx`insert into app_records (scope, collection, id, data, updated_at) values (${scope}, ${u.collection}, ${u.id}, ${tx.json(JSON.parse(u.data) as postgres.JSONValue)}, now())
        on conflict (scope, collection, id) do update set data = excluded.data, updated_at = now()`;
    }
    for (const d of deletes) await tx`delete from app_records where scope = ${scope} and collection = ${d.collection} and id = ${d.id}`;
    // New live notifications queue their optional alert in this same transaction.
    if (scope === "live") {
      const fresh = upserts.filter((u) => u.collection === "notifications" && !st.persisted.has(`notifications\u0000${u.id}`)).map((u) => JSON.parse(u.data) as AppNotification);
      if (fresh.length) await enqueueAlerts(tx, fresh);
    }
    const [row] = await tx<{ version: string }[]>`update app_meta set version = version + 1 where key = ${key} returning version`;
    return Number(row.version);
  });
  st.persisted = next;
  st.version = version;
  st.checkedAt = Date.now();
}

/**
 * Put a scope's snapshot back to its last committed state, so a failed or refused write
 * can never leave half-applied changes in memory (to be saved by the next write).
 */
async function rollback(scope: Scope, st: State) {
  if (persistent()) {
    await ready(scope, true);
    return;
  }
  const rows = [...st.persisted].map(([k, json]) => {
    const [collection, id] = k.split("\u0000");
    return { collection, id, data: JSON.parse(json) as unknown };
  });
  const db = fromRows(rows);
  db.events = st.db.events; // analytics aren't part of the snapshot
  st.db = db;
}

/**
 * Run a mutation against one scope and persist it. Mutations on one server
 * instance run one at a time per scope; across instances the version check
 * detects a race and the mutation is re-run on fresh data.
 */
export function transact<T>(scope: Scope, fn: () => T | Promise<T>): Promise<T> {
  // Normalized live data: each write is its own database transaction with row-version checks.
  // (Targeted reads commit through a request slice with a read plan; see lib/data/index.ts.)
  if (normalized(scope)) {
    if (liveReadsTargeted()) return Promise.reject(new Error("Targeted live writes go through a request slice (getRepo), which knows what each write reads."));
    return liveStore().transact(fn);
  }
  const run = async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      await ready(scope, attempt > 0);
      const st = stores[scope]!;
      let result: T;
      try {
        result = await fn();
      } catch (e) {
        // The mutation refused partway (e.g. a lifecycle rule): undo anything it already changed.
        await rollback(scope, st);
        throw e;
      }
      try {
        await commit(scope, st);
        return result;
      } catch (e) {
        if (!(e instanceof Conflict)) {
          // Drop the unsaved change so memory matches the database.
          await rollback(scope, st);
          throw e;
        }
      }
    }
    throw new Error("Couldn't save your change because the data kept changing. Try again.");
  };
  const p = (txChain[scope] ?? Promise.resolve()).then(run, run);
  txChain[scope] = p.catch(() => undefined);
  return p;
}

/** Tests only: forget in-memory snapshots so each test file starts fresh. */
export function resetMemoryStores() {
  if (persistent()) throw new Error("resetMemoryStores is for in-memory tests only.");
  delete stores.live;
  delete stores.demo;
}

// ---------------------------------------------------------------- media bytes
/** Uploaded files are stored in `app_media` (bytea) when persistent, tagged with their scope. */
export async function putMediaBytes(scope: Scope, id: string, ownerId: string, meta: unknown, bytes: Uint8Array) {
  await sql().begin(async (tx) => {
    await tx`insert into app_media (id, owner_id, meta, bytes, scope) values (${id}, ${ownerId}, ${tx.json(meta as postgres.JSONValue)}, ${Buffer.from(bytes)}, ${scope})`;
    // Live uploads belong to a live account, enforced by a foreign key.
    if (normalized(scope)) await liveStore().recordUpload(tx, id, ownerId);
  });
}

export async function getMediaBytes(scope: Scope, id: string) {
  const [row] = await sql()<{ owner_id: string; meta: unknown; bytes: Buffer }[]>`select owner_id, meta, bytes from app_media where id = ${id} and scope = ${scope}`;
  return row;
}

export async function getMediaMeta(scope: Scope, id: string) {
  const [row] = await sql()<{ owner_id: string; meta: unknown }[]>`select owner_id, meta from app_media where id = ${id} and scope = ${scope}`;
  return row;
}

// ---------------------------------------------------------------- analytics
export async function insertEvent(scope: Scope, e: { id: string; name: string; mechanicId?: string; actorId?: string; variant?: string; props: Record<string, unknown>; createdAt: string }) {
  await sql()`insert into app_events (id, name, mechanic_id, actor_id, variant, props, created_at, scope)
    values (${e.id}, ${e.name}, ${e.mechanicId ?? null}, ${e.actorId ?? null}, ${e.variant ?? null}, ${sql().json(e.props as postgres.JSONValue)}, ${e.createdAt}, ${scope})`;
}

export async function eventCounts(scope: Scope, mechanicId: string) {
  return sql()<{ name: string; n: string }[]>`
    select name, sum(coalesce((props->>'count')::int, 1)) as n from app_events where scope = ${scope} and mechanic_id = ${mechanicId} group by name`;
}

export async function recentEvents(scope: Scope, limit: number) {
  return sql()<{ id: string; name: string; mechanic_id: string | null; actor_id: string | null; variant: string | null; props: Record<string, string | number | boolean | undefined>; created_at: Date }[]>`
    select * from app_events where scope = ${scope} order by created_at desc limit ${limit}`;
}
