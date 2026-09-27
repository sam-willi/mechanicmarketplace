import { test as nodeTest, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import postgres from "postgres";
import { liveSlice, repoOver } from "@/lib/data";
import { NormalizedLiveStore } from "@/lib/data/normalized/store";
import type { Reader } from "@/lib/data/normalized/reader";
import { LifecycleError } from "@/lib/domain/transitions";
import type { Quote } from "@/lib/domain/types";

/**
 * Run twice (normalized.test.ts, normalized-targeted.test.ts): with targeted reads (the
 * default: per-request slices, per-write plans) and with the snapshot cache (the explicit
 * rollback path). The write guarantees must hold identically in both.
 *
 * Two independent store instances (separate connection pools and caches, like two app
 * servers) against one disposable Postgres (scripts/run-db-tests.mjs), plus a separate OS
 * process. Proves the lifecycle guarantees hold in the database, not in process memory.
 */

const url = process.env.DATABASE_URL!;
assert.match(url, /127\.0\.0\.1:\d+\/clutch_test$/, "only ever the disposable test database");
const MODE: "targeted" | "snapshot" = (globalThis as { __clutchTestReads?: string }).__clutchTestReads === "targeted" ? "targeted" : "snapshot";
const A = NormalizedLiveStore.connect(url, { cacheMs: 0, reads: MODE });
const B = NormalizedLiveStore.connect(url, { cacheMs: 0, reads: MODE });
const repoOf = (store: NormalizedLiveStore) => (MODE === "targeted" ? liveSlice(store).repo : repoOver("live", store));
const ra = repoOf(A);
const rb = repoOf(B);
const test = (name: string, fn: () => Promise<void>) => nodeTest(`[${MODE}] ${name}`, fn);
const db = postgres(url, { prepare: false, max: 3, onnotice: () => undefined });
after(async () => {
  await Promise.all([A.end(), B.end(), db.end({ timeout: 5 })]);
});

let n = 0;
const uid = (p: string) => `${p}-${process.pid}-${++n}`;
const count = async (q: postgres.PendingQuery<postgres.Row[]>) => Number((await q)[0].n);

async function customer() {
  await A.ready("force");
  const id = uid("cust");
  const u = await ra.createUser({ id, name: `Casey ${n}`, email: `${id}@example.test`, role: "customer" });
  const c = ra.getCustomerByUser(u.id)!;
  const v = await ra.addVehicle(c.id, { year: 2016, make: "BMW", model: "328i" });
  return { u, c, v };
}

/** A bookable fictional mechanic: its screening and insurance as a connected provider and staff would record them. */
async function mechanic() {
  const id = uid("mech");
  const u = await ra.createUser({ id, name: `Morgan ${n}`, email: `${id}@example.test`, role: "mechanic" });
  const m = await ra.upsertMechanicProfile({ userId: u.id, displayName: `Morgan Test${n}`, city: "Los Angeles", neighborhood: "mid-city", serviceRadiusMi: 15, bio: "", workModel: "mobile", declaredRepairCategories: ["brakes"], declaredMakes: ["BMW"], hourlyRateCents: 9000, diagnosticFeeCents: 5000, availabilityNote: "Weekdays" });
  await A.transact(() => {
    const d = A.current();
    for (const kind of ["identity", "background", "driving_record"] as const) d.screenings.push({ id: uid("scr"), mechanicId: m.id, kind, provider: "provider-under-test", providerRef: uid("ref"), status: "verified", result: "clear", completedAt: "2026-09-20", expiresAt: "2027-09-20" });
    const ins = { id: uid("ins"), mechanicId: m.id, carrier: "Test Mutual", policyLast4: "0000", coverageCents: 100_000_000, documentName: "coi.pdf", effectiveOn: "2026-01-01", expiresOn: "2027-12-31" };
    d.insurance.push(ins);
    d.verifications.push({ id: uid("ver"), mechanicId: m.id, subjectType: "insurance_record", subjectId: ins.id, category: "insurance", method: "document_review", status: "verified", submittedAt: "2026-09-20", verifiedAt: "2026-09-20" } as never);
  });
  return ra.getMechanic(m.id)!;
}

async function request(customerId: string, vehicleId: string, mechanics: string[], key?: string) {
  const r = await ra.createRequest({
    customerId,
    vehicleId,
    repairCategory: "brakes",
    categorySource: "customer",
    symptomDescription: "Grinding from the front when braking.",
    occurrence: { conditions: [] },
    onset: {},
    warningLights: [],
    diagnosticCodes: [],
    smells: [],
    recentRepairs: [],
    customerParts: [],
    location: { serviceMode: "mobile", area: "mid-city" },
    media: [],
    idempotencyKey: key,
  });
  const missing = mechanics.filter((m) => !r.matchedMechanicIds.includes(m));
  if (missing.length) await ra.forwardRequest(r.id, missing, "broaden");
  return ra.getRequest(r.id)!;
}

const quoteBody = (requestId: string, mechanicId: string, laborCents = 30000): Omit<Quote, "id" | "status" | "createdAt" | "customerQuestions"> => ({
  requestId,
  mechanicId,
  laborCents,
  diagnosticFeeCents: 5000,
  travelFeeCents: 0,
  partsIncluded: true,
  partsEstimateCents: 12000,
  durationHours: 2,
  availableOn: "Tue, Sep 29 · 9:00 AM",
  availableAt: { date: "2026-09-29", time: "09:00" },
  serviceMode: "mobile",
  scope: "Replace front pads and rotors.",
});

async function scenario() {
  const [a, b] = [await mechanic(), await mechanic()];
  const { c, v } = await customer();
  const r = await request(c.id, v.id, [a.id, b.id]);
  const qa = await ra.submitQuote(quoteBody(r.id, a.id));
  const qb = await ra.submitQuote(quoteBody(r.id, b.id, 28000));
  return { a, b, c, v, r, qa, qb };
}

test("the schema applies twice without change (idempotent) and has the core constraints", async () => {
  await A.ensureSchema();
  await NormalizedLiveStore.connect(url).ensureSchema();
  const idx = await db`select indexname from pg_indexes where indexname in ('lv_quotes_one_accepted', 'lv_jobs_one_active', 'lv_requests_idempotency', 'lv_past_repairs_one_per_job')`;
  assert.equal(idx.length, 4);
});

test("unrelated writes from two instances are both kept (no lost updates)", async () => {
  const x = await customer();
  const y = await customer();
  await B.ready("force"); // B's cache now predates everything below
  await Promise.all([ra.updateUser(x.u.id, { name: "Written by A" }), rb.updateUser(y.u.id, { name: "Written by B" })]);
  // B writes again from its (now stale) cache on a different row; A's write must survive.
  await ra.updateVehicle(x.v.id, { mileage: 1111 });
  await rb.updateVehicle(y.v.id, { mileage: 2222 });
  const rows = await db<{ id: string; name: string }[]>`select id, name from lv_users where id in (${x.u.id}, ${y.u.id}) order by id`;
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.id, r.name])), { [x.u.id]: "Written by A", [y.u.id]: "Written by B" });
  const veh = await db<{ id: string; m: number }[]>`select id, (data->>'mileage')::int as m from lv_vehicles where id in (${x.v.id}, ${y.v.id})`;
  assert.deepEqual(Object.fromEntries(veh.map((r) => [r.id, r.m])), { [x.v.id]: 1111, [y.v.id]: 2222 });
  // Many concurrent unrelated writes across both instances.
  const people = await Promise.all(Array.from({ length: 6 }, () => customer()));
  await Promise.all(people.map((p, i) => (i % 2 ? ra : rb).updateUser(p.u.id, { name: `Parallel ${i}` })));
  const names = await db<{ name: string }[]>`select name from lv_users where id in ${db(people.map((p) => p.u.id))}`;
  assert.deepEqual(names.map((r) => r.name).sort(), people.map((_, i) => `Parallel ${i}`).sort());
});

