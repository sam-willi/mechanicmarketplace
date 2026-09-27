import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { liveSlice, repoOver, type LiveContext, type Viewer } from "@/lib/data";
import { NormalizedLiveStore } from "@/lib/data/normalized/store";
import { SOURCE_COLLECTIONS, textArray, ACCOUNT_BATCH } from "@/lib/data/normalized/reader";
import { paginate, paginateAsc, parseCursor } from "@/lib/data/page";
import { memoryQueries } from "@/lib/data/normalized/queries";
import { rankSearch, explainSearch, type SearchInput } from "@/lib/domain/search";
import { findArea } from "@/lib/domain/areas";
import { effectiveStatus, today } from "@/lib/verification/lifecycle";
import { inQueue, STAFF_SKIP } from "@/lib/admin-queue";
import { unmatchedDemand, DEMAND_LIMIT } from "@/lib/demand";
import { runDeliveryOnce, recipientLoader, deliveryHealth } from "@/lib/notify/worker";
import { toPublicProfile } from "@/lib/domain/public-profile";
import { eligibility } from "@/lib/domain/eligibility";
import { loadBigFixture, HEAVY_CUSTOMER, HEAVY_USER, SIZES, type Fixture } from "./big-fixture";

/**
 * Targeted live reads against a LARGE fictional marketplace (tests-db/big-fixture.ts) on the
 * disposable Postgres: every page reads a bounded number of rows, pagination is stable,
 * access rules hold in the queries, results match the whole-store (snapshot) read path
 * exactly, and the common query plans use indexes rather than scanning whole tables.
 * Prints the measurements it asserts on.
 */

const url = process.env.DATABASE_URL!;
assert.match(url, /127\.0\.0\.1:\d+\/clutch_test$/, "only ever the disposable test database");

// Every query the targeted store sends, captured for EXPLAIN.
const captured: { query: string; params: unknown[]; tag: string }[] = [];
let tag = "";
const traced = postgres(url, { prepare: false, max: 5, onnotice: () => undefined, debug: (_c, query, params) => captured.push({ query, params: params as unknown[], tag }) });
const A = new NormalizedLiveStore(traced, { reads: "targeted" });
const B = NormalizedLiveStore.connect(url, { reads: "targeted" });
const db = postgres(url, { prepare: false, max: 3, onnotice: () => undefined });
let S: NormalizedLiveStore; // the whole-store (snapshot) read path over the same rows
let fx: Fixture;
const report: Record<string, unknown> = {};

before(async () => {
  await A.ensureSchema();
  const t0 = Date.now();
  fx = await loadBigFixture(db, today());
  report.fixtureLoadMs = Date.now() - t0;
  const sizes = await db<{ t: string; n: number }[]>`
    select relname as t, n_live_tup::int as n from pg_stat_user_tables where relname like 'lv_%' and n_live_tup > 1000 order by n_live_tup desc`;
  report.tableRows = Object.fromEntries(sizes.map((s) => [s.t, s.n]));
  S = NormalizedLiveStore.connect(url, { cacheMs: 60_000, reads: "snapshot" });
  const t1 = Date.now();
  await S.ready("force");
  report.snapshotLoadMs = Date.now() - t1;
});

after(async () => {
  console.log("\n[targeted reads] measurements\n" + JSON.stringify(report, null, 2));
  await Promise.all([S?.end(), B.end(), traced.end({ timeout: 5 }), db.end({ timeout: 5 })]);
});

const customerOf = (i: number): Viewer => ({ userId: `big-cu-${String(i).padStart(4, "0")}`, customerId: `big-c-${String(i).padStart(4, "0")}`, staff: false });
const mechanicOf = (i: number): Viewer => ({ userId: `big-mu-${String(i).padStart(4, "0")}`, mechanicId: `big-m-${String(i).padStart(4, "0")}`, staff: false });
const STAFF: Viewer = { userId: "big-staff", staff: true };

/** One simulated request: a fresh slice, the page's loads, and what they cost. */
async function page<T>(name: string, viewer: Viewer, run: (ctx: LiveContext, n: ReturnType<LiveContext["needs"]>) => Promise<T>, store = A) {
  const ctx = liveSlice(store);
  const n = ctx.needs(viewer);
  tag = name;
  const t0 = performance.now();
  const out = await run(ctx, n);
  const ms = Math.round(performance.now() - t0);
  tag = "";
  report.pages ??= {};
  (report.pages as Record<string, unknown>)[name] = { rows: ctx.slice.stats.rows, queries: ctx.slice.stats.queries, ms };
  return { ctx, out, rows: ctx.slice.stats.rows, queries: ctx.slice.stats.queries };
}

const total = () => Object.values(report.tableRows as Record<string, number>).reduce((a, b) => a + b, 0);

