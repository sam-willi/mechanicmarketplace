import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { runPreflight, type Report } from "@/lib/release/preflight";
import { expectedSchemaKeys, readOnlyDb } from "@/lib/release/probes";

/**
 * The preflight's SQL against a real Postgres: its own throwaway database on the disposable test
 * cluster (never DATABASE_URL's own data), created from the app's migrations. Proves the probe is
 * genuinely read-only, and that each database finding flips when the data does.
 */

const base = process.env.DATABASE_URL!;
assert.match(base, /127\.0\.0\.1:\d+\/clutch_test$/, "only ever the disposable test cluster");
const name = `clutch_preflight_${process.pid}`;
const url = base.replace(/\/clutch_test$/, `/${name}`);
const admin = postgres(base, { prepare: false, max: 1, onnotice: () => undefined });
let w: postgres.Sql;
let ro: ReturnType<typeof readOnlyDb>;

before(async () => {
  await admin.unsafe(`create database ${name}`);
  w = postgres(url, { prepare: false, max: 1, onnotice: () => undefined });
  for (const f of ["0002_app_store.sql", "0003_data_scope.sql"]) await w.unsafe(readFileSync(`supabase/migrations/${f}`, "utf8"));
  ro = readOnlyDb(url);
});
after(async () => {
  await ro?.end();
  await w?.end({ timeout: 5 });
  await admin.unsafe(`drop database if exists ${name} with (force)`);
  await admin.end({ timeout: 5 });
});

const run = () => runPreflight({ env: { DATABASE_URL: url, CLUTCH_DEMO_LOGINS: "off" }, target: "production", online: true, db: ro.probe, expectedSchemaKeys: expectedSchemaKeys(), routes: [], crons: [] });
const st = (r: Report, id: string) => r.items.find((i) => i.id === id)?.status;
const rec = (scope: string, collection: string, id: string, data: object) => w`insert into app_records (scope, collection, id, data) values (${scope}, ${collection}, ${id}, ${w.json(data as never)})`;

test("the probe is read-only: Postgres itself refuses a write through it", async () => {
  await assert.rejects(ro.probe(`insert into app_meta (key, version) values ('preflight-write', 1)`), /read-only transaction/);
  await assert.rejects(ro.probe(`create table preflight_should_not_exist (x int)`), /read-only transaction/);
  assert.equal((await w`select count(*)::int as n from app_meta where key = 'preflight-write'`)[0].n, 0);
  const [r] = await ro.probe<{ ro: string }>(`select current_setting('transaction_read_only') as ro`);
  assert.equal(r.ro, "on");
});

test("each scope's own settings rows (_kv) share keys by design and aren't flagged", async () => {
  await rec("live", "_kv", "drafts", {});
  await rec("demo", "_kv", "drafts", {});
  assert.equal(st(await run(), "isolation.shared_ids"), "PASS");
});

test("a fresh database: tables and privacy pass; schema versions and the scope split are pending, not failed", async () => {
  const r = await run();
  assert.equal(st(r, "database.connect"), "PASS");
  assert.match(r.items.find((i) => i.id === "database.connect")!.detail, /transaction_read_only=on/);
  assert.equal(st(r, "database.tables"), "PASS");
  assert.equal(st(r, "database.versions"), "WARN");
  assert.equal(st(r, "database.scope_migration"), "WARN");
  assert.equal(st(r, "documents.rls"), "PASS", "the migrations turn row level security on with no policies");
  for (const id of ["isolation.demo_users", "isolation.shared_ids", "database.verification_backfill"]) assert.equal(st(r, id), "PASS", id);
  assert.equal(r.items.find((i) => i.id === "isolation.demo_flags"), undefined);
});

test("after startup has recorded its schema and the split: those pass", async () => {
  await w`create table if not exists clutch_schema (key text primary key, applied_at timestamptz not null default now())`;
  await w`alter table clutch_schema enable row level security`;
  for (const k of expectedSchemaKeys()) await w`insert into clutch_schema (key) values (${k}) on conflict do nothing`;
  for (const k of ["scope_v1", "scope_v2"]) await w`insert into app_meta (key, version) values (${k}, 1) on conflict do nothing`;
  const r = await run();
  assert.equal(st(r, "database.versions"), "PASS");
  assert.equal(st(r, "database.scope_migration"), "PASS");
  const dbItems = r.items.filter((i) => ["database", "isolation"].includes(i.area) || i.id === "documents.rls");
  assert.deepEqual(dbItems.filter((i) => i.status !== "PASS").map((i) => i.id), [], "every database finding passes");
});

test("isolation and legacy data are found in the real rows", async () => {
  await rec("live", "users", "u-demo-leak", { id: "u-demo-leak", email: "leak@example.test", demo: true });
  await rec("live", "mechanics", "m-shared", { id: "m-shared", isDemo: true });
  await rec("demo", "mechanics", "m-shared", { id: "m-shared" });
  await rec("live", "verifications", "v-old", { id: "v-old", status: "pending" });
  await rec("demo", "verifications", "v-demo-old", { id: "v-demo-old", status: "pending" });
  const r = await run();
  assert.equal(st(r, "isolation.demo_users"), "BLOCKED");
  assert.equal(st(r, "isolation.shared_ids"), "WARN");
  assert.equal(st(r, "isolation.demo_flags"), "WARN");
  assert.equal(st(r, "database.verification_backfill"), "WARN");
  assert.match(r.items.find((i) => i.id === "database.verification_backfill")!.detail, /^1 live record;/, "the demo scope isn't counted");
  await w`delete from app_records where id in ('u-demo-leak', 'm-shared', 'v-old', 'v-demo-old')`;
});

test("a policy or disabled row level security on app data blocks the release", async () => {
  await w.unsafe(`create policy preflight_open on app_media for select using (true)`);
  let r = await run();
  assert.equal(st(r, "documents.rls"), "BLOCKED");
  assert.match(r.items.find((i) => i.id === "documents.rls")!.detail, /preflight_open on app_media/);
  await w.unsafe(`drop policy preflight_open on app_media`);
  await w.unsafe(`alter table app_records disable row level security`);
  r = await run();
  assert.equal(st(r, "documents.rls"), "BLOCKED");
  assert.match(r.items.find((i) => i.id === "documents.rls")!.next!, /alter table app_records enable row level security;/);
  await w.unsafe(`alter table app_records enable row level security`);
  assert.equal(st(await run(), "documents.rls"), "PASS");
});

test("an unreachable database is BLOCKED without printing the connection string", async () => {
  const bad = readOnlyDb(`postgres://clutch:FICTIONAL-pass-9@127.0.0.1:1/${name}`);
  try {
    const r = await runPreflight({ env: { DATABASE_URL: `postgres://clutch:FICTIONAL-pass-9@127.0.0.1:1/${name}` }, target: "production", online: true, db: bad.probe, routes: [], crons: [] });
    assert.equal(st(r, "database.connect"), "BLOCKED");
    assert.ok(!JSON.stringify(r).includes("FICTIONAL-pass-9"));
  } finally {
    await bad.end();
  }
});