test("simultaneous acceptance on two instances: exactly one booking, one accepted estimate", async () => {
  const { c, r, qa, qb } = await scenario();
  await B.ready("force");
  const res = await Promise.allSettled([ra.acceptQuote(qa.id, c.id), rb.acceptQuote(qb.id, c.id)]);
  assert.equal(res.filter((x) => x.status === "fulfilled").length, 1);
  const loser = res.find((x) => x.status === "rejected") as PromiseRejectedResult;
  assert.ok(loser.reason instanceof LifecycleError, String(loser.reason));
  assert.equal(await count(db`select count(*) as n from lv_jobs where request_id = ${r.id} and status <> 'cancelled'`), 1);
  assert.equal(await count(db`select count(*) as n from lv_quotes where request_id = ${r.id} and status = 'accepted'`), 1);
  const [reqRow] = await db<{ status: string }[]>`select status from lv_requests where id = ${r.id}`;
  assert.equal(reqRow.status, "booked");
});

test("the same estimate accepted from two instances (double click, retry): one job, same id", async () => {
  const { c, r, qa } = await scenario();
  const [j1, j2] = await Promise.all([ra.acceptQuote(qa.id, c.id), rb.acceptQuote(qa.id, c.id)]);
  assert.equal(j1.id, j2.id);
  assert.equal(await count(db`select count(*) as n from lv_jobs where request_id = ${r.id}`), 1);
});

