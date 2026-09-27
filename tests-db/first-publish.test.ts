import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { liveSlice } from "@/lib/data";
import { NormalizedLiveStore } from "@/lib/data/normalized/store";

/**
 * A customer's request saved while no mechanic fits is sent to a new mechanic the moment they
 * first publish a fitting profile (onboarding publishes everything in one step). On its own
 * disposable database, so no other suite's mechanics already cover the request.
 */

const base = process.env.DATABASE_URL!;
assert.match(base, /127\.0\.0\.1:\d+\/clutch_test$/, "only ever the disposable test database");
const url = base.replace(/\/clutch_test$/, "/clutch_first_publish_test");
const admin = postgres(base, { prepare: false, max: 1, onnotice: () => undefined });
let A: NormalizedLiveStore;
let B: NormalizedLiveStore;
let db: postgres.Sql;

before(async () => {
  await admin`drop database if exists clutch_first_publish_test with (force)`;
  await admin`create database clutch_first_publish_test`;
  db = postgres(url, { prepare: false, max: 2, onnotice: () => undefined });
  for (const f of ["0002_app_store.sql", "0003_data_scope.sql"]) await db.unsafe(readFileSync(`supabase/migrations/${f}`, "utf8"));
  A = NormalizedLiveStore.connect(url, { reads: "targeted" });
  B = NormalizedLiveStore.connect(url, { reads: "targeted" });
});
after(async () => {
  await Promise.all([A.end(), B.end(), db.end({ timeout: 5 })]);
  await admin`drop database if exists clutch_first_publish_test with (force)`;
  await admin.end({ timeout: 5 });
});

test("a request saved while nobody fits is sent to a new mechanic the moment they first publish a fitting profile", async () => {
  const a = liveSlice(A).repo;
  const cu = await a.createUser({ id: "fp-cust", name: "Casey", email: "fp-cust@example.test", role: "customer" });
  const c = a.getCustomerByUser(cu.id)!;
  const v = await a.addVehicle(c.id, { year: 2016, make: "BMW", model: "328i" });
  const r = await a.createRequest({ customerId: c.id, vehicleId: v.id, repairCategory: "brakes", categorySource: "customer", symptomDescription: "Grinding when braking.", occurrence: { conditions: [] }, onset: {}, warningLights: [], diagnosticCodes: [], smells: [], recentRepairs: [], customerParts: [], location: { serviceMode: "mobile", area: "long-beach" }, media: [] });
  assert.deepEqual(r.matchedMechanicIds, [], "nobody fits yet: saved, not sent");
  // First publish of a fitting profile, on another app instance.
  const b = liveSlice(B).repo;
  const mu = await b.createUser({ id: "fp-mech", name: "Morgan", email: "fp-mech@example.test", role: "mechanic" });
  const m = await b.upsertMechanicProfile({ userId: mu.id, displayName: "Morgan Newcomer", city: "Long Beach", neighborhood: "long-beach", serviceRadiusMi: 10, bio: "", workModel: "mobile", declaredRepairCategories: ["brakes"], declaredMakes: ["BMW"], hourlyRateCents: 9000, diagnosticFeeCents: 5000, availabilityNote: "Weekdays" });
  const [row] = await db<{ n: number }[]>`select count(*)::int as n from lv_request_invitations where request_id = ${r.id} and mechanic_id = ${m.id}`;
  assert.equal(row.n, 1, "sent to the new mechanic");
  const [n] = await db<{ n: number }[]>`select count(*)::int as n from lv_notifications where user_id = ${mu.id} and data->>'kind' = 'new_opportunity'`;
  assert.equal(n.n, 1, "and they're told");
});
