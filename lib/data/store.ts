import "server-only";
import postgres from "postgres";
import { buildSeed, type DB } from "./mock/seed";

/**
 * Persistence for the MVP.
 *
 * The domain logic (lib/data/mock/repository.ts) runs synchronously against an
 * in-memory snapshot of every record. This module keeps that snapshot in step
 * with Postgres (Supabase):
 *
 *  - `ready()` loads the snapshot, or reloads it when another server instance
 *    has committed since (a single version number in `app_meta`).
 *  - `transact(fn)` runs a mutation against the snapshot, diffs it, and commits
 *    the changed records in one transaction guarded by that version. If someone
 *    else committed first, it reloads and runs the mutation again.
 *
 * Records live in `app_records (collection, id, data jsonb)`; see
 * supabase/migrations/0002_app_store.sql. Without DATABASE_URL everything stays
 * in memory (seeded demo data), which is how local demos run.
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

function toDocs(db: DB) {
  const out = new Map<string, string>();
  for (const [field, value] of Object.entries(db) as [keyof DB, unknown][]) {
    if (SKIP_FIELDS.has(field)) continue;
    if (MAP_FIELDS.has(field)) out.set(`${KV}\u0000${field}`, JSON.stringify(value));
    else for (const d of value as Doc[]) out.set(`${field}\u0000${keyOf(field, d)}`, JSON.stringify(d));
  }
  return out;
}

function fromRows(rows: { collection: string; id: string; data: unknown }[]): DB {
  const db = { profileShares: {}, drafts: {}, customerNotes: {} } as unknown as Record<string, unknown>;
  for (const field of LIST_FIELDS) db[field] = [];
  for (const r of rows) {
    if (r.collection === KV) db[r.id] = r.data;
    else ((db[r.collection] ??= []) as unknown[]).push(r.data);
  }
  return db as unknown as DB;
}

/** A launch database: no fictional mechanics, customers or reviews. */
function emptyDB(): DB {
  return fromRows([]);
}

class Conflict extends Error {}

type State = { db: DB; persisted: Map<string, string>; version: number; checkedAt: number };
const g = globalThis as unknown as { __clutchStore?: State; __clutchLoading?: Promise<void>; __clutchSql?: postgres.Sql; __clutchTx?: Promise<unknown> };

export const persistent = () => Boolean(process.env.DATABASE_URL);

function sql() {
  return (g.__clutchSql ??= postgres(process.env.DATABASE_URL!, {
    // Supabase's pooler (transaction mode) doesn't support prepared statements.
    prepare: false,
    max: 5,
    idle_timeout: 20,
  }));
}

/** The live snapshot. Always call `await ready()` earlier in the request. */
export function current(): DB {
  if (!g.__clutchStore) {
    if (persistent()) throw new Error("Data not loaded: call `await ready()` before reading.");
    const db = buildSeed();
    g.__clutchStore = { db, persisted: toDocs(db), version: 0, checkedAt: Date.now() };
  }
  return g.__clutchStore.db;
}

async function load() {
  const s = sql();
  let [meta] = await s<{ version: string }[]>`select version from app_meta where key = 'main'`;
  if (!meta) {
    // First boot against an empty database: exactly one instance wins the insert and seeds.
    const won = await s`insert into app_meta (key, version) values ('main', 0) on conflict do nothing returning key`;
    if (won.length) {
      const db = process.env.CLUTCH_SEED === "off" ? emptyDB() : buildSeed();
      const docs = toDocs(db);
      await s.begin(async (tx) => {
        const rows = [...docs].map(([k, json]) => {
          const [collection, id] = k.split("\u0000");
          return { collection, id, data: JSON.parse(json) };
        });
        for (let i = 0; i < rows.length; i += 500) {
          await tx`insert into app_records ${tx(rows.slice(i, i + 500).map((r) => ({ ...r, data: tx.json(r.data as postgres.JSONValue) })), "collection", "id", "data")}`;
        }
        for (const e of db.events) {
          await tx`insert into app_events (id, name, mechanic_id, actor_id, variant, props, created_at)
            values (${e.id}, ${e.name}, ${e.mechanicId ?? null}, ${e.actorId ?? null}, ${e.variant ?? null}, ${tx.json(e.props as postgres.JSONValue)}, ${e.createdAt})`;
        }
        await tx`update app_meta set version = 1 where key = 'main'`;
      });
    } else await new Promise((r) => setTimeout(r, 1500));
    [meta] = await s<{ version: string }[]>`select version from app_meta where key = 'main'`;
  }
  const rows = await s<{ collection: string; id: string; data: unknown }[]>`select collection, id, data from app_records`;
  const db = fromRows(rows);
  g.__clutchStore = { db, persisted: toDocs(db), version: Number(meta.version), checkedAt: Date.now() };
}

