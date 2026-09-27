import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { liveSlice } from "@/lib/data";
import { NormalizedLiveStore } from "@/lib/data/normalized/store";
import { LifecycleError } from "@/lib/domain/transitions";
import { toPublicProfile } from "@/lib/domain/public-profile";
import { checksNow, DISCLOSURE_VERSION, snapshotKey } from "@/lib/domain/disclosure";
import type { Quote } from "@/lib/domain/types";

/**
 * The 2026-09-26 booking policy in the normalized store, across two independent app instances
 * (disposable Postgres): unverified mechanics are bookable only with the customer's
 * acknowledgement, which the database keeps with the job and won't let anyone change.
 */

const url = process.env.DATABASE_URL!;
assert.match(url, /127\.0\.0\.1:\d+\/clutch_test$/, "only ever the disposable test database");
const A = NormalizedLiveStore.connect(url, { reads: "targeted" });
const B = NormalizedLiveStore.connect(url, { reads: "targeted" });
const db = postgres(url, { prepare: false, max: 3, onnotice: () => undefined });
after(async () => {
  await Promise.all([A.end(), B.end(), db.end({ timeout: 5 })]);
});

let n = 0;
const uid = (p: string) => `vpdb-${p}-${process.pid}-${++n}`;

/** A fresh request on instance A: an unverified mechanic (complete profile, no checks), a customer, a sent estimate. */
async function setup() {
  const a = liveSlice(A).repo;
  const mu = await a.createUser({ id: uid("mu"), name: "Uma Unverified", email: `${uid("m")}@example.test`, role: "mechanic" });
  const m = await a.upsertMechanicProfile({ userId: mu.id, displayName: `Uma Unverified ${n}`, city: "Los Angeles", neighborhood: "mid-city", serviceRadiusMi: 15, bio: "", workModel: "mobile", declaredRepairCategories: ["brakes"], declaredMakes: ["BMW"], hourlyRateCents: 9000, diagnosticFeeCents: 5000, availabilityNote: "Weekdays" });
  const cu = await a.createUser({ id: uid("cu"), name: "Casey", email: `${uid("c")}@example.test`, role: "customer" });
  const c = a.getCustomerByUser(cu.id)!;
  const v = await a.addVehicle(c.id, { year: 2016, make: "BMW", model: "328i" });
  const r = await a.createRequest({ customerId: c.id, vehicleId: v.id, repairCategory: "brakes", categorySource: "customer", symptomDescription: "Grinding when braking.", occurrence: { conditions: [] }, onset: {}, warningLights: [], diagnosticCodes: [], smells: [], recentRepairs: [], customerParts: [], location: { serviceMode: "mobile", area: "mid-city" }, media: [] });
  if (!r.matchedMechanicIds.includes(m.id)) await a.forwardRequest(r.id, [m.id], "broaden");
  const body: Omit<Quote, "id" | "status" | "createdAt" | "customerQuestions"> = { requestId: r.id, mechanicId: m.id, laborCents: 30000, diagnosticFeeCents: 5000, travelFeeCents: 0, partsIncluded: true, partsEstimateCents: 12000, durationHours: 2, availableOn: "Tue", availableAt: { date: "2026-09-29", time: "09:00" }, serviceMode: "mobile", scope: "Pads." };
  const q = await a.submitQuote(body);
  return { m, c, q, r };
}

/** What the confirmation step would show: the mechanic's checks read fresh on this instance. */
async function ackOn(store: NormalizedLiveStore, slug: string) {
  const ctx = liveSlice(store);
  await ctx.needs({ staff: false }).publicProfile(slug);
  const p = ctx.repo.getPublicProfile(slug)!;
  return { version: DISCLOSURE_VERSION, snapshot: snapshotKey(checksNow(p)) };
}

test("an unverified mechanic is matched and bookable; without the acknowledgement nothing is booked", async () => {
  const { m, c, q, r } = await setup();
  const got = await db<{ n: number }[]>`select count(*)::int as n from lv_request_invitations where request_id = ${r.id} and mechanic_id = ${m.id}`;
  assert.equal(got[0].n, 1);
  await assert.rejects(liveSlice(B).repo.acceptQuote(q.id, c.id), (e: unknown) => e instanceof LifecycleError && e.code === "invalid_input");
  assert.equal((await db<{ n: number }[]>`select count(*)::int as n from lv_jobs where request_id = ${r.id}`)[0].n, 0);
});