// ============================================================ bounded reads
test("every common page reads a small, bounded set of rows from a marketplace of 200k+", async () => {
  assert.ok(total() > 150_000, `dataset is large (${total()} rows)`);
  const busyCustomer = await db<{ c: string }[]>`select customer_id as c from lv_jobs where id like 'big-%' group by 1 order by count(*) desc, 1 limit 1`;
  const ci = Number(busyCustomer[0].c.slice(6));
  const [job] = await db<{ id: string; r: string; m: string; q: string }[]>`select id, request_id as r, mechanic_id as m, quote_id as q from lv_jobs where customer_id = ${busyCustomer[0].c} limit 1`;
  const mi = Number(job.m.slice(6));
  const [inv] = await db<{ r: string }[]>`select request_id as r from lv_request_invitations where mechanic_id = ${job.m} limit 1`;
  const bounds: [string, number, number, { rows: number; queries: number }][] = [
    // Budgets follow the loaders' own limits (e.g. the shell: <=100 open requests + <=99 unread + their estimates).
    ["customer shell", 400, 6, await page("customer shell", customerOf(ci), (_c, n) => n.customerShell())],
    ["customer home", 1200, 40, await page("customer home", customerOf(ci), (_c, n) => n.customerHome())],
    ["customer requests (heavy customer)", 500, 30, await page("customer requests (heavy)", customerOf(0), (_c, n) => n.customerRequests(undefined, 20))],
    ["customer request", 300, 25, await page("customer request", customerOf(ci), (_c, n) => n.customerRequest(job.r))],
    ["customer estimate", 300, 25, await page("customer estimate", customerOf(ci), (_c, n) => n.customerQuote(job.q))],
    ["customer job", 300, 25, await page("customer job", customerOf(ci), (_c, n) => n.customerJob(job.id))],
    ["customer notifications (heavy)", 60, 3, await page("customer notifications (heavy)", customerOf(0), (_c, n) => n.notifications("customer", undefined, 50))],
    ["mechanic shell", 400, 12, await page("mechanic shell", mechanicOf(mi), (_c, n) => n.mechanicShell())],
    ["mechanic home", 1500, 40, await page("mechanic home", mechanicOf(mi), (_c, n) => n.mechanicHome())],
    ["mechanic request", 200, 20, await page("mechanic request", mechanicOf(mi), (_c, n) => n.mechanicRequest(inv.r))],
    ["mechanic job", 200, 20, await page("mechanic job", mechanicOf(mi), (_c, n) => n.mechanicJob(job.id))],
    ["mechanic estimates tab", 200, 12, await page("mechanic estimates tab", mechanicOf(mi), (_c, n) => n.mechanicQuotes(["submitted"], undefined, 25))],
    ["public profile", 150, 10, await page("public profile", { staff: false }, (_c, n) => n.publicProfile(`fixture-mechanic-${mi}`))],
    ["staff queue", 3000, 15, await page("staff queue", STAFF, (_c, n) => n.verificationQueue("queue", undefined, undefined, 60, new Date().toISOString()))],
    ["staff support", 200, 6, await page("staff support", STAFF, (_c, n) => n.supportCases(["open", "in_review"], undefined, 50))],
    ["staff demand", 3000, 6, await page("staff demand", STAFF, (_c, n) => n.demand(DEMAND_LIMIT))],
  ];
  for (const [name, maxRows, maxQueries, p] of bounds) {
    assert.ok(p.rows <= maxRows, `${name}: ${p.rows} rows > ${maxRows}`);
    assert.ok(p.queries <= maxQueries, `${name}: ${p.queries} queries > ${maxQueries} (no N+1)`);
    assert.ok(p.rows < total() / 50, `${name} reads a tiny share of the marketplace`);
  }
});

test("search reads bookable (profile-complete) candidates, verified or not, and a bounded sample of others, with their evidence", async () => {
  const p = await page("search pool", customerOf(3), (ctx) => ctx.repo.searchPool({ unbookable: 20, repair: "brakes", make: "BMW" }));
  const pool = p.out.profiles;
  const d = p.ctx.slice.db;
  const bookable = pool.filter((x) => eligibility(x).eligible).map((x) => x.id);
  for (const id of fx.ready) assert.ok(bookable.includes(id), `profile-complete fixture ${id} is bookable, verified or not`);
  const unverified = pool.filter((x) => eligibility(x).eligible && !eligibility(x).fullyVerified);
  assert.ok(unverified.length > fx.bookable.length, "most bookable mechanics are not fully verified, and they're all found");
  for (const id of fx.lookAlikes.filter((x) => fx.ready.includes(x))) {
    const e = eligibility(pool.find((x) => x.id === id)!);
    assert.equal(e.checks.find((c) => c.key === "identity")!.label, "Identity: Not verified", `${id}: the latest identity check was rejected, and says so`);
  }
  const others = pool.filter((x) => !eligibility(x).eligible);
  assert.ok(others.length <= 20, "not-bookable profiles: a bounded sample");
  for (const x of others) assert.ok(!fx.ready.includes(x.id), "only incomplete profiles are set aside");
  // Every mechanic and every piece of evidence read belongs to a candidate (prefilter superset) or the sample.
  const [{ n: candidates }] = await db<{ n: number }[]>`select count(*)::int as n from lv_mechanics where coalesce(data->>'availabilityNote', '') <> '' or exists (select 1 from lv_mechanic_openings o where o.mechanic_id = lv_mechanics.id)`;
  assert.ok(d.mechanics.length <= candidates + 20 + 5, `${d.mechanics.length} mechanics read, of ${SIZES.mechanics}+`);
  const read = new Set(d.mechanics.map((m) => m.id));
  for (const c of SOURCE_COLLECTIONS) for (const row of d[c] as { mechanicId: string }[]) assert.ok(read.has(row.mechanicId), `${c} row of an unread mechanic`);
  assert.ok(d.users.length === 0 && d.requests.length === 0 && d.customers.length === 0, "search reads no accounts, requests or customers");
  assert.ok(d.pastRepairs.length === 0 && d.reviews.length === 0 && d.credentials.length === 0, "ranking uses the database's counts: no repair, review or credential documents are read");
  assert.ok(d.verifications.every((v) => ["identity", "background", "driving_record", "insurance"].includes(v.category)), "only the records behind the four checks customers see");
  assert.ok(d.verifications.every((v) => v.events === undefined && v.documentIds === undefined && v.reasonCodes === undefined && v.providerRef === undefined && v.decidedBy === undefined), "never their history, documents, reasons or provider references");
  report.searchPool = { bookable: bookable.length, fullyVerified: bookable.length - unverified.length, sampleNotBookable: others.length, mechanicsRead: d.mechanics.length, rows: p.rows, queries: p.queries };
  // A fixed number of queries whatever the number of mechanics: candidates, rows, check records, counts, the sample.
  assert.ok(p.queries <= 20, `search queries: ${p.queries} for ${d.mechanics.length} mechanics`);
});

