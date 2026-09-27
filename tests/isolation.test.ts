import { test } from "node:test";
import assert from "node:assert/strict";
import { repoFor } from "@/lib/data";
import { current, ready, resetMemoryStores } from "@/lib/data/store";
import { scopeFromCookies } from "@/lib/data/scope";
import { sign } from "@/lib/auth/signing";
import { buildSeed, type DB } from "@/lib/data/mock/seed";
import { crossScopeLeaks, splitByScope } from "@/lib/data/classify";
import { ScopeError } from "@/lib/data/mock/repository";
import { getMedia, putMedia } from "@/lib/data/mock/media-store";
import { provisionUser } from "@/lib/auth/provision";
import { replacementFor } from "@/lib/replacement";
import type { RepairRequest } from "@/lib/domain/types";

/**
 * Real accounts only ever see and touch real records; demo sessions see the
 * whole fictional marketplace. Demo ids come from the seed itself, never from
 * names or a hand-kept list.
 */

resetMemoryStores();
const live = repoFor("live");
const demo = repoFor("demo");
const seed = buildSeed();
const LISTS = ["users", "mechanics", "customers", "vehicles", "verifications", "requests", "quotes", "jobs", "reviews", "notifications", "pastRepairs"] as const;

// Test identities only: example.test never delivers mail.
const realCustomer = { id: "test-live-cust", email: "live-cust@example.test", meta: { name: "Robin Real", role: "customer" } };
const realMechanic = { id: "test-live-mech", email: "live-mech@example.test", meta: { name: "Quinn Real", role: "mechanic" } };

async function setupLive() {
  await ready("live");
  await ready("demo");
  await provisionUser(realCustomer);
  await provisionUser(realMechanic);
  if (!live.getMechanicByUser(realMechanic.id)) {
    await live.upsertMechanicProfile({ userId: realMechanic.id, displayName: "Quinn Real", city: "Los Angeles", neighborhood: "mid-city", serviceRadiusMi: 15, bio: "", workModel: "mobile", declaredRepairCategories: ["brakes"], declaredMakes: ["BMW"], hourlyRateCents: 9000, diagnosticFeeCents: 5000, availabilityNote: "Weekdays" });
  }
  const cust = live.getCustomerByUser(realCustomer.id)!;
  const mech = live.getMechanicByUser(realMechanic.id)!;
  return { cust, mech };
}

/** A request body copied from a demo request (content only), re-owned by a live customer. */
function requestInput(customerId: string, over: Record<string, unknown> = {}) {
  const src = seed.requests[0];
  const { id: _id, status: _s, createdAt: _c, matchedMechanicIds: _m, declinedBy: _d, questions: _q, interested: _i, customerId: _cu, vehicleId: _v, rebookOf: _r, requestedMechanicId: _rm, declines: _de, handoffs: _h, ...content } = src as RepairRequest;
  void [_id, _s, _c, _m, _d, _q, _i, _cu, _v, _r, _rm, _de, _h];
  return { ...content, customerId, vehicleId: "", vehicle: { year: 2016, make: "BMW" as const, model: "328i" }, media: [], ...over };
}

test("scope comes only from a validly signed cookie, and only while demo access is on", () => {
  assert.equal(scopeFromCookies(undefined, undefined, true), "live", "everyone starts live");
  assert.equal(scopeFromCookies("demo", undefined, true), "live", "an unsigned (forged) scope cookie is ignored");
  assert.equal(scopeFromCookies(`demo.${"x".repeat(43)}`, undefined, true), "live", "a bad signature is ignored");
  assert.equal(scopeFromCookies(sign("demo"), undefined, true), "demo");
  assert.equal(scopeFromCookies(undefined, sign("user-maya"), true), "demo", "a signed demo account implies demo");
  assert.equal(scopeFromCookies(sign("demo"), sign("user-maya"), false), "live", "demo access switched off: always live");
  assert.equal(scopeFromCookies(sign("live"), undefined, true), "live");
});

test("the live marketplace starts empty of fiction; the demo keeps its whole cast", async () => {
  await ready("live");
  await ready("demo");
  for (const l of LISTS) {
    const liveIds = new Set((current("live")[l] as { id: string }[]).map((x) => x.id));
    for (const d of seed[l] as { id: string }[]) assert.ok(!liveIds.has(d.id), `demo ${l} ${d.id} is not in live`);
  }
  assert.ok(current("live").users.every((u) => !u.demo), "no demo accounts in live");
  assert.equal(demo.listPublicProfiles().length, seed.mechanics.length, "every demo mechanic is listed in the demo");
  assert.ok(current("demo").users.every((u) => u.demo), "every demo account is flagged");
});

