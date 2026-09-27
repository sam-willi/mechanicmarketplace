import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { liveSlice } from "@/lib/data";
import { NormalizedLiveStore, canonicalVerificationSchema } from "@/lib/data/normalized/store";

/**
 * 0009_verification_canonical.sql on a real Postgres: rows written with the older status words
 * are rewritten in place (nothing deleted), re-applying changes nothing, the database refuses the
 * old words afterwards, and the SQL expiry rule matches lib/verification/model.ts. Then a full
 * review cycle runs through the normalized store with the history kept. Its own database.
 */

const base = process.env.DATABASE_URL!;
assert.match(base, /127\.0\.0\.1:\d+\/clutch_test$/, "only ever the disposable test database");
const url = base.replace(/\/clutch_test$/, "/clutch_verification_canonical_test");
const admin = postgres(base, { prepare: false, max: 1, onnotice: () => undefined });
let A: NormalizedLiveStore;
let db: postgres.Sql;

before(async () => {
  await admin`drop database if exists clutch_verification_canonical_test with (force)`;
  await admin`create database clutch_verification_canonical_test`;
  db = postgres(url, { prepare: false, max: 2, onnotice: () => undefined });
  for (const f of ["0002_app_store.sql", "0003_data_scope.sql"]) await db.unsafe(readFileSync(`supabase/migrations/${f}`, "utf8"));
  A = NormalizedLiveStore.connect(url, { reads: "targeted" });
  await A.ensureSchema();
});
after(async () => {
  await Promise.all([A.end(), db.end({ timeout: 5 })]);
  await admin`drop database if exists clutch_verification_canonical_test with (force)`;
  await admin.end({ timeout: 5 });
});

test("0009 rewrites older status words in place, is idempotent, and then refuses them", async () => {
  const a = liveSlice(A).repo;
  const u = await a.createUser({ id: "vc-mech", name: "Vic Chen", email: "vc-mech@example.test", role: "mechanic" });
  const m = await a.upsertMechanicProfile({ userId: u.id, displayName: "Vic Chen", city: "Los Angeles", neighborhood: "mid-city", serviceRadiusMi: 10, bio: "", workModel: "mobile", declaredRepairCategories: ["brakes"], declaredMakes: ["BMW"], hourlyRateCents: 9000, diagnosticFeeCents: 5000, availabilityNote: "Weekdays" });
  // Simulate a database from before: drop the new constraint and write the old words.
  await db`alter table lv_verifications drop constraint if exists lv_verifications_status_check`;
  const old: [string, string, string][] = [
    ["vc-1", "pending", "document_review"],
    ["vc-2", "pending", "vendor_screening"],
    ["vc-3", "needs_info", "document_review"],
    ["vc-4", "rejected", "employer_check"],
    ["vc-5", "not_submitted", "employer_check"],
    ["vc-6", "reverification_required", "document_review"],
  ];
  for (const [id, status, method] of old) {
    const data = { id, mechanicId: m.id, subjectType: "credential", subjectId: `s-${id}`, category: "credential", method, status, notes: `kept ${id}` };
    await db`insert into lv_verifications (id, mechanic_id, subject_type, subject_id, category, status, data) values (${id}, ${m.id}, 'credential', ${`s-${id}`}, 'credential', ${status}, ${db.json(data)})`;
  }
  await db.unsafe(canonicalVerificationSchema());
  const rows = await db<{ id: string; status: string; ds: string; notes: string }[]>`select id, status, data->>'status' as ds, data->>'notes' as notes from lv_verifications where id like 'vc-%' order by id`;
  assert.deepEqual(
    rows.map((r) => [r.id, r.status, r.ds]),
    [
      ["vc-1", "under_review", "under_review"],
      ["vc-2", "in_progress", "in_progress"],
      ["vc-3", "needs_more_info", "needs_more_info"],
      ["vc-4", "failed", "failed"],
      ["vc-5", "not_started", "not_started"],
      ["vc-6", "verified", "verified"],
    ],
  );
  assert.ok(rows.every((r) => r.notes === `kept ${r.id}`), "nothing else in the record changed");
  const before = JSON.stringify(await db`select id, status, data from lv_verifications order by id`);
  await db.unsafe(canonicalVerificationSchema());
  assert.equal(JSON.stringify(await db`select id, status, data from lv_verifications order by id`), before, "re-applying changes nothing");
  await assert.rejects(db`update lv_verifications set status = 'pending' where id = 'vc-1'`, /check constraint/);
  const [e] = await db<{ exp: string; due: string; ok: string; other: string }[]>`select
    lv_effective_status('verified', '2026-09-26', '2026-09-27T12:00:00Z') as exp,
    lv_effective_status('verified', '2026-10-10', '2026-09-27T12:00:00Z') as due,
    lv_effective_status('verified', '2027-09-27', '2026-09-27T12:00:00Z') as ok,
    lv_effective_status('under_review', '2020-01-01', '2026-09-27T12:00:00Z') as other`;
  assert.deepEqual(e, { exp: "expired", due: "renewal_due", ok: "verified", other: "under_review" });
});

test("a full review cycle through the normalized store keeps the history in the database", async () => {
  const a = liveSlice(A).repo;
  const su = await a.createUser({ id: "vc-staff", name: "Sky Staff", email: "staff@example.test", role: "customer" });
  await a.grantAdmin(su.id);
  const [{ id: mechId }] = await db<{ id: string }[]>`select id from lv_mechanics where user_id = 'vc-mech'`;
  await liveSlice(A).repo.submitInsurance(mechId, { carrier: "Test Mutual", policyType: "general_liability", namedInsured: "Vic Chen", effectiveOn: "2026-01-01", expiresOn: "2027-12-31", documentIds: ["doc-vc"] });
  const [v] = await db<{ id: string; status: string }[]>`select id, status from lv_verifications where mechanic_id = ${mechId} and category = 'insurance'`;
  assert.equal(v.status, "submitted");
  await liveSlice(A).repo.decideVerification(v.id, "request_info", su.id, { reasonCode: "document_unreadable", note: "Upload a clearer copy." });
  await liveSlice(A).repo.resubmit(v.id, "Clearer copy", ["doc-vc-2"]);
  await liveSlice(A).repo.decideVerification(v.id, "approve", su.id, { reasonCode: "evidence_matches" });
  const [row] = await db<{ status: string; events: { action: string; to: string; actor: { kind: string } }[]; docs: string[] }[]>`select status, data->'events' as events, data->'documentIds' as docs from lv_verifications where id = ${v.id}`;
  assert.equal(row.status, "verified");
  assert.deepEqual(row.events.map((e) => e.action), ["created", "submitted", "requested_info", "submitted", "review_started", "approved"]);
  assert.deepEqual(row.docs, ["doc-vc", "doc-vc-2"], "both documents kept");
  const [email] = await db<{ n: number }[]>`select count(*)::int as n from lv_verifications where mechanic_id = ${mechId} and category = 'email' and status = 'verified'`;
  assert.equal(email.n, 1, "the email check was recorded when the profile was created");
});