// ============================================================ pagination
test("cursor pagination is stable, complete and duplicate-free; stale and malformed cursors are safe", async () => {
  const expected = (await db<{ id: string }[]>`select id from lv_requests where customer_id = ${HEAVY_CUSTOMER} and status not in ('open', 'quoted')
    order by (data->>'createdAt') collate "C" desc, id collate "C" desc`).map((r) => r.id);
  assert.ok(expected.length > 60, "enough past requests to page");
  const seen: string[] = [];
  let before: string | undefined;
  for (let i = 0; i < 20; i++) {
    const { ctx } = await page(`requests page ${i}`, customerOf(0), (_c, n) => n.customerRequests(parseCursor(before), 20));
    const all = ctx.repo.listRequestsForCustomer(HEAVY_CUSTOMER).filter((r) => r.status !== "open" && r.status !== "quoted");
    const pg = paginate(all, (r) => r.createdAt, 20, parseCursor(before));
    seen.push(...pg.items.map((r) => r.id));
    if (!pg.next) break;
    before = pg.next;
  }
  assert.deepEqual(seen, expected, "pages concatenate to exactly the database order");
  assert.equal(new Set(seen).size, seen.length, "no duplicates");

  // Stale cursor: read page 1, then a new request arrives and a page-2 row disappears; page 2 still starts right after page 1.
  const { ctx: p1 } = await page("stale p1", customerOf(0), (_c, n) => n.customerRequests(undefined, 20));
  const one = paginate(p1.repo.listRequestsForCustomer(HEAVY_CUSTOMER).filter((r) => !["open", "quoted"].includes(r.status)), (r) => r.createdAt, 20);
  const victim = expected[25];
  await db.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`update lv_requests set status = 'open', data = jsonb_set(data, '{status}', '"open"') where id = ${victim}`;
    await tx`insert into lv_requests (id, customer_id, vehicle_id, status, data) select 'big-r-late', customer_id, vehicle_id, 'completed', jsonb_set(jsonb_set(data, '{id}', '"big-r-late"'), '{createdAt}', '"2099-01-01"') from lv_requests where id = ${expected[0]}`;
  });
  const { ctx: p2 } = await page("stale p2", customerOf(0), (_c, n) => n.customerRequests(parseCursor(one.next), 20));
  const two = paginate(p2.repo.listRequestsForCustomer(HEAVY_CUSTOMER).filter((r) => !["open", "quoted"].includes(r.status)), (r) => r.createdAt, 20, parseCursor(one.next));
  assert.deepEqual(two.items.map((r) => r.id), expected.slice(20, 41).filter((id) => id !== victim).slice(0, 20), "no skips, no repeats, the removed row simply absent");
  assert.ok(!two.items.some((r) => one.items.some((x) => x.id === r.id)));
  // Malformed cursors read as "from the start".
  for (const bad of ["garbage", "~", "x~", "~y", "a".repeat(500), "2026-01-01~'; drop table lv_requests; --"]) {
    const c = parseCursor(bad);
    const { ctx } = await page("malformed cursor", customerOf(0), (_c, n) => n.customerRequests(c, 20));
    const got = paginate(ctx.repo.listRequestsForCustomer(HEAVY_CUSTOMER).filter((r) => !["open", "quoted"].includes(r.status)), (r) => r.createdAt, 20, c);
    assert.ok(got.items.length > 0, `cursor ${bad.slice(0, 20)} still pages`);
  }
  assert.equal((await db`select 1 from lv_requests limit 1`).length, 1, "and nothing was injected");

  // Notifications (newest first) and the staff queue (oldest first) page the same way.
  const nExpected = (await db<{ id: string }[]>`select id from lv_notifications where user_id = ${HEAVY_USER} and mode = 'customer' order by (data->>'createdAt') collate "C" desc, id collate "C" desc`).map((r) => r.id);
  const nSeen: string[] = [];
  let nb: string | undefined;
  for (let i = 0; i < 20; i++) {
    const { ctx } = await page("notifications page", customerOf(0), (_c, n) => n.notifications("customer", parseCursor(nb), 50));
    const pg = paginate(ctx.repo.listNotifications(HEAVY_USER, "customer"), (x) => x.createdAt, 50, parseCursor(nb));
    nSeen.push(...pg.items.map((x) => x.id));
    if (!pg.next) break;
    nb = pg.next;
  }
  assert.deepEqual(nSeen, nExpected);
  const now = new Date().toISOString();
  // Waiting for staff: submitted or under review, by a method staff decide (never a provider's).
  const qExpected = (await db<{ id: string }[]>`select id from lv_verifications where status in ('submitted', 'under_review') and coalesce(data->>'method', '') not in ${db(STAFF_SKIP)} order by coalesce(data->>'submittedAt', '') collate "C", id collate "C"`).map((r) => r.id);
  const qSeen: string[] = [];
  let qa: string | undefined;
  for (let i = 0; i < 50; i++) {
    const { ctx } = await page("queue page", STAFF, (_c, n) => n.verificationQueue("queue", undefined, parseCursor(qa), 60, now));
    const list = ctx.repo.listVerifications().filter((v) => inQueue("queue", effectiveStatus(v.status, v.expiresAt, new Date(now)), v.method));
    const pg = paginateAsc(list, (v) => v.submittedAt, 60, parseCursor(qa));
    qSeen.push(...pg.items.map((v) => v.id));
    if (!pg.next) break;
    qa = pg.next;
  }
  assert.deepEqual(qSeen, qExpected, "the review queue pages through every pending item, oldest first");
});