test("search: live results never include a demo mechanic, and vice versa", async () => {
  const { mech } = await setupLive();
  const liveSlugs = live.listPublicProfiles().map((p) => p.slug);
  const demoSlugs = new Set(seed.mechanics.map((m) => m.slug));
  assert.ok(liveSlugs.every((s) => !demoSlugs.has(s)), "no demo slug in live search");
  assert.ok(demo.listPublicProfiles().every((p) => p.slug !== mech.slug), "the real mechanic isn't in the demo");
});

test("direct lookups by id or slug don't cross scopes", async () => {
  const { cust, mech } = await setupLive();
  for (const m of seed.mechanics) {
    assert.equal(live.getMechanic(m.id), undefined);
    assert.equal(live.getMechanicBySlug(m.slug), undefined);
    assert.equal(live.getPublicProfile(m.slug), null, `/mechanics/${m.slug} is not found for real visitors`);
  }
  for (const u of seed.users) assert.equal(live.getUser(u.id), undefined);
  for (const c of seed.customers) assert.equal(live.getCustomer(c.id), undefined);
  for (const v of seed.vehicles) assert.equal(live.getVehicle(v.id), undefined);
  for (const r of seed.requests) assert.equal(live.getRequest(r.id), undefined);
  for (const q of seed.quotes) assert.equal(live.getQuote(q.id), undefined);
  for (const j of seed.jobs) assert.equal(live.getJob(j.id), undefined);
  for (const v of seed.verifications) assert.equal(live.getVerification(v.id), undefined);
  // And the other way round.
  assert.equal(demo.getUser(realCustomer.id), undefined);
  assert.equal(demo.getCustomer(cust.id), undefined);
  assert.equal(demo.getMechanic(mech.id), undefined);
  assert.equal(demo.getPublicProfile(mech.slug), null);
});

test("recommendations: a real request is matched only to real mechanics", async () => {
  const { cust } = await setupLive();
  const req = await live.createRequest(requestInput(cust.id));
  const liveMechs = new Set(current("live").mechanics.map((m) => m.id));
  assert.ok(req.matchedMechanicIds.every((id) => liveMechs.has(id)), "matched ids are all live mechanics");
  const demoMechs = new Set(seed.mechanics.map((m) => m.id));
  assert.ok(req.matchedMechanicIds.every((id) => !demoMechs.has(id)));
  // "Pick someone else" suggestions after a decline come from the same marketplace.
  const rep = await replacementFor(live, { ...req, declinedBy: req.matchedMechanicIds });
  for (const s of rep?.suggestions ?? []) assert.ok(!demoMechs.has(s.fit.p.id), "no demo replacement suggestions");
  for (const id of rep?.broaden ?? []) assert.ok(!demoMechs.has(id), "no demo mechanics to broaden to");
  // The demo still matches its own mechanics.
  const demoReq = demo.listRequestsForCustomer("cust-maya")[0];
  assert.ok(demoReq && demoReq.matchedMechanicIds.length > 0 && demoReq.matchedMechanicIds.every((id) => demoMechs.has(id)));
});

test("requests: a real request can't be sent to, or rebook, a demo mechanic", async () => {
  const { cust } = await setupLive();
  const demoMech = seed.mechanics[0].id;
  await assert.rejects(live.createRequest(requestInput(cust.id, { directTo: demoMech })), ScopeError);
  await assert.rejects(live.createRequest(requestInput(cust.id, { rebookOf: demoMech })), ScopeError);
  const req = await live.createRequest(requestInput(cust.id));
  await assert.rejects(live.forwardRequest(req.id, [demoMech], "replacement"), ScopeError);
  assert.ok(!live.getRequest(req.id)!.matchedMechanicIds.includes(demoMech));
  // A demo customer can't use a real car, and a real customer can't use a demo car.
  await assert.rejects(live.createRequest(requestInput(cust.id, { vehicle: undefined, vehicleId: seed.vehicles[0].id })), ScopeError);
  await assert.rejects(demo.createRequest(requestInput("cust-maya", { directTo: live.getMechanicByUser(realMechanic.id)!.id })), ScopeError);
  // Demo mechanics see no real requests.
  for (const m of seed.mechanics) assert.equal(live.listRequestsForMechanic(m.id).length, 0);
});

