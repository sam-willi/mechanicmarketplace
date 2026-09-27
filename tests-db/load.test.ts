import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { liveSlice, type LiveContext, type Viewer } from "@/lib/data";
import { NormalizedLiveStore } from "@/lib/data/normalized/store";
import { LifecycleError } from "@/lib/domain/transitions";
import { today } from "@/lib/verification/lifecycle";
import { textArray } from "@/lib/data/normalized/reader";
import { loadBigFixture, SIZES, type Fixture } from "./big-fixture";

/**
 * Load on the targeted live store: a mixed stream of page reads and writes through two
 * independent app instances (separate connection pools, like two servers) against the large
 * fictional marketplace, at a fixed concurrency. Measures latency per page and per write,
 * and checks the marketplace rules still hold afterwards. Disposable Postgres only.
 *
 * CLUTCH_FIXTURE_SCALE=5 runs the same load on a marketplace five times the size, to show
 * per-page reads don't grow with it.
 */

const url = process.env.DATABASE_URL!;
assert.match(url, /127\.0\.0\.1:\d+\/clutch_test$/, "only ever the disposable test database");
const A = NormalizedLiveStore.connect(url, { reads: "targeted" });
const B = NormalizedLiveStore.connect(url, { reads: "targeted" });
const db = postgres(url, { prepare: false, max: 3, onnotice: () => undefined });
let fx: Fixture;
const report: Record<string, unknown> = {};

before(async () => {
  await A.ensureSchema();
  fx = await loadBigFixture(db, today());
  const [{ n }] = await db<{ n: number }[]>`select sum(n_live_tup)::int as n from pg_stat_user_tables where relname like 'lv_%'`;
  report.marketplaceRows = n;
  report.scale = SIZES.mechanics / 3000;
});
after(async () => {
  console.log("\n[load] measurements\n" + JSON.stringify(report, null, 2));
  await Promise.all([A.end(), B.end(), db.end({ timeout: 5 })]);
});

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 10) / 10;
};
const pad = (i: number) => String(i).padStart(4, "0");
const cust = (i: number): Viewer => ({ userId: `big-cu-${pad(i)}`, customerId: `big-c-${pad(i)}`, staff: false });
const mech = (i: number): Viewer => ({ userId: `big-mu-${pad(i)}`, mechanicId: `big-m-${pad(i)}`, staff: false });

/** Run `jobs` with at most `n` in flight. */
async function pool<T>(n: number, jobs: (() => Promise<T>)[]) {
  const out: T[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await jobs[i]();
    }
  }));
  return out;
}