// ============================================================ access in the query
test("unauthorized direct ids read as not found, for customers, mechanics and non-staff", async () => {
  const [other] = await db<{ id: string; r: string; q: string; v: string; c: string; m: string }[]>`
    select j.id, j.request_id as r, j.quote_id as q, j.data->>'vehicleId' as v, j.customer_id as c, j.mechanic_id as m from lv_jobs j where j.id like 'big-%' and customer_id <> ${HEAVY_CUSTOMER} limit 1`;
  // Another customer.
  const stranger = customerOf(0);
  const { ctx } = await page("stranger", stranger, async (_c, n) => {
    await Promise.all([n.customerRequest(other.r), n.customerJob(other.id), n.customerQuote(other.q), n.customerVehicle(other.v), n.ownRecords({ jobId: other.id, requestId: other.r, vehicleId: other.v, quoteId: other.q })]);
  });
  assert.equal(ctx.repo.getRequest(other.r), undefined);
  assert.equal(ctx.repo.getJob(other.id), undefined);
  assert.equal(ctx.repo.getQuote(other.q), undefined);
  assert.equal(ctx.repo.getVehicle(other.v), undefined);
  assert.equal(ctx.slice.stats.rows, 0, "not one row of theirs read");
  // A customer never sees a draft estimate on their own request.
  const [draft] = await db<{ id: string; c: string }[]>`select q.id, r.customer_id as c from lv_quotes q join lv_requests r on r.id = q.request_id where q.status = 'draft' and q.id like 'big-%' limit 1`;
  const owner = Number(draft.c.slice(6));
  const { ctx: own } = await page("own draft", customerOf(owner), (_c, n) => n.customerQuote(draft.id));
  assert.equal(own.repo.getQuote(draft.id), undefined, "drafts are the mechanic's own");
  // A mechanic not invited; an invited mechanic sees only their own estimate.
  const [shared] = await db<{ r: string; m1: string; m2: string }[]>`
    select a.request_id as r, a.mechanic_id as m1, b.mechanic_id as m2 from lv_quotes a join lv_quotes b on a.request_id = b.request_id and a.mechanic_id < b.mechanic_id where a.id like 'big-%' and b.id like 'big-%' limit 1`;
  const [outsider] = await db<{ m: string }[]>`select id as m from lv_mechanics where id like 'big-%' and id not in (select mechanic_id from lv_request_invitations where request_id = ${shared.r}) limit 1`;
  const { ctx: o } = await page("uninvited mechanic", mechanicOf(Number(outsider.m.slice(6))), (_c, n) => n.mechanicRequest(shared.r));
  assert.equal(o.repo.getRequest(shared.r), undefined);
  const { ctx: m1 } = await page("invited mechanic", mechanicOf(Number(shared.m1.slice(6))), (_c, n) => n.mechanicRequest(shared.r));
  assert.ok(m1.repo.getRequest(shared.r));
  assert.deepEqual(m1.repo.listQuotesForRequest(shared.r).map((q) => q.mechanicId), [shared.m1], "never another mechanic's estimate");
  const { ctx: mj } = await page("mechanic, someone else's job", mechanicOf(Number(outsider.m.slice(6))), (_c, n) => n.mechanicJob(other.id));
  assert.equal(mj.repo.getJob(other.id), undefined);
  // Staff pages read nothing for non-staff.
  const { ctx: ns } = await page("non-staff on staff loads", customerOf(5), async (_c, n) => {
    await Promise.all([n.verificationQueue("queue", undefined, undefined, 60, new Date().toISOString()), n.supportCases(["open"]), n.supportCase("big-sup-0001"), n.demand(100), n.verificationReview("big-ver-0000-identity")]);
  });
  assert.equal(ns.slice.stats.rows, 0);
  // Uploaded files: another customer's request photo isn't visible; a public repair photo is.
  const [media] = await db<{ id: string; c: string }[]>`select id, customer_id as c from lv_requests where id like 'big-%' and jsonb_array_length(data->'media') > 0 and customer_id <> ${stranger.customerId!} limit 1`;
  const mediaId = `big-media-${Number(media.id.slice(6))}`;
  const { ctx: mm } = await page("media, not theirs", stranger, (_c, n) => n.media(mediaId));
  assert.equal(mm.repo.findRequestWithMedia(mediaId), undefined);
  const { ctx: mo } = await page("media, their own", customerOf(Number(media.c.slice(6))), (_c, n) => n.media(mediaId));
  assert.equal(mo.repo.findRequestWithMedia(mediaId)?.id, media.id);
  const [photo] = await db<{ id: string; p: string }[]>`select id, data->'photos'->0->>'id' as p from lv_past_repairs where id like 'big-%' and jsonb_array_length(coalesce(data->'photos', '[]')) > 0 limit 1`;
  const { ctx: pub } = await page("media, public repair photo", { staff: false }, (_c, n) => n.media(photo.p));
  assert.equal(pub.repo.findRepairWithPhoto(photo.p)?.id, photo.id, "public repair photos are found for anyone");
  assert.ok(pub.slice.db.pastRepairs.every((r) => !("description" in r)), "and read without private fields");
});

