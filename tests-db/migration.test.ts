import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { repoOver } from "@/lib/data";
import { emptyDB } from "@/lib/data/store";
import { MockRepository } from "@/lib/data/mock/repository";
import type { DB } from "@/lib/data/mock/seed";
import { exportToSnapshot, migrateLive } from "@/lib/data/normalized/migrate";
import { NormalizedLiveStore, stable } from "@/lib/data/normalized/store";
import { recordsOf } from "@/lib/data/normalized/spec";

/**
 * Snapshot → normalized migration on a separate disposable database: dry run keeps nothing,
 * apply is backup-first and complete, re-runs are idempotent, a failure mid-way keeps nothing,
 * bad rows are quarantined (not dropped), and export writes back for rollback.
 */

const base = process.env.DATABASE_URL!;
assert.match(base, /127\.0\.0\.1:\d+\/clutch_test$/);
const url = base.replace(/\/clutch_test$/, "/clutch_migration_test");
const admin = postgres(base, { prepare: false, max: 1, onnotice: () => undefined });
let sql: postgres.Sql;

/** A realistic live snapshot built with the domain logic itself, plus deliberately broken rows. */
function buildSnapshot(): { db: DB; broken: string[] } {
  const db = emptyDB();
  const r = new MockRepository("live", () => db);
  const u = r.createUser({ id: "real-1", name: "Robin Real", email: "real1@example.test", role: "customer" });
  const c = r.getCustomerByUser(u.id)!;
  const v = r.addVehicle(c.id, { year: 2008, make: "BMW", model: "135i" });
  const mu = r.createUser({ id: "real-mech-1", name: "Quinn Real", email: "realmech1@example.test", role: "mechanic" });
  const m = r.upsertMechanicProfile({ userId: mu.id, displayName: "Quinn Real", city: "Los Angeles", neighborhood: "mid-city", serviceRadiusMi: 15, bio: "", workModel: "mobile", declaredRepairCategories: ["brakes"], declaredMakes: ["BMW"], hourlyRateCents: 9000, diagnosticFeeCents: 5000, availabilityNote: "Weekdays" });
  // Bookable, as a connected provider and staff would have recorded it.
  for (const kind of ["identity", "background", "driving_record"] as const) db.screenings.push({ id: `scr-${kind}`, mechanicId: m.id, kind, provider: "provider-under-test", providerRef: kind, status: "verified", result: "clear", completedAt: "2026-09-01", expiresAt: "2027-09-01" });
  db.insurance.push({ id: "ins-1", mechanicId: m.id, carrier: "Test", policyLast4: "0000", coverageCents: 1, documentName: "coi.pdf", effectiveOn: "2026-01-01", expiresOn: "2027-12-31" });
  db.verifications.push({ id: "ver-ins", mechanicId: m.id, subjectType: "insurance_record", subjectId: "ins-1", category: "insurance", method: "document_review", status: "verified", submittedAt: "2026-09-01", verifiedAt: "2026-09-01" } as never);
  const base = { customerId: c.id, vehicleId: v.id, repairCategory: "brakes" as const, categorySource: "customer" as const, symptomDescription: "Grinding when braking.", occurrence: { conditions: [] }, onset: {}, warningLights: [], diagnosticCodes: [], smells: [], recentRepairs: [], customerParts: [], location: { serviceMode: "mobile" as const, area: "mid-city" }, media: [] };
  const req = r.createRequest(base);
  const q = r.submitQuote({ requestId: req.id, mechanicId: m.id, laborCents: 30000, diagnosticFeeCents: 5000, travelFeeCents: 0, partsIncluded: true, partsEstimateCents: 12000, durationHours: 2, availableOn: "Tue", serviceMode: "mobile", scope: "Pads" });
  const job = r.acceptQuote(q.id, c.id);
  r.startJob(job.id, m.id);
  r.markJobDone(job.id, m.id, 35000);
  r.completeJob(job.id, c.id, { status: "paid", amountCents: 35000 });
  r.submitReview(job.id, c.id, { overall: 5, comment: "Great" });
  r.updateReview(job.id, c.id, { overall: 4, comment: "Good" });
  const open = r.createRequest({ ...base, symptomDescription: "Squeal at low speed." });
  r.createSupportReport({ userId: u.id, reporterRole: "customer", topic: "price", details: "A question about the price.", jobId: job.id });
  r.saveDraft(c.id, { step: 1 } as never);
  r.toggleSaved(c.id, m.id);
  r.setCustomerNote(m.id, c.id, "Prefers texts.");

  // Broken rows, as an older build or a bad import could have left them.
  const u2 = r.createUser({ id: "real-2", name: "Other Person", email: "real2@example.test", role: "customer" });
  const c2 = r.getCustomerByUser(u2.id)!;
  db.quotes.push({ ...structuredClone(q), id: "quote-uninvited", requestId: open.id, mechanicId: "mech-not-invited", status: "submitted" } as never);
  db.jobs.push({ ...structuredClone(job), id: "job-wrong-customer", quoteId: "quote-x", customerId: c2.id } as never);
  db.requests.push({ ...structuredClone(open), id: "req-others-car", customerId: c2.id, vehicleId: v.id, history: [] } as never);
  db.users.push({ id: "demo-leak", demo: true, roles: ["customer"], email: "maya@clutch.demo", name: "Maya", notificationPrefs: { email: true, sms: false, push: false } } as never);
  db.notifications.push({ id: "ntf-orphan", userId: "nobody", mode: "customer", kind: "new_quote", title: "x", href: "/", createdAt: "2026-09-01", read: false });
  return { db, broken: ["quotes:quote-uninvited", "jobs:job-wrong-customer", "requests:req-others-car", "users:demo-leak", "notifications:ntf-orphan"] };
}