test("a stale version is refused across instances; the accepted version is frozen in the database", async () => {
  const { a, c, r, qa } = await scenario();
  await B.ready("force");
  await ra.submitQuote({ ...quoteBody(r.id, a.id, 36000) }); // revised to v2 on instance A
  await assert.rejects(rb.acceptQuote(qa.id, c.id, 1), /revised this estimate/);
  const job = await rb.acceptQuote(qa.id, c.id, 2);
  assert.ok(job.id);
  const versions = await db<{ version: number; total_cents: string }[]>`select version, total_cents::text from lv_quote_versions where quote_id = ${qa.id} order by version`;
  assert.deepEqual(versions.map((v) => [v.version, Number(v.total_cents)]), [[1, 47000], [2, 53000]]);
  await assert.rejects(ra.submitQuote({ ...quoteBody(r.id, a.id, 99000) }), LifecycleError);
  // Even a direct SQL change can't alter an accepted estimate or rewrite its versions.
  await assert.rejects(db`update lv_quotes set total_cents = 1 where id = ${qa.id}`, /lv_frozen_estimate/);
  await assert.rejects(db`update lv_quote_versions set total_cents = 1 where quote_id = ${qa.id}`, /lv_append_only/);
});

test("duplicate submissions of one draft on two instances create one request", async () => {
  const { c, v } = await customer();
  const key = uid("draft");
  const [x, y] = await Promise.all([request(c.id, v.id, [], key), (async () => {
    const r = await rb.createRequest({ customerId: c.id, vehicleId: v.id, repairCategory: "brakes", categorySource: "customer", symptomDescription: "Grinding from the front when braking.", occurrence: { conditions: [] }, onset: {}, warningLights: [], diagnosticCodes: [], smells: [], recentRepairs: [], customerParts: [], location: { serviceMode: "mobile", area: "mid-city" }, media: [], idempotencyKey: key });
    return r;
  })()]);
  assert.equal(x.id, y.id);
  assert.equal(await count(db`select count(*) as n from lv_requests where customer_id = ${c.id} and idempotency_key = ${key}`), 1);
});