test("no cross-user leakage: a customer's pages hold only their own records and public profiles, minus private fields", async () => {
  const [row] = await db<{ c: string }[]>`select customer_id as c from lv_jobs where id like 'big-%' group by 1 order by count(*) desc, 1 limit 1`;
  const i = Number(row.c.slice(6));
  const v = customerOf(i);
  const ctx = liveSlice(A);
  const n = ctx.needs(v);
  const jobs = await db<{ id: string; r: string; q: string }[]>`select id, request_id as r, quote_id as q from lv_jobs where customer_id = ${row.c}`;
  await n.account(v.userId!);
  await Promise.all([n.customerShell(), n.customerHome(), n.customerRequests(), n.customerRepairs(), n.customerSaved(), n.customerVehicles(), n.notifications("customer"), n.customerHelp()]);
  for (const j of jobs) await Promise.all([n.customerRequest(j.r), n.customerQuote(j.q)]);
  const d = ctx.slice.db;
  assert.ok(d.requests.length && d.requests.every((r) => r.customerId === v.customerId), "only their requests");
  assert.ok(d.customers.every((c) => c.id === v.customerId), "no other customer");
  assert.ok(d.vehicles.every((x) => x.customerId === v.customerId), "only their cars");
  assert.ok(d.users.every((u) => u.id === v.userId), "no other account (contacts appear only on a booked job's own page)");
  assert.ok(d.notifications.every((x) => x.userId === v.userId));
  assert.ok(d.supportReports.every((x) => x.userId === v.userId));
  assert.ok(d.quotes.every((q) => q.status !== "draft"));
  assert.ok(d.screenings.length > 0 && d.screenings.every((s) => !("providerRef" in s) && !("result" in s) && !("provider" in s)), "screening references stripped in SQL");
  assert.ok(d.insurance.every((x) => !("policyLast4" in x) && !("documentName" in x)));
  assert.ok(d.verifications.every((x) => !("notes" in x) && !("evidenceSummary" in x) && !("reviewerId" in x)));
  // The job page adds exactly one account: the booked mechanic's (for their phone).
  const j2 = liveSlice(A);
  await j2.needs(v).customerJob(jobs[0].id);
  assert.equal(j2.slice.db.users.length, 1);
  assert.equal(j2.slice.db.users[0].id, j2.slice.db.mechanics.find((m) => m.id === j2.slice.db.jobs[0].mechanicId)!.userId);
  // A mechanic's request page: the customer's display name, never their account or other customers.
  const [inv] = await db<{ r: string; m: string }[]>`select request_id as r, mechanic_id as m from lv_request_invitations where request_id like 'big-%' limit 1`;
  const mc = liveSlice(A);
  await mc.needs(mechanicOf(Number(inv.m.slice(6)))).mechanicRequest(inv.r);
  assert.ok(mc.slice.db.users.length === 0 && mc.slice.db.customers.length === 1);
});

// ============================================================ equivalence with the whole-store path
const INPUTS: SearchInput[] = [
  {},
  { repair: "brakes" },
  { make: "BMW" },
  { repair: "brakes", make: "BMW" },
  { repair: "suspension", make: "Toyota", model: "Fixture" },
  { repair: "electrical", area: findArea("pasadena") },
  { repair: "brakes", make: "Honda", area: findArea("mid-city"), maxMi: 15 },
  { make: "Ford" },
  { repair: "cooling", within: 7 },
  { lang: "Spanish" },
  { repair: "diagnostics", make: "Subaru", area: findArea("santa-monica"), within: 3 },
  { repair: "brakes", make: "BMW", model: "328i" },
  { verifiedOnly: true },
  { repair: "brakes", make: "BMW", verifiedOnly: true },
  { repair: "brakes", checks: ["insurance"] },
  { make: "Toyota", checks: ["identity", "background", "driving_record"], area: findArea("hollywood") },
];

test("search: Best Fit, Soonest Strong Fit, order and explanations are identical to the whole-store path", async () => {
  const snap = repoOver("live", S);
  const all = snap.listPublicProfiles();
  let picks = 0;
  for (const input of INPUTS) {
    // Each search reads its own counts for its repair, make and model, as the page does.
    const { ctx, out: pool } = await page(`search (equivalence) ${JSON.stringify(input).slice(0, 40)}`, customerOf(9), (c) => c.repo.searchPool({ unbookable: 20, repair: input.repair, make: input.make, model: input.model }));
    const whole = rankSearch(all, (id) => snap.getMechanic(id)!, input);
    const targeted = rankSearch(pool.profiles, (id) => ctx.repo.getMechanic(id)!, input, undefined, pool.counts);
    assert.deepEqual(explainSearch(targeted, input), explainSearch(whole, input), JSON.stringify(input));
    for (const f of [{}, { ...whole.filters, area: undefined }, { ...whole.filters, within: undefined }]) assert.equal(targeted.openCount(f), whole.openCount(f), "relaxation counts");
    picks += whole.picks.length;
  }
  assert.ok(picks > 0, "the fixtures produce recommendations to compare");
  report.searchEquivalence = { inputs: INPUTS.length, picksCompared: picks };
});