async function writeSnapshot(db: DB) {
  await sql`delete from app_records where scope = 'live'`;
  for (const { spec, id, doc } of recordsOf(db).values()) {
    if (spec.map) continue;
    await sql`insert into app_records (scope, collection, id, data) values ('live', ${spec.collection}, ${id}, ${sql.json(doc as postgres.JSONValue)})`;
  }
  for (const f of ["profileShares", "drafts", "customerNotes"] as const) await sql`insert into app_records (scope, collection, id, data) values ('live', '_kv', ${f}, ${sql.json(db[f] as unknown as postgres.JSONValue)})`;
  await sql`insert into app_meta (key, version) values ('main', 3) on conflict (key) do nothing`;
}

let snap: ReturnType<typeof buildSnapshot>;
before(async () => {
  await admin`drop database if exists clutch_migration_test`;
  await admin`create database clutch_migration_test`;
  sql = postgres(url, { prepare: false, max: 3, onnotice: () => undefined });
  for (const f of ["0002_app_store.sql", "0003_data_scope.sql"]) await sql.unsafe(readFileSync(`supabase/migrations/${f}`, "utf8"));
  snap = buildSnapshot();
  await writeSnapshot(snap.db);
});
after(async () => {
  await sql.end({ timeout: 5 });
  await admin`drop database if exists clutch_migration_test with (force)`;
  await admin.end({ timeout: 5 });
});

const rowCount = async (t: string) => Number((await sql<{ n: string }[]>`select count(*)::text as n from ${sql(t)}`)[0].n);

test("dry run checks every row against the database rules and keeps nothing", async () => {
  const r = await migrateLive(sql, "dry_run");
  assert.equal(r.unaccounted.length, 0);
  assert.deepEqual(r.quarantine.map((q) => `${q.collection}:${q.id}`).sort(), [...snap.broken].sort());
  assert.ok(r.perCollection.jobs.inserted >= 1 && r.perCollection.reviews.inserted === 1);
  // Even the tables it created were rolled back.
  assert.equal((await sql`select to_regclass('lv_users') as t`)[0].t, null, "nothing kept");
  assert.equal(Number((await sql`select count(*)::text as n from app_scope_backup`)[0].n), 0, "no backup on a dry run");
});

test("a failure part-way through apply keeps nothing, and a rerun then succeeds", async () => {
  // Another session holds a lock the migration needs near the end; it times out and aborts.
  const blocker = postgres(url, { prepare: false, max: 1, onnotice: () => undefined });
  const migrator = postgres(url, { prepare: false, max: 1, onnotice: () => undefined, connection: { lock_timeout: 300 } });
  await sql.unsafe(readFileSync("supabase/migrations/0004_live_normalized.sql", "utf8"));
  let release!: () => void;
  const held = blocker.begin(async (tx) => {
    await tx`lock table lv_uploads in access exclusive mode`;
    await new Promise<void>((res) => (release = res));
  });
  await new Promise((r) => setTimeout(r, 100));
  await assert.rejects(migrateLive(migrator, "apply"), /lock timeout|canceling statement/);
  release();
  await held;
  await Promise.all([blocker.end(), migrator.end()]);
  assert.equal(await rowCount("lv_users"), 0, "nothing from the failed run");
  assert.equal(Number((await sql`select count(*)::text as n from app_scope_backup`)[0].n), 0, "its backup rolled back too");
});

test("apply is backup-first and complete; every record is migrated or quarantined; history is preserved", async () => {
  const snapshotRows = Number((await sql`select count(*)::text as n from app_records where scope = 'live'`)[0].n);
  const r = await migrateLive(sql, "apply");
  assert.equal(r.backupRows, snapshotRows);
  assert.equal(r.unaccounted.length, 0);
  assert.equal(r.history.normalizedEntries, r.history.migratedEntries, "every history line of every migrated record");
  assert.equal(r.history.migratedEntries + r.history.quarantinedEntries, r.history.snapshotEntries, "and the rest kept with their quarantined records");
  const q = await sql<{ collection: string; id: string; reason: string }[]>`select collection, id, reason from lv_quarantine order by collection, id`;
  assert.deepEqual(q.map((x) => `${x.collection}:${x.id}`).sort(), [...snap.broken].sort());
  assert.ok(q.every((x) => x.reason.length > 0));
  for (const [c, s] of Object.entries(r.perCollection)) assert.equal(s.inserted + s.quarantined, s.snapshot, `${c} accounted for`);
  assert.equal(await rowCount("lv_review_edits"), 1);
  assert.equal(await rowCount("lv_quote_versions"), 1);
  assert.ok((await rowCount("lv_job_payment_reports")) >= 1);
  // The old snapshot is untouched: still the rollback source.
  assert.equal(Number((await sql`select count(*)::text as n from app_records where scope = 'live'`)[0].n), snapshotRows);
});

