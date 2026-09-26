import { createHash } from "node:crypto";
import type postgres from "postgres";

/**
 * Schema changes run ONCE per version, not on every server start. Each change is recorded
 * in `clutch_schema` under a key (a name plus the SQL's hash, or an explicit version); a
 * server that finds its key there does no DDL at all, just this one lookup. A new version
 * (a deploy with a changed migration) is applied by exactly one server, under an advisory
 * lock and a lock timeout, so it can't queue behind live traffic or deadlock with it for long.
 * Apply migrations before sending traffic to a new version (see README).
 */
export function schemaKey(name: string, sqlText: string) {
  return `${name}:${createHash("sha256").update(sqlText).digest("hex").slice(0, 16)}`;
}

async function applied(sql: postgres.Sql | postgres.TransactionSql, key: string) {
  try {
    return (await sql`select 1 from clutch_schema where key = ${key}`).length > 0;
  } catch (e) {
    if ((e as { code?: string }).code === "42P01") return false; // table not there yet
    throw e;
  }
}

export async function applyOnce(sql: postgres.Sql, key: string, apply: (tx: postgres.TransactionSql) => Promise<unknown>) {
  if (await applied(sql, key)) return;
  await sql.begin(async (tx) => {
    await tx`set local lock_timeout = '15s'`;
    await tx`select pg_advisory_xact_lock(hashtext('clutch_schema'))`;
    await tx`create table if not exists clutch_schema (key text primary key, applied_at timestamptz not null default now())`;
    await tx`alter table clutch_schema enable row level security`;
    if (await applied(tx, key)) return;
    await apply(tx);
    await tx`insert into clutch_schema (key) values (${key})`;
  });
}

/** A migration file's SQL, applied once per content. */
export function applySqlOnce(sql: postgres.Sql, name: string, sqlText: string) {
  return applyOnce(sql, schemaKey(name, sqlText), (tx) => tx.unsafe(sqlText));
}