test("matching: new requests go to exactly the same mechanics as the whole-store path", async () => {
  const combos = [
    { cat: "brakes", area: "mid-city" },
    { cat: "suspension", area: "pasadena" },
    { cat: "electrical", area: "long-beach" },
    { cat: "cooling", area: "hollywood" },
  ] as const;
  const snap = repoOver("live", S);
  const t = liveSlice(A).repo;
  for (const [k, c] of combos.entries()) {
    const cust = 100 + k;
    const input = (key: string) => ({
      customerId: `big-c-0${cust}`, vehicleId: `big-v-0${cust}`, repairCategory: c.cat, categorySource: "customer" as const, symptomDescription: "Fixture matching check.",
      occurrence: { conditions: [] }, onset: {}, warningLights: [], diagnosticCodes: [], smells: [], recentRepairs: [], customerParts: [], location: { serviceMode: "mobile" as const, area: c.area }, media: [], idempotencyKey: key,
    });
    await S.ready("force");
    const w = await snap.createRequest(input(`match-s-${k}-${process.pid}`));
    tag = `match ${k}`;
    const tr = await t.createRequest(input(`match-t-${k}-${process.pid}`));
    tag = "";
    assert.deepEqual(tr.matchedMechanicIds, w.matchedMechanicIds, JSON.stringify(c));
  }
  report.matchingTxRows = A.stats.txRows;
});

test("staff counts, demand, supply and the review hand-off match the whole-store path", async () => {
  await S.ready("force");
  const snap = repoOver("live", S);
  const t = liveSlice(A).repo;
  const now = new Date();
  const nowIso = now.toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  assert.deepEqual(await t.verificationCounts(nowIso, weekAgo), memoryQueries.verificationCounts(S.current().verifications, now, weekAgo));
  assert.deepEqual(await t.supportStatusCounts(), await snap.supportStatusCounts());
  assert.equal(await t.openSupportCount(), await snap.openSupportCount());
  for (const m of ["big-m-0003", "big-m-0020", "big-m-1500"]) {
    assert.deepEqual(await t.quoteStatusCounts(m), await snap.quoteStatusCounts(m));
    const mech = S.current().mechanics.find((x) => x.id === m)!;
    assert.equal(await t.waitingDemandCount(mech), await snap.waitingDemandCount(mech), `waiting demand for ${m}`);
  }
  for (const [v, mech] of [["big-ver-0000-identity", "big-m-0000"], ["big-ver-0007-cred", "big-m-0007"], ["nope", "big-m-0001"]]) {
    assert.equal(await t.nextPendingVerification(v, mech, nowIso), await snap.nextPendingVerification(v, mech, nowIso), `next after ${v}`);
  }
  assert.equal(await t.anyBookable(), true);
  assert.deepEqual(await t.supplyCounts(), await snap.supplyCounts());
  const { ctx } = await page("demand (equivalence)", STAFF, (_c, n) => n.demand(DEMAND_LIMIT));
  const td = await unmatchedDemand(ctx.repo, now);
  const wd = await unmatchedDemand(snap, now);
  assert.deepEqual({ ...td, supply: undefined }, { ...wd, supply: undefined });
  assert.equal(td.truncated, true, "more open requests than the demand view reads, and it says so");
  assert.ok(ctx.slice.db.requests.length <= DEMAND_LIMIT + 1);
});

test("an idempotent write's returned record is readable in the same request", async () => {
  const c = liveSlice(A);
  const other = liveSlice(B);
  const input = { customerId: "big-c-0200", vehicleId: "big-v-0200", repairCategory: "brakes" as const, categorySource: "customer" as const, symptomDescription: "Idempotency check.", occurrence: { conditions: [] }, onset: {}, warningLights: [], diagnosticCodes: [], smells: [], recentRepairs: [], customerParts: [], location: { serviceMode: "mobile" as const, area: "mid-city" }, media: [], idempotencyKey: `idem-${process.pid}` };
  const first = await c.repo.createRequest(input);
  const again = await other.repo.createRequest(input);
  assert.equal(again.id, first.id);
  assert.equal(other.repo.getRequest(first.id)?.id, first.id, "the second instance's request can read what it was handed");
});

// ============================================================ two app instances
test("two independent app instances: writes on one are read fresh by the next request on the other; races resolve once", async () => {
  const [q] = await db<{ id: string; r: string; c: string; m: string }[]>`
    select q.id, q.request_id as r, r.customer_id as c, q.mechanic_id as m from lv_quotes q join lv_requests r on r.id = q.request_id
    where q.id like 'big-%' and q.status = 'submitted' and r.status = 'quoted' and q.mechanic_id = any(${textArray(fx.bookable)}::text[])
      and exists (select 1 from lv_quotes o where o.request_id = q.request_id and o.id <> q.id and o.status = 'submitted') limit 1`;
  assert.ok(q, "the fixture has competing estimates, one from a bookable mechanic");
  const cust = Number(q.c.slice(6));
  const [rival] = await db<{ id: string; m: string }[]>`select id, mechanic_id as m from lv_quotes where request_id = ${q.r} and id <> ${q.id} and status = 'submitted' limit 1`;
  // A reads the request page; then B's customer accepts and A's mechanic (rival) declines, at once.
  const before = liveSlice(A);
  await before.needs(customerOf(cust)).customerRequest(q.r);
  assert.equal(before.repo.getRequest(q.r)?.status, "quoted");
  const res = await Promise.allSettled([liveSlice(B).repo.acceptQuote(q.id, q.c), liveSlice(A).repo.declineRequest(q.r, rival.m, "booked_up")]);
  assert.equal(res[0].status, "fulfilled", String((res[0] as PromiseRejectedResult).reason));
  // The next request on A (a fresh slice) sees B's booking; nothing is cached across requests.
  const after = liveSlice(A);
  await after.needs(customerOf(cust)).customerRequest(q.r);
  assert.equal(after.repo.getRequest(q.r)?.status, "booked");
  assert.equal(after.repo.listQuotesForRequest(q.r).filter((x) => x.status === "accepted").length, 1);
  const [{ n }] = await db<{ n: number }[]>`select count(*)::int as n from lv_jobs where request_id = ${q.r} and status <> 'cancelled'`;
  assert.equal(n, 1);
  // Concurrent pages on both instances while writes land: every read is a consistent own view.
  const views = await Promise.all(Array.from({ length: 12 }, (_, i) => page(`concurrent ${i}`, customerOf(cust), (_c, nn) => nn.customerRequest(q.r), i % 2 ? A : B)));
  for (const v of views) assert.equal(v.ctx.repo.getRequest(q.r)?.status, "booked");
});