test("a rerun changes nothing and duplicates nothing", async () => {
  const before = await rowCount("lv_history");
  const r = await migrateLive(sql, "apply");
  for (const [c, s] of Object.entries(r.perCollection)) {
    assert.equal(s.inserted, 0, `${c}: nothing new`);
    assert.equal(s.alreadyPresent + s.previouslyQuarantined, s.snapshot, `${c}: all recognized`);
  }
  assert.equal(await rowCount("lv_history"), before);
});

test("a rerun after the snapshot moved on brings copied rows up to date, and new records are added", async () => {
  // The app is still on the snapshot path: a user renamed, a request cancelled, a new customer.
  const doc = (await sql<{ data: Record<string, unknown> }[]>`select data from app_records where scope = 'live' and collection = 'users' and id = 'real-1'`)[0].data;
  await sql`update app_records set data = ${sql.json({ ...doc, name: "Robin Renamed" } as postgres.JSONValue)} where scope = 'live' and collection = 'users' and id = 'real-1'`;
  const open = snap.db.requests.find((x) => x.symptomDescription.startsWith("Squeal"))!;
  const cancelled = { ...open, status: "cancelled", cancelledAt: "2026-09-26", history: [...(open.history ?? []), { at: "2026-09-26T00:00:00Z", by: "customer", action: "cancelled" }] };
  await sql`update app_records set data = ${sql.json(cancelled as unknown as postgres.JSONValue)} where scope = 'live' and collection = 'requests' and id = ${open.id}`;
  await sql`insert into app_records (scope, collection, id, data) values ('live', 'users', 'real-3', ${sql.json({ id: "real-3", roles: [], email: "real3@example.test", name: "New Person", notificationPrefs: { email: true, sms: false, push: false } })})`;
  const r = await migrateLive(sql, "apply");
  assert.equal(r.perCollection.users.refreshed, 1);
  assert.equal(r.perCollection.users.inserted, 1);
  assert.equal(r.perCollection.requests.refreshed, 1);
  assert.equal((await sql`select name from lv_users where id = 'real-1'`)[0].name, "Robin Renamed");
  assert.equal((await sql`select status from lv_requests where id = ${open.id}`)[0].status, "cancelled");
  assert.equal((await sql`select version::int as v from lv_users where id = 'real-1'`)[0].v, 1, "still marked as copied from the snapshot");
  // Put the snapshot back as it was for the next tests.
  await sql`update app_records set data = ${sql.json(open as unknown as postgres.JSONValue)} where scope = 'live' and collection = 'requests' and id = ${open.id}`;
});

test("the normalized store serves exactly the migrated records, and work continues on them", async () => {
  const store = NormalizedLiveStore.connect(url, { cacheMs: 0, reads: "snapshot" });
  try {
    await store.ready("force");
    const got = recordsOf(store.current());
    const broken = new Set(snap.broken);
    const refreshed = new Set(["users\u0000real-1", `requests\u0000${snap.db.requests.find((x) => x.symptomDescription.startsWith("Squeal"))!.id}`]);
    for (const [key, rec] of recordsOf(snap.db)) {
      if (broken.has(`${rec.spec.collection}:${rec.id}`) || refreshed.has(key)) continue;
      assert.equal(stable(got.get(key)?.doc), stable(rec.doc), `${key} identical after migration`);
    }
    assert.equal(store.current().users.find((x) => x.id === "real-1")?.name, "Robin Renamed", "the refreshed copy");
    const repo = repoOver("live", store);
    await repo.updateUser("real-1", { name: "Robin Updated" });
    // Written by the normalized app now (version 2): a later migration rerun must not overwrite it.
    const r = await migrateLive(sql, "apply");
    assert.equal(r.perCollection.users.differs, 1);
    assert.equal((await sql`select name from lv_users where id = 'real-1'`)[0].name, "Robin Updated");
  } finally {
    await store.end();
  }
});

test("export writes the normalized records back into the snapshot for rollback, after a backup", async () => {
  const beforeRows = Number((await sql`select count(*)::text as n from app_records where scope = 'live'`)[0].n);
  const r = await exportToSnapshot(sql);
  assert.equal(r.backupRows, beforeRows);
  const [u] = await sql<{ name: string }[]>`select data->>'name' as name from app_records where scope = 'live' and collection = 'users' and id = 'real-1'`;
  assert.equal(u.name, "Robin Updated", "changes made on the normalized store reach the snapshot");
  const after = Number((await sql`select count(*)::text as n from app_records where scope = 'live'`)[0].n);
  assert.ok(after >= beforeRows, "nothing removed from the snapshot");
  assert.ok(Number((await sql`select count(*)::text as n from app_records where scope = 'live' and id = 'demo-leak'`)[0].n) === 1, "quarantined rows stay in the snapshot");
});