test("quotes: a demo mechanic can't quote a real request (in either store)", async () => {
  const { cust, mech } = await setupLive();
  const req = await live.createRequest(requestInput(cust.id, { directTo: mech.id }));
  const demoMech = seed.mechanics[0].id;
  const body = { requestId: req.id, mechanicId: demoMech, laborCents: 10000, diagnosticFeeCents: 0, travelFeeCents: 0, partsIncluded: false, partsEstimateCents: 0, durationHours: 1, availableOn: "Tomorrow", serviceMode: "mobile" as const, scope: "Test" };
  await assert.rejects(live.submitQuote(body), ScopeError, "the demo mechanic doesn't exist in live");
  await assert.rejects(demo.submitQuote(body), ScopeError, "the real request doesn't exist in the demo");
  assert.equal(live.listQuotesForRequest(req.id).length, 0);
  // A real mechanic can quote the real request it was sent to.
  const q = await live.submitQuote({ ...body, mechanicId: mech.id });
  assert.equal(live.getQuote(q.id)?.mechanicId, mech.id);
  // But not a demo request.
  await assert.rejects(live.submitQuote({ ...body, requestId: seed.requests[0].id, mechanicId: mech.id }), ScopeError);
});

test("jobs, messages and notifications stay inside one marketplace", async () => {
  const { cust, mech } = await setupLive();
  const req = await live.createRequest(requestInput(cust.id, { directTo: mech.id }));
  const demoMech = seed.mechanics[0].id;
  await assert.rejects(live.askQuestion(req.id, demoMech, "Is it the front?"), ScopeError);
  await assert.rejects(live.markInterested(req.id, demoMech), ScopeError);
  await assert.rejects(live.notify("user-maya", "customer", "new_quote", "x", "/customer"), ScopeError);
  await assert.rejects(live.toggleSaved(cust.id, demoMech), ScopeError);
  await assert.rejects(live.setCustomerNote(demoMech, cust.id, "note"), ScopeError);
  // No demo notification, job or message is visible to the real accounts.
  assert.ok(live.listNotifications(realCustomer.id, "customer").every((n) => !n.href.includes("demo")));
  assert.equal(live.listJobsForCustomer(cust.id).filter((j) => seed.jobs.some((s) => s.id === j.id)).length, 0);
  assert.equal(demo.listNotifications(realCustomer.id, "customer").length, 0);
  assert.equal(demo.listJobsForCustomer(cust.id).length, 0);
  for (const m of seed.mechanics) assert.equal(live.listJobsForMechanic(m.id).length, 0);
});

test("reviews: real profiles carry no demo reviews, and demo reviews stay in the demo", async () => {
  const { mech } = await setupLive();
  const p = live.getPublicProfile(mech.slug)!;
  const demoReviewIds = new Set(seed.reviews.map((r) => r.id));
  const all = [...p.reviews.verified, ...p.reviews.customerConfirmed, ...p.reviews.testimonials];
  assert.ok(all.every((r) => !demoReviewIds.has(r.id)));
  assert.ok(current("live").reviews.every((r) => !demoReviewIds.has(r.id)));
  for (const j of seed.jobs) assert.equal(live.getReviewForJob(j.id), undefined);
  assert.ok(demo.listPublicProfiles().some((x) => x.reviews.verified.length > 0), "the demo still shows reviews");
});

test("verification and admin: real reviewers see only real submissions; demo reviewers can't decide real ones", async () => {
  const { mech } = await setupLive();
  await live.submitCredential(mech.id, { kind: "ase", name: "ASE A5 Brakes", issuer: "ASE", documentName: "ase.pdf" } as never);
  const liveQueue = live.listVerifications();
  const demoVerIds = new Set(seed.verifications.map((v) => v.id));
  assert.ok(liveQueue.length > 0 && liveQueue.every((v) => !demoVerIds.has(v.id)), "no demo submissions in the real queue");
  assert.ok(demo.listVerifications().every((v) => v.mechanicId !== mech.id), "real submissions aren't in the demo queue");
  // The demo reviewer account doesn't exist in live, so it can't approve anything real.
  const demoAdmin = seed.users.find((u) => u.roles.includes("admin"))!;
  await assert.rejects(live.decideVerification(liveQueue[0].id, "verified", demoAdmin.id, "ok"), ScopeError);
  // A real, non-staff account can't either.
  await assert.rejects(live.decideVerification(liveQueue[0].id, "verified", realCustomer.id, "ok"), /staff/);
  assert.notEqual(live.getVerification(liveQueue[0].id)?.status, "verified");
});