// ============================================================ the delivery worker at volume
test("delivery worker at volume: bounded batches, test recipients suppressed, health stays bounded and redacted", async () => {
  const users = (await db<{ id: string }[]>`select id from lv_users where id like 'big-cu-%' order by id limit 3000`).map((u) => u.id);
  await db`update delivery_outbox set next_attempt_at = now() + interval '10 years' where state in ('pending', 'retry')`;
  await db`update delivery_outbox set state = 'suppressed', suppressed_reason = 'test_isolation' where state = 'no_provider'`;
  const rows = users.map((u, i) => ({ scope: "live", event_key: `big-evt-${i}`, event_type: "estimate.received", channel: "email", user_id: u, audience: "customer", link_path: "/customer", source_notification_id: `big-n-evt-${i}` }));
  for (let i = 0; i < rows.length; i += 1000) await db`insert into delivery_outbox ${db(rows.slice(i, i + 1000))} on conflict (event_key) do nothing`;
  await db`analyze delivery_outbox`;
  tag = "worker";
  const t0 = performance.now();
  const r1 = await runDeliveryOnce({ sql: traced, provider: null, workerId: "big-w1", origin: "https://clutch.example", loadRecipient: recipientLoader(traced, true), batch: 200 });
  const ms = Math.round(performance.now() - t0);
  tag = "";
  assert.equal(r1.claimed, 200);
  assert.equal(r1.suppressed, 200, "every fixture address is a test address: none reach a provider");
  assert.equal(r1.sent, 0);
  // A worker started without the app's store setting still finds normalized accounts (no false "no account").
  const [one] = await db<{ id: string }[]>`select id::text from delivery_outbox where user_id = ${users[250]} and event_key = 'big-evt-250'`;
  await db`update delivery_outbox set next_attempt_at = now() + interval '10 years' where state in ('pending', 'retry') and id <> ${one.id}::bigint`;
  await runDeliveryOnce({ sql: db, provider: null, workerId: "big-w2", origin: "https://clutch.example", loadRecipient: recipientLoader(db, false), batch: 5 });
  const [st] = await db<{ reason: string }[]>`select suppressed_reason as reason from delivery_outbox where id = ${one.id}::bigint`;
  assert.equal(st.reason, "test_recipient", "found in lv_users, suppressed only because it's a test address");
  const h = await deliveryHealth(db);
  assert.ok(!JSON.stringify(h).includes("@"), "no addresses in health");
  for (const v of Object.values(h)) if (Array.isArray(v)) assert.ok(v.length <= 100, "health lists are bounded");
  report.worker = { outbox: rows.length, batch: 200, ms };
});

// ============================================================ query plans
const BIG = new Set(["lv_users", "lv_customers", "lv_vehicles", "lv_mechanics", "lv_screenings", "lv_insurance", "lv_credentials", "lv_verifications", "lv_requests", "lv_request_invitations", "lv_request_questions", "lv_quotes", "lv_quote_questions", "lv_jobs", "lv_past_repairs", "lv_reviews", "lv_notifications", "lv_support_cases", "delivery_outbox"]);
/**
 * Staff tallies that count a whole table by design (every verification by status, every support
 * case by status, profiles in total): exempt from the scan rule, and listed in the report.
 */
const AGGREGATE = /from lv_verifications group by|from lv_support_cases group by|count\(\*\)::int as n from lv_mechanics$/;

function scans(plan: Record<string, unknown>, out: string[] = []) {
  if (plan["Node Type"] === "Seq Scan" && BIG.has(String(plan["Relation Name"]))) out.push(String(plan["Relation Name"]));
  for (const p of (plan.Plans as Record<string, unknown>[] | undefined) ?? []) scans(p, out);
  return out;
}