test("mixed page reads and writes on two instances: bounded, fast, and the marketplace rules hold", async () => {
  // Real ids to act on, all inside the fixture.
  const jobs = await db<{ id: string; c: string; m: string; r: string; q: string }[]>`
    select id, customer_id as c, mechanic_id as m, request_id as r, quote_id as q from lv_jobs where id like 'big-%' order by id limit 400`;
  const invites = await db<{ r: string; m: string }[]>`select request_id as r, mechanic_id as m from lv_request_invitations where request_id like 'big-%' order by request_id limit 400`;
  const races = await db<{ r: string; c: string; q1: string; q2: string }[]>`
    select r.id as r, r.customer_id as c, a.id as q1, b.id as q2
    from lv_requests r join lv_quotes a on a.request_id = r.id join lv_quotes b on b.request_id = r.id and b.id > a.id
    where r.id like 'big-%' and r.status = 'quoted' and a.status = 'submitted' and b.status = 'submitted' and a.mechanic_id = any(${textArray(fx.bookable)}::text[])
      and not exists (select 1 from lv_jobs j where j.request_id = r.id and j.status <> 'cancelled')
    order by r.id limit 30`;
  assert.ok(jobs.length >= 100 && invites.length >= 100 && races.length >= 5, `enough fixture work (${jobs.length} jobs, ${invites.length} invitations, ${races.length} races)`);
  const idx = (id: string) => Number(id.split("-").pop());

  type Op = { kind: string; run: (ctx: LiveContext) => Promise<unknown> };
  const reads: Op[] = [];
  for (let i = 0; i < 480; i++) {
    const j = jobs[i % jobs.length];
    const inv = invites[i % invites.length];
    const kinds: Op[] = [
      { kind: "customer home", run: (c) => c.needs(cust(idx(j.c))).customerHome() },
      { kind: "customer request", run: (c) => c.needs(cust(idx(j.c))).customerRequest(j.r) },
      { kind: "customer job", run: (c) => c.needs(cust(idx(j.c))).customerJob(j.id) },
      { kind: "customer requests page", run: (c) => c.needs(cust(idx(j.c))).customerRequests(undefined, 20) },
      { kind: "notifications page", run: (c) => c.needs(cust(idx(j.c))).notifications("customer", undefined, 50) },
      { kind: "mechanic home", run: (c) => c.needs(mech(idx(inv.m))).mechanicHome() },
      { kind: "mechanic request", run: (c) => c.needs(mech(idx(inv.m))).mechanicRequest(inv.r) },
      { kind: "mechanic job", run: (c) => c.needs(mech(idx(j.m))).mechanicJob(j.id) },
      { kind: "public profile", run: (c) => c.needs({ staff: false }).publicProfile(`fixture-mechanic-${idx(j.m)}`) },
      { kind: "search", run: (c) => c.repo.searchPool({ unbookable: 20 }) },
      { kind: "staff queue", run: (c) => c.needs({ userId: "s", staff: true }).verificationQueue("queue", undefined, undefined, 60, new Date().toISOString()) },
      { kind: "staff demand", run: (c) => c.needs({ userId: "s", staff: true }).demand(500) },
    ];
    reads.push(kinds[i % kinds.length]);
  }
  const writes: Op[] = [];
  for (let i = 0; i < 60; i++) {
    const c = cust(2000 + i);
    writes.push({
      kind: "new request (matching)",
      run: (x) => x.repo.createRequest({ customerId: c.customerId!, vehicleId: `big-v-${pad(2000 + i)}`, repairCategory: (["brakes", "suspension", "electrical", "cooling"] as const)[i % 4], categorySource: "customer", symptomDescription: "Load test request.", occurrence: { conditions: [] }, onset: {}, warningLights: [], diagnosticCodes: [], smells: [], recentRepairs: [], customerParts: [], location: { serviceMode: "mobile", area: "mid-city" }, media: [], idempotencyKey: `load-${process.pid}-${i}` }),
    });
  }
  for (let i = 0; i < 60; i++) writes.push({ kind: "mark notifications read", run: (x) => x.repo.markNotificationsRead(cust(3000 + i).userId!, "customer") });
  for (let i = 0; i < 60; i++) writes.push({ kind: "update account", run: (x) => x.repo.updateUser(cust(100 + (i % 20)).userId!, { name: `Load ${i}` }) });
  // Estimate races: the customer accepts two different estimates at once, one on each instance.
  const raceOps: Op[] = races.flatMap((r) => [
    { kind: "accept race A", run: () => liveSlice(A).repo.acceptQuote(r.q1, r.c) },
    { kind: "accept race B", run: () => liveSlice(B).repo.acceptQuote(r.q2, r.c) },
  ]);

  const all = [...reads, ...writes, ...raceOps].map((op, i) => ({ op, i })).sort((a, b) => ((a.i * 7919) % 997) - ((b.i * 7919) % 997));
  const latency = new Map<string, number[]>();
  const rows = new Map<string, number[]>();
  const errors: string[] = [];
  let expectedRefusals = 0;
  const t0 = performance.now();
  await pool(24, all.map(({ op, i }) => async () => {
    const ctx = liveSlice(i % 2 ? A : B);
    const s = performance.now();
    try {
      await op.run(ctx);
    } catch (e) {
      if (op.kind.startsWith("accept race") && e instanceof LifecycleError) expectedRefusals++;
      else errors.push(`${op.kind}: ${(e as Error).message}`);
    }
    (latency.get(op.kind) ?? latency.set(op.kind, []).get(op.kind)!).push(performance.now() - s);
    (rows.get(op.kind) ?? rows.set(op.kind, []).get(op.kind)!).push(ctx.slice.stats.rows);
  }));
  const wall = performance.now() - t0;
  assert.deepEqual(errors, [], errors.slice(0, 5).join("\n"));

  report.operations = all.length;
  report.concurrency = 24;
  report.wallMs = Math.round(wall);
  report.throughputPerSec = Math.round((all.length / wall) * 1000);
  report.byKind = Object.fromEntries(
    [...latency].map(([k, xs]) => [k, { n: xs.length, p50ms: pct(xs, 50), p95ms: pct(xs, 95), maxMs: Math.round(Math.max(...xs)), maxRows: Math.max(...(rows.get(k) ?? [0])) }]),
  );
  report.writeConflictsRetried = A.stats.conflicts + B.stats.conflicts;
  report.raceRefusals = expectedRefusals;

  // The rules held under load.
  const [{ n: doubleBooked }] = await db<{ n: number }[]>`select count(*)::int as n from (select request_id from lv_jobs where status <> 'cancelled' group by 1 having count(*) > 1) x`;
  const [{ n: doubleAccepted }] = await db<{ n: number }[]>`select count(*)::int as n from (select request_id from lv_quotes where status = 'accepted' group by 1 having count(*) > 1) x`;
  assert.equal(doubleBooked, 0, "never two active jobs for one request");
  assert.equal(doubleAccepted, 0, "never two accepted estimates for one request");
  for (const r of races) {
    const [{ n }] = await db<{ n: number }[]>`select count(*)::int as n from lv_jobs where request_id = ${r.r} and status <> 'cancelled'`;
    assert.equal(n, 1, `race on ${r.r}: exactly one booking`);
  }
  const [{ n: made }] = await db<{ n: number }[]>`select count(*)::int as n from lv_requests where idempotency_key like ${`load-${process.pid}-%`}`;
  assert.equal(made, 60, "every new request saved once");

  // Budgets. Row counts are fixed by the loaders' limits (and so don't grow with the marketplace);
  // latency budgets are generous: they catch a whole-table read, not machine noise.
  const k = report.byKind as Record<string, { p95ms: number; maxRows: number }>;
  for (const [kind, v] of Object.entries(k)) {
    const rowBudget = kind === "search" ? 12_000 : kind.startsWith("staff") ? 4_000 : 1_500;
    assert.ok(v.maxRows <= rowBudget, `${kind}: ${v.maxRows} rows > ${rowBudget}`);
    // CI's shared 2-core runners are ~3x slower than a laptop at this concurrency; they set
    // CLUTCH_LATENCY_FACTOR (see .github/workflows/ci.yml). The row budgets above don't change.
    const latencyBudget = 2_000 * (Number(process.env.CLUTCH_LATENCY_FACTOR) || 1);
    assert.ok(v.p95ms < latencyBudget, `${kind}: p95 ${v.p95ms} ms (budget ${latencyBudget} ms)`);
  }
});