test("counts and analytics are per marketplace", async () => {
  const { mech } = await setupLive();
  const demoEventsBefore = current("demo").events.length;
  live.track("profile_view", { mechanicId: mech.id });
  assert.equal(current("demo").events.length, demoEventsBefore, "a real event doesn't land in the demo");
  const demoMech = seed.mechanics[0].id;
  const s = (await live.analyticsSummary(demoMech)) as Record<string, number>;
  assert.ok(Object.values(s).every((n) => n === 0), "a demo mechanic has no activity in live");
});

test("uploads are only readable from the marketplace they were uploaded in", async () => {
  const file = { displayName: "brake.jpg", contentType: "image/jpeg", kind: "photo" as const, bytes: new Uint8Array([0xff, 0xd8, 0xff]) };
  const m = await putMedia("demo", "user-maya", file, "damage");
  assert.ok(await getMedia("demo", m.id));
  assert.equal(await getMedia("live", m.id), undefined);
});

test("real sign-ups always go to live, even if an id collides with a demo record", async () => {
  await ready("demo");
  const u = await provisionUser({ id: "test-live-2", email: "live2@example.test", meta: { name: "Sam Test", role: "customer" } });
  assert.ok(u && !u.demo);
  assert.ok(current("live").users.some((x) => x.id === "test-live-2"));
  assert.ok(!current("demo").users.some((x) => x.id === "test-live-2"));
});

test("migration: a mixed pre-scope database splits deterministically, without losing anything", () => {
  const mixed = structuredClone(buildSeed()) as DB;
  const s0 = buildSeed();
  const demoMech = s0.mechanics[0].id;
  const demoMech2 = s0.mechanics[1].id;
  // A real account and profile (not in the seed, not flagged demo)...
  mixed.users.push({ id: "real-user", roles: ["customer", "mechanic"], name: "Real Person", email: "real@example.test", notificationPrefs: { email: true, sms: false, push: false }, createdAt: "2026-09-01" } as never);
  mixed.customers.push({ id: "real-cust", userId: "real-user", displayName: "Real Person", city: "Los Angeles" });
  mixed.vehicles.push({ id: "real-veh", customerId: "real-cust", year: 2015, make: "Honda", model: "Civic" } as never);
  mixed.mechanics.push({ ...structuredClone(s0.mechanics[0]), id: "real-mech", userId: "real-user", slug: "real-person" });
  mixed.verifications.push({ ...structuredClone(s0.verifications[0]), id: "real-ver", mechanicId: "real-mech", status: "pending" });
  // ...whose request was matched to demo mechanics, one of which quoted, got booked and reviewed.
  const req = { ...structuredClone(s0.requests[0]), id: "real-req", customerId: "real-cust", vehicleId: "real-veh", matchedMechanicIds: [demoMech, "real-mech"], interested: [{ mechanicId: demoMech2, at: "2026-09-02" }], requestedMechanicId: demoMech };
  mixed.requests.push(req);
  mixed.quotes.push({ ...structuredClone(s0.quotes[0]), id: "mixed-quote", requestId: "real-req", mechanicId: demoMech });
  mixed.jobs.push({ ...structuredClone(s0.jobs[0]), id: "mixed-job", quoteId: "mixed-quote", requestId: "real-req", mechanicId: demoMech, customerId: "real-cust" });
  mixed.reviews.push({ ...structuredClone(s0.reviews[0]), id: "mixed-review", jobId: "mixed-job", mechanicId: demoMech });
  mixed.saved.push({ customerId: "real-cust", mechanicId: demoMech, savedAt: "2026-09-03" });
  // A demo account's activity on the real marketplace (Derek said he's interested).
  mixed.notifications.push({ id: "real-ntf", userId: "real-user", mode: "customer", kind: "mechanic_interested", title: "x", href: "/customer/requests/real-req", createdAt: "2026-09-02", read: false });
  // A real user's notification about a demo job (how the first real database leaked).
  mixed.notifications.push({ id: "leaky-ntf", userId: "real-user", mode: "customer", kind: "appointment_confirmed", title: "Derek is confirmed", href: `/customer/jobs/${s0.jobs[0].id}`, createdAt: "2026-09-02", read: false });

  const run = () => splitByScope(structuredClone(mixed), buildSeed());
  const a = run();
  const b = run();
  assert.deepEqual(a, b, "deterministic");

  const ids = (db: DB, l: keyof DB) => (db[l] as { id?: string }[]).map((x) => x.id);
  // Every seed record is demo; the real ones are live.
  for (const l of LISTS) for (const d of s0[l] as { id: string }[]) assert.ok(ids(a.demo, l).includes(d.id), `seed ${l} ${d.id} → demo`);
  assert.ok(ids(a.live, "users").includes("real-user") && !ids(a.demo, "users").includes("real-user"));
  assert.ok(ids(a.live, "mechanics").includes("real-mech"));
  assert.ok(ids(a.live, "verifications").includes("real-ver"));
  assert.ok(ids(a.live, "notifications").includes("real-ntf"));
  // The real request keeps only real links; the demo ones are kept aside on the record.
  const r = a.live.requests.find((x) => x.id === "real-req")! as RepairRequest & { crossScopeRefs?: Record<string, unknown> };
  assert.deepEqual(r.matchedMechanicIds, ["real-mech"]);
  assert.equal(r.interested.length, 0);
  assert.equal(r.requestedMechanicId, undefined);
  assert.deepEqual(r.crossScopeRefs?.matchedMechanicIds, [demoMech]);
  assert.equal(r.crossScopeRefs?.requestedMechanicId, demoMech);
  // Records that only make sense across both are quarantined, not deleted.
  const q = a.quarantine.map((x) => `${x.collection}:${x.id}`).sort();
  assert.deepEqual(q, ["jobs:mixed-job", "notifications:leaky-ntf", "quotes:mixed-quote", "reviews:mixed-review", `saved:real-cust:${demoMech}`].sort());
  // Nothing lost: every input record is in exactly one place.
  for (const l of LISTS) {
    const total = (a.live[l] as unknown[]).length + (a.demo[l] as unknown[]).length + a.quarantine.filter((x) => x.collection === l).length;
    assert.equal(total, (mixed[l] as unknown[]).length, `${l} count preserved`);
  }
  // Demo record content is untouched.
  assert.deepEqual(a.demo.requests.find((x) => x.id === s0.requests[0].id), s0.requests[0]);
});