/** Make sure the snapshot exists and is no older than the last commit anywhere. */
export async function ready(force = false) {
  if (!persistent()) {
    current();
    return;
  }
  const st = g.__clutchStore;
  if (st && !force && Date.now() - st.checkedAt < 250) return;
  if (g.__clutchLoading) return g.__clutchLoading;
  g.__clutchLoading = (async () => {
    try {
      if (st && !force) {
        const [meta] = await sql()<{ version: string }[]>`select version from app_meta where key = 'main'`;
        if (meta && Number(meta.version) === st.version) {
          st.checkedAt = Date.now();
          return;
        }
      }
      await load();
    } finally {
      g.__clutchLoading = undefined;
    }
  })();
  return g.__clutchLoading;
}

async function commit(st: State) {
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
  const version = await sql().begin(async (tx) => {
    const [meta] = await tx<{ version: string }[]>`select version from app_meta where key = 'main' for update`;
    if (!meta || Number(meta.version) !== st.version) throw new Conflict();
    for (const u of upserts) {
      await tx`insert into app_records (collection, id, data, updated_at) values (${u.collection}, ${u.id}, ${tx.json(JSON.parse(u.data) as postgres.JSONValue)}, now())
        on conflict (collection, id) do update set data = excluded.data, updated_at = now()`;
    }
    for (const d of deletes) await tx`delete from app_records where collection = ${d.collection} and id = ${d.id}`;
    const [row] = await tx<{ version: string }[]>`update app_meta set version = version + 1 where key = 'main' returning version`;
    return Number(row.version);
  });
  st.persisted = next;
  st.version = version;
  st.checkedAt = Date.now();
}

/**
 * Run a mutation and persist it. Mutations on one server instance run one at a
 * time; across instances the version check detects a race and the mutation is
 * re-run on fresh data, so it's never applied to stale records.
 */
export function transact<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      await ready(attempt > 0);
      const st = g.__clutchStore!;
      const result = await fn();
      try {
        await commit(st);
        return result;
      } catch (e) {
        if (!(e instanceof Conflict)) {
          // Drop the unsaved change so memory matches the database.
          if (persistent()) await ready(true);
          throw e;
        }
      }
    }
    throw new Error("Couldn't save your change because the data kept changing. Try again.");
  };
  const p = (g.__clutchTx ?? Promise.resolve()).then(run, run);
  g.__clutchTx = p.catch(() => undefined);
  return p;
}

// ---------------------------------------------------------------- media bytes
/** Uploaded files are stored in `app_media` (bytea) when persistent. */
export async function putMediaBytes(id: string, ownerId: string, meta: unknown, bytes: Uint8Array) {
  await sql()`insert into app_media (id, owner_id, meta, bytes) values (${id}, ${ownerId}, ${sql().json(meta as postgres.JSONValue)}, ${Buffer.from(bytes)})`;
}

export async function getMediaBytes(id: string) {
  const [row] = await sql()<{ owner_id: string; meta: unknown; bytes: Buffer }[]>`select owner_id, meta, bytes from app_media where id = ${id}`;
  return row;
}

export async function getMediaMeta(id: string) {
  const [row] = await sql()<{ owner_id: string; meta: unknown }[]>`select owner_id, meta from app_media where id = ${id}`;
  return row;
}

// ---------------------------------------------------------------- analytics
export async function insertEvent(e: { id: string; name: string; mechanicId?: string; actorId?: string; variant?: string; props: Record<string, unknown>; createdAt: string }) {
  await sql()`insert into app_events (id, name, mechanic_id, actor_id, variant, props, created_at)
    values (${e.id}, ${e.name}, ${e.mechanicId ?? null}, ${e.actorId ?? null}, ${e.variant ?? null}, ${sql().json(e.props as postgres.JSONValue)}, ${e.createdAt})`;
}

export async function eventCounts(mechanicId: string) {
  return sql()<{ name: string; n: string }[]>`
    select name, sum(coalesce((props->>'count')::int, 1)) as n from app_events where mechanic_id = ${mechanicId} group by name`;
}

export async function recentEvents(limit: number) {
  return sql()<{ id: string; name: string; mechanic_id: string | null; actor_id: string | null; variant: string | null; props: Record<string, string | number | boolean | undefined>; created_at: Date }[]>`
    select * from app_events order by created_at desc limit ${limit}`;
}