test("the database refuses what the rules forbid, even without the app", async () => {
  const { a, b, c, r, qa, qb } = await scenario();
  const job = await ra.acceptQuote(qa.id, c.id);
  const other = await customer();
  // With every trigger switched off, the unique index alone still allows one accepted estimate per request.
  await assert.rejects(
    db.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update lv_quotes set status = 'accepted', accepted_version = 1, accepted_total_cents = 1 where id = ${qb.id}`;
    }),
    /duplicate key|lv_quotes_one_accepted/,
  );
  // And with triggers on, the transition rule refuses it first.
  await assert.rejects(db`update lv_quotes set status = 'accepted', accepted_version = 1 where id = ${qb.id}`, /lv_invalid_transition/);
  await assert.rejects(db`update lv_jobs set status = 'completed' where id = ${job.id}`, /lv_invalid_transition/);
  await assert.rejects(db`update lv_requests set status = 'draft' where id = ${r.id}`, /lv_invalid_transition/);
  await assert.rejects(
    db.begin((tx) => tx`insert into lv_jobs ${tx({ id: uid("job"), quote_id: qb.id, request_id: r.id, mechanic_id: b.id, customer_id: other.c.id, status: "scheduled", data: tx.json({}) })}`),
    /foreign key|violates/,
    "a job can't point at another customer",
  );
  await assert.rejects(db.begin((tx) => tx`insert into lv_reviews ${tx({ id: uid("rev"), job_id: job.id, mechanic_id: a.id, overall: 5, data: tx.json({}) })}`), /lv_review_before_completion/);
  await assert.rejects(db`delete from lv_history where entity_id = ${job.id}`, /lv_append_only/);
  await assert.rejects(db`insert into lv_users ${db({ id: uid("demo"), email: `${uid("d")}@example.test`, name: "Demo", demo: true, data: db.json({}) })}`, /check/);
  await assert.rejects(db`update delivery_outbox set state = 'sent' where provider_message_id is null`, /check/, "nothing can claim delivery without a provider message");
  await assert.rejects(
    db.begin((tx) => tx`insert into lv_quotes ${tx({ id: uid("q"), request_id: r.id, mechanic_id: other.u.id, status: "submitted", version: 1, total_cents: 1, data: tx.json({}) })}`),
    /foreign key|violates/,
    "an estimate only from an invited mechanic",
  );
});

test("a refused or failed write leaves the database unchanged, and the instance recovers", async () => {
  const { u } = await customer();
  const before = await db<{ name: string; version: string }[]>`select name, version::text from lv_users where id = ${u.id}`;
  await assert.rejects(
    A.transact(
      () => {
        const me = A.current().users.find((x) => x.id === u.id)!;
        me.name = "half-applied";
        throw new LifecycleError("refused");
      },
      (r: Reader) => r.user(u.id),
    ),
    LifecycleError,
  );
  const afterRow = await db<{ name: string; version: string }[]>`select name, version::text from lv_users where id = ${u.id}`;
  assert.deepEqual(afterRow, before);
  await A.ready("cache");
  assert.notEqual(ra.getUser(u.id)?.name, "half-applied", "the instance's reads never saw the refused change");
  await ra.updateUser(u.id, { name: "Next write is clean" });
  const [row] = await db<{ name: string }[]>`select name from lv_users where id = ${u.id}`;
  assert.equal(row.name, "Next write is clean");
});

test("a crash in the middle of a write commits nothing; a retry succeeds", async () => {
  const { u, v } = await customer();
  const crashing = NormalizedLiveStore.connect(url, {
    cacheMs: 0,
    reads: MODE,
    // After its first statement, the transaction's database connection is killed from outside (a crash).
    afterFirstWrite: async (tx) => {
      const [{ pid }] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
      await db`select pg_terminate_backend(${pid})`;
    },
  });
  const rc = repoOf(crashing);
  await crashing.ready("force");
  await assert.rejects(
    crashing.transact(
      () => {
        const d = crashing.current();
        d.users.find((x) => x.id === u.id)!.name = "crash A";
        d.vehicles.find((x) => x.id === v.id)!.mileage = 9999;
      },
      async (r: Reader) => void (await Promise.all([r.user(u.id), r.vehicles([v.id])])),
    ),
  );
  const [uRow] = await db<{ name: string }[]>`select name from lv_users where id = ${u.id}`;
  const [vRow] = await db<{ m: number | null }[]>`select (data->>'mileage')::int as m from lv_vehicles where id = ${v.id}`;
  assert.notEqual(uRow.name, "crash A");
  assert.notEqual(vRow.m, 9999, "neither half of the write was kept");
  await crashing.end().catch(() => undefined);
  await ra.updateUser(u.id, { name: "after retry" });
  const [ok] = await db<{ name: string }[]>`select name from lv_users where id = ${u.id}`;
  assert.equal(ok.name, "after retry");
  void rc;
});

test("a separate OS process writing at the same time doesn't lose or clobber anything", async () => {
  const people = await Promise.all(Array.from({ length: 8 }, () => customer()));
  const ids = people.map((p) => p.u.id);
  const child = spawn("npx", ["tsx", "--conditions", "react-server", "tests-db/helper-writer.ts", ...ids.filter((_, i) => i % 2)], { env: { ...process.env, CLUTCH_TEST_READS: MODE }, stdio: ["ignore", "pipe", "inherit"] });
  const childDone = new Promise<number>((res) => child.on("exit", (c) => res(c ?? 1)));
  await Promise.all(ids.filter((_, i) => i % 2 === 0).map((id) => ra.updateUser(id, { name: `parent ${id}` })));
  assert.equal(await childDone, 0);
  const rows = await db<{ id: string; name: string }[]>`select id, name from lv_users where id in ${db(ids)}`;
  for (const r of rows) assert.equal(r.name, `${ids.indexOf(r.id) % 2 ? "child" : "parent"} ${r.id}`);
});

test("notifications write one outbox event each, never marked delivered; retries don't duplicate", async () => {
  const { c, r, qa, a } = await scenario();
  const job = await ra.acceptQuote(qa.id, c.id);
  await ra.acceptQuote(qa.id, c.id); // retry
  const rows = await db<{ status: string; channel: string }[]>`select o.state as status, o.channel from delivery_outbox o join lv_notifications n on n.id = o.source_notification_id where n.data->>'href' like ${`%${job.id}%`}`;
  assert.ok(rows.length >= 2, "customer and mechanic events");
  assert.ok(rows.every((x) => x.status === "pending" && x.channel === "email"));
  const dup = await db`select event_key, count(*) from delivery_outbox group by event_key having count(*) > 1`;
  assert.equal(dup.length, 0);
  void r;
  void a;
});

test("full lifecycle through the normalized store: history, extras, payment and one review", async () => {
  const { a, c, qa } = await scenario();
  const job = await ra.acceptQuote(qa.id, c.id);
  await rb.startJob(job.id, a.id);
  await ra.requestScopeChange(job.id, a.id, "Seized caliper", 8000);
  await rb.respondScopeChange(job.id, c.id, true);
  await ra.markJobDone(job.id, a.id, 43000, "Done", undefined, { status: "not_paid" });
  await rb.completeJob(job.id, c.id, { status: "paid", amountCents: 43000 });
  await Promise.all([ra.submitReview(job.id, c.id, { overall: 4, comment: "Good" }), rb.submitReview(job.id, c.id, { overall: 1, comment: "dup" })]);
  await ra.updateReview(job.id, c.id, { overall: 5, comment: "Great" });
  assert.equal(await count(db`select count(*) as n from lv_reviews where job_id = ${job.id}`), 1);
  assert.equal(await count(db`select count(*) as n from lv_review_edits r join lv_reviews v on v.id = r.review_id where v.job_id = ${job.id}`), 1);
  assert.equal(await count(db`select count(*) as n from lv_past_repairs where job_id = ${job.id}`), 1);
  const [extra] = await db<{ status: string; extra_cents: string }[]>`select status, extra_cents::text from lv_job_extras where job_id = ${job.id}`;
  assert.deepEqual([extra.status, Number(extra.extra_cents)], ["approved", 8000]);
  await assert.rejects(db`update lv_job_extras set status = 'declined' where job_id = ${job.id}`, /lv_extra_answered/);
  const pay = await db<{ side: string; status: string }[]>`select side, status from lv_job_payment_reports where job_id = ${job.id} order by side`;
  assert.deepEqual(pay.map((p) => `${p.side}:${p.status}`), ["customer:paid", "mechanic:not_paid"]);
  const hist = await db<{ actor: string; action: string }[]>`select actor, action from lv_history where entity_type = 'job' and entity_id = ${job.id} order by seq`;
  // …including the system note that the two payment reports (not paid / paid) don't match.
  assert.deepEqual(hist.map((h) => h.actor), ["customer", "mechanic", "mechanic", "customer", "mechanic", "customer", "system", "customer", "customer"]);
  assert.ok(hist.some((h) => h.actor === "system" && h.action === "payment notes don't match"));
});

test("uploads: live files can only belong to live accounts", async () => {
  const { u } = await customer();
  await db`insert into app_media (id, owner_id, meta, bytes, scope) values (${uid("m")}, ${u.id}, ${db.json({})}, ${Buffer.from([1])}, 'live')`;
  const good = uid("media");
  await db.begin(async (tx) => {
    await tx`insert into app_media (id, owner_id, meta, bytes, scope) values (${good}, ${u.id}, ${tx.json({})}, ${Buffer.from([1])}, 'live')`;
    await A.recordUpload(tx, good, u.id);
  });
  await assert.rejects(
    db.begin(async (tx) => {
      const bad = uid("media");
      await tx`insert into app_media (id, owner_id, meta, bytes, scope) values (${bad}, 'user-maya', ${tx.json({})}, ${Buffer.from([1])}, 'live')`;
      await A.recordUpload(tx, bad, "user-maya");
    }),
    /foreign key/,
  );
});