test("standing check: every link resolves in its own scope, or the record is quarantined", () => {
  const s0 = buildSeed();
  const demoDb = structuredClone(s0) as DB;
  const liveDb = structuredClone(emptyLike(s0));
  liveDb.users.push({ id: "u1", roles: ["customer"], name: "Real", email: "r@example.test", notificationPrefs: { email: true, sms: false, push: false } } as never);
  liveDb.customers.push({ id: "c1", userId: "u1", displayName: "Real", city: "Los Angeles" });
  liveDb.notifications.push(
    { id: "ok", userId: "u1", mode: "customer", kind: "new_quote", title: "fine", href: "/customer/requests", createdAt: "2026-09-01", read: false },
    { id: "bad-job", userId: "u1", mode: "customer", kind: "appointment_confirmed", title: "x", href: `/customer/jobs/${s0.jobs[0].id}`, createdAt: "2026-09-01", read: false },
    { id: "bad-profile", userId: "u1", mode: "customer", kind: "new_quote", title: "x", href: `/mechanics/${s0.mechanics[0].slug}`, createdAt: "2026-09-01", read: false },
  );
  liveDb.saved.push({ customerId: "c1", mechanicId: s0.mechanics[0].id, savedAt: "2026-09-01" });
  const r = crossScopeLeaks(liveDb, demoDb);
  assert.deepEqual(r.quarantine.map((x) => `${x.collection}:${x.id}`).sort(), ["notifications:bad-job", "notifications:bad-profile", `saved:c1:${s0.mechanics[0].id}`].sort());
  assert.deepEqual(liveDb.notifications.map((n) => n.id), ["ok"]);
  // The demo on its own is consistent.
  assert.equal(crossScopeLeaks(demoDb, liveDb).quarantine.length, 0);
});

function emptyLike(db: DB): DB {
  const out = structuredClone(db) as unknown as Record<string, unknown>;
  for (const k of Object.keys(out)) out[k] = Array.isArray(out[k]) ? [] : {};
  return out as unknown as DB;
}