test("with the acknowledgement: one job, the record in the job and the history, and the database keeps it unchangeable", async () => {
  const { m, c, q, r } = await setup();
  const ack = await ackOn(A, m.slug);
  // Double submit on both instances: one booking.
  const [j1, j2] = await Promise.all([liveSlice(A).repo.acceptQuote(q.id, c.id, undefined, ack), liveSlice(B).repo.acceptQuote(q.id, c.id, undefined, ack)]);
  assert.equal(j1.id, j2.id);
  const [row] = await db<{ v: { fullyVerified: boolean; acknowledgement: { version: string; customerId: string; disclosure: string } } }[]>`select data->'verificationAtBooking' as v from lv_jobs where request_id = ${r.id}`;
  assert.equal(row.v.fullyVerified, false);
  assert.equal(row.v.acknowledgement.version, DISCLOSURE_VERSION);
  assert.equal(row.v.acknowledgement.customerId, c.id);
  assert.ok(row.v.acknowledgement.disclosure.includes("- Insurance not verified by Clutch"), row.v.acknowledgement.disclosure);
  const hist = await db<{ detail: string }[]>`select detail from lv_history where entity_type = 'job' and entity_id = ${j1.id} and action = 'acknowledged unverified checks'`;
  assert.equal(hist.length, 1);
  assert.ok(hist[0].detail.startsWith(DISCLOSURE_VERSION));
  // Nobody can change or remove it afterwards, not even with direct SQL.
  await assert.rejects(db`update lv_jobs set data = jsonb_set(data, '{verificationAtBooking,fullyVerified}', 'true') where id = ${j1.id}`, /lv_booking_verification_frozen/);
  await assert.rejects(db`update lv_jobs set data = data - 'verificationAtBooking' where id = ${j1.id}`, /lv_booking_verification_frozen/);
  // Ordinary job updates still work, and leave it as it was.
  await liveSlice(B).repo.confirmAppointment(j1.id, m.id);
  const [after] = await db<{ v: unknown }[]>`select data->'verificationAtBooking' as v from lv_jobs where id = ${j1.id}`;
  assert.deepEqual(after.v, row.v);
});

test("the database refuses a job recorded as unverified without an acknowledgement, whatever wrote it", async () => {
  const { m, c, q, r } = await setup();
  await assert.rejects(
    db.begin(async (tx) => {
      await tx`insert into lv_jobs ${tx({ id: uid("job"), quote_id: q.id, request_id: r.id, mechanic_id: m.id, customer_id: c.id, status: "scheduled", data: tx.json({ verificationAtBooking: { checks: [], fullyVerified: false, capturedAt: "2026-09-26" } }) })}`;
    }),
    /lv_booking_unacknowledged/,
  );
});

test("the checks change on one instance between reading and booking on the other: the old acknowledgement is refused", async () => {
  const { m, c, q } = await setup();
  const read = await ackOn(A, m.slug);
  // On instance B, insurance is submitted and staff verify it.
  const b = liveSlice(B).repo;
  const su = await b.createUser({ id: uid("staff"), name: "Sky Staff", email: `${uid("s")}@example.test`, role: "customer" });
  await b.grantAdmin(su.id);
  await b.submitInsurance(m.id, { carrier: "Test Mutual", expiresOn: "2027-12-31", documentIds: ["doc-test"] });
  const [ver] = await db<{ id: string }[]>`select id from lv_verifications where mechanic_id = ${m.id} and category = 'insurance' and status = 'submitted'`;
  await b.decideVerification(ver.id, "approve", su.id, { reasonCode: "evidence_matches", expiresAt: "2027-12-31" });
  await assert.rejects(liveSlice(A).repo.acceptQuote(q.id, c.id, undefined, read), /changed since you reviewed it/);
  const fresh = await ackOn(A, m.slug);
  assert.notEqual(fresh.snapshot, read.snapshot);
  const job = await liveSlice(A).repo.acceptQuote(q.id, c.id, undefined, fresh);
  assert.ok(job.verificationAtBooking!.checks.find((x) => x.key === "insurance")!.verified, "the booking records what the customer re-read");
});

test("status-at-booking survives the mechanic becoming fully verified later; the current status is read separately", async () => {
  const { m, c, q } = await setup();
  const job = await liveSlice(A).repo.acceptQuote(q.id, c.id, undefined, await ackOn(A, m.slug));
  // Later: every check verified, as a connected provider and staff would record them.
  await A.transact(
    () => {
      const d = A.current();
      for (const kind of ["identity", "background", "driving_record"] as const) d.screenings.push({ id: uid(`scr-${kind}`), mechanicId: m.id, kind, provider: "provider-under-test", providerRef: "r", status: "verified", result: "clear", completedAt: "2026-09-26", expiresAt: "2027-09-26" });
    },
    async () => undefined,
  );
  const ctx = liveSlice(B);
  await ctx.needs({ userId: c.userId, customerId: c.id, staff: false }).customerJob(job.id);
  const now = checksNow(toPublicProfile(ctx.repo.getMechanicSources(m.id)));
  assert.ok(now.find((x) => x.key === "identity")!.verified, "now verified");
  assert.equal(ctx.repo.getJob(job.id)!.verificationAtBooking!.checks.find((x) => x.key === "identity")!.status, "Not completed", "at booking it wasn't, and that's what's kept");
});