test("query plans: common customer, mechanic, staff, search and worker queries use indexes, never a full scan of a large table", async () => {
  // The counted reads too, under their own tags.
  const t = liveSlice(A).repo;
  const nowIso = new Date().toISOString();
  const mech = (await db<{ data: never }[]>`select data from lv_mechanics where id = 'big-m-0020'`)[0].data;
  for (const [name, run] of [
    ["mechanic estimate counts", () => t.quoteStatusCounts("big-m-0020")],
    ["mechanic waiting demand", () => t.waitingDemandCount(mech)],
    ["staff next pending", () => t.nextPendingVerification("big-ver-0000-identity", "big-m-0000", nowIso)],
    ["staff open support", () => t.openSupportCount()],
    ["staff queue tiles", () => t.verificationCounts(nowIso, "2026-09-01")],
    ["staff support tiles", () => t.supportStatusCounts()],
    ["staff supply", () => t.supplyCounts()],
    ["customer any bookable", () => t.anyBookable()],
  ] as const) {
    tag = name;
    await run();
  }
  tag = "";
  await db`analyze`;
  const seen = new Map<string, { tag: string; query: string; params: unknown[] }>();
  for (const c of captured) if (c.tag && /^\s*(select|with|update)/i.test(c.query) && !/pg_advisory|lv_change_seq|begin|set local|to_regclass|information_schema|pg_catalog/i.test(c.query)) seen.set(c.query + JSON.stringify(c.params), c);
  // Large = at least 5,000 rows here. On smaller tables the planner may rightly prefer a scan of a
  // few pages, so for EVERY table the plan is also taken with sequential scans switched off: if a
  // Seq Scan still appears, no index serves that query at all.
  const large = new Set((await db<{ t: string }[]>`select relname as t from pg_class where relkind = 'r' and reltuples >= 5000`).map((r) => r.t));
  const bad: string[] = [];
  const unindexed: string[] = [];
  const aggregates: string[] = [];
  let checked = 0;
  const explain = async (query: string, params: unknown[], forced: boolean) =>
    db.begin(async (tx) => {
      if (forced) await tx`set local enable_seqscan = off`;
      const [{ "QUERY PLAN": plan }] = (await tx.unsafe(`explain (format json) ${query}`, params as never[])) as unknown as { "QUERY PLAN": { Plan: Record<string, unknown> }[] }[];
      return scans(plan[0].Plan);
    });
  for (const { tag: t, query, params } of seen.values()) {
    checked++;
    const flat = query.replace(/\s+/g, " ").slice(0, 200);
    if (AGGREGATE.test(query)) {
      aggregates.push(`${t}: ${flat.slice(0, 120)}`);
      continue;
    }
    const natural = (await explain(query, params, false)).filter((x) => large.has(x));
    if (natural.length) bad.push(`${t}: seq scan on ${natural.join(",")} :: ${flat}`);
    const forced = await explain(query, params, true);
    if (forced.length) unindexed.push(`${t}: no index for ${forced.join(",")} :: ${flat}`);
  }
  report.queryPlans = { distinctQueriesExplained: checked, largeTables: [...large].sort(), fullScansOnLargeTables: bad.length, queriesWithoutAnIndexPath: unindexed.length, staffAggregateCounts: [...new Set(aggregates)] };
  assert.ok(checked > 60, `explained ${checked} distinct queries`);
  assert.deepEqual(bad, [], bad.join("\n"));
  assert.deepEqual(unindexed, [], unindexed.join("\n"));
});

test("exact-rule sanity: every profile the targeted pool calls bookable is bookable in the whole store", async () => {
  const snap = repoOver("live", S);
  const pool = await liveSlice(A).repo.searchPool();
  for (const p of pool.profiles) {
    const whole = eligibility(toPublicProfile(snap.getMechanicSources(p.id)));
    assert.ok(whole.eligible, p.id);
    assert.deepEqual(eligibility(p).checks.map((c) => c.label), whole.checks.map((c) => c.label), `${p.id}: the same check statuses from the lightweight read`);
  }
});

test("id batches: a long id list (a write's candidate accounts) is read by primary key in batches of 50, never a scan", async () => {
  // As closeForWrite reads the accounts of every candidate mechanic when a request is matched.
  const ids = (await db<{ id: string }[]>`select id from lv_users where id like 'big-mu-%' order by id limit 180`).map((r) => r.id);
  assert.equal(ids.length, 180);
  assert.equal(ACCOUNT_BATCH, 50);
  await db`analyze lv_users`;
  const ctx = liveSlice(A);
  const from = captured.length;
  tag = "id batches";
  const rows = await ctx.reader.users(ids);
  tag = "";
  assert.equal(rows.length, 180, "every account read");
  const batches = captured.slice(from).filter((c) => c.tag === "id batches" && /from "lv_users" where id = any/.test(c.query));
  assert.equal(batches.length, 4, "180 ids → 4 queries");
  const plans: string[] = [];
  for (const b of batches) {
    const [arr] = b.params as string[];
    const n = String(arr).replace(/^\{|\}$/g, "").split(",").length;
    assert.ok(n <= ACCOUNT_BATCH, `batch of ${n} ids`);
    // The plan Postgres itself chooses (sequential scans allowed): it must read by primary key.
    const [{ "QUERY PLAN": plan }] = (await db.unsafe(`explain (format json) ${b.query}`, b.params as never[])) as unknown as { "QUERY PLAN": { Plan: Record<string, unknown> }[] }[];
    const nodes: string[] = [];
    const walk = (p: Record<string, unknown>) => {
      nodes.push(`${p["Node Type"]}${p["Index Name"] ? ` using ${p["Index Name"]}` : ""}`);
      for (const c of (p.Plans as Record<string, unknown>[] | undefined) ?? []) walk(c);
    };
    walk(plan[0].Plan);
    plans.push(nodes.join(" > "));
    assert.deepEqual(scans(plan[0].Plan), [], `batch of ${n}: ${nodes.join(" > ")}`);
    assert.ok(nodes.some((x) => /Index|Bitmap/.test(x) && /lv_users_pkey/.test(x)), `batch of ${n} reads by primary key: ${nodes.join(" > ")}`);
  }
  report.idBatches = { ids: ids.length, batches: batches.length, plans: [...new Set(plans)], server: (await db<{ v: string }[]>`select current_setting('server_version') as v`)[0].v };
});
