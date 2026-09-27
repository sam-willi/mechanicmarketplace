import { test } from "node:test";
import assert from "node:assert/strict";
import { repoFor } from "@/lib/data";
import { current, ready, resetMemoryStores } from "@/lib/data/store";
import { buildSeed } from "@/lib/data/mock/seed";
import { provisionUser } from "@/lib/auth/provision";
import { supply } from "@/lib/supply";
import { matchReadiness, waitingDemandFor } from "@/lib/matchable";
import { unmatchedDemand } from "@/lib/demand";
import { opportunities } from "@/lib/mechanic-insights";
import { replacementFor } from "@/lib/replacement";
import { topPicks } from "@/lib/domain/recommend";
import { toPublicProfile } from "@/lib/domain/public-profile";
import { eligibility } from "@/lib/domain/eligibility";
import { isWaitingForMatch } from "@/lib/domain/status";
import { repairChip } from "@/lib/domain/journey";
import type { RepairRequest } from "@/lib/domain/types";

/**
 * The real marketplace with no verified mechanics: nothing blank, nothing invented,
 * and a customer's request is kept, editable and cancellable, and sent on automatically
 * once a real mechanic who fits it is verified. Test identities use example.test.
 */

resetMemoryStores();
const live = repoFor("live");
const demo = repoFor("demo");
const seed = buildSeed();

async function customer(key: string) {
  await ready("live");
  const u = await provisionUser({ id: `zero-cust-${key}`, email: `zero-cust-${key}@example.test`, meta: { name: `Casey ${key}`, role: "customer" } });
  return live.getCustomerByUser(u!.id)!;
}

/** A request body (content only) borrowed from a demo request, owned by a live customer. */
function requestInput(customerId: string, over: Partial<RepairRequest> = {}) {
  const src = seed.requests.find((r) => r.repairCategory === "brakes") ?? seed.requests[0];
  return {
    customerId,
    vehicleId: "",
    vehicle: { year: 2016, make: "BMW" as const, model: "328i" },
    repairCategory: "brakes" as const,
    categorySource: "customer" as const,
    symptomDescription: "Grinding noise from the front when braking.",
    occurrence: { conditions: [] },
    onset: {},
    warningLights: [],
    diagnosticCodes: [],
    smells: [],
    recentRepairs: [],
    customerParts: [],
    location: { serviceMode: "mobile" as const, area: "mid-city" },
    media: [],
    ...(src.urgency ? { urgency: src.urgency } : {}),
    ...over,
  };
}

test("zero live supply: nothing bookable in live, the demo is untouched", async () => {
  await ready("live");
  await ready("demo");
  assert.deepEqual(await supply(live), { profiles: 0, bookable: 0, none: true });
  const d = await supply(demo);
  assert.ok(!d.none && d.bookable > 0, "the demo still has bookable mechanics");
  assert.equal(d.profiles, seed.mechanics.length);
});

test("a request saved with no mechanics is kept in live, marked waiting, and never shows invented matches", async () => {
  const c = await customer("a");
  const r = await live.createRequest(requestInput(c.id));
  assert.deepEqual(r.matchedMechanicIds, []);
  assert.equal(r.status, "open");
  assert.ok(r.waitingSince, "marked as waiting for a match");
  assert.ok(isWaitingForMatch(r));
  assert.equal(repairChip(r, [], undefined).label, "Request submitted", "saved, not yet sent: the first shared stage");
  // Durable in the live store, not the demo.
  assert.ok(current("live").requests.some((x) => x.id === r.id));
  assert.ok(!current("demo").requests.some((x) => x.id === r.id));
  assert.equal(live.listRequestsForCustomer(c.id)[0].id, r.id);
  // "Check again" finds no one and changes nothing.
  assert.equal(await live.rematchRequest(r.id), 0);
  assert.ok(isWaitingForMatch(live.getRequest(r.id)!));
});

test("the customer can edit a waiting request; bad edits are refused without changing it", async () => {
  const c = await customer("b");
  const r = await live.createRequest(requestInput(c.id));
  await live.updateRequest(r.id, { symptomDescription: "Squeal from the rear on light braking.", repairCategory: "suspension", area: "pasadena", serviceMode: "mobile", urgency: "this_week", preferredTimes: "Saturday morning" });
  const e = live.getRequest(r.id)!;
  assert.equal(e.symptomDescription, "Squeal from the rear on light braking.");
  assert.equal(e.repairCategory, "suspension");
  assert.equal(e.categorySource, "customer");
  assert.equal(e.location.area, "pasadena");
  assert.equal(e.location.serviceMode, "mobile");
  assert.equal(e.preferredTimes, "Saturday morning");
  assert.ok(e.updatedAt);
  assert.ok(isWaitingForMatch(e), "still waiting after the edit");
  await assert.rejects(live.updateRequest(r.id, { symptomDescription: "short", repairCategory: "brakes", serviceMode: "mobile" }), /sentence/);
  assert.equal(live.getRequest(r.id)!.repairCategory, "suspension", "a refused edit changes nothing");
});

test("the customer can cancel a request; it stays in their history and leaves the demand list", async () => {
  const c = await customer("c");
  const r = await live.createRequest(requestInput(c.id));
  assert.ok((await unmatchedDemand(live)).rows.some((x) => x.id === r.id));
  await live.cancelRequest(r.id);
  const x = live.getRequest(r.id)!;
  assert.equal(x.status, "cancelled");
  assert.ok(x.cancelledAt);
  assert.ok(!isWaitingForMatch(x));
  assert.equal(repairChip(x, [], undefined).label, "Cancelled");
  assert.ok(live.listRequestsForCustomer(c.id).some((y) => y.id === r.id), "kept for their records");
  assert.ok(!(await unmatchedDemand(live)).rows.some((y) => y.id === r.id));
  await assert.rejects(live.updateRequest(r.id, { symptomDescription: "Changed my mind about it.", repairCategory: "brakes", serviceMode: "mobile" }), /can't be changed/);
  await live.cancelRequest(r.id); // idempotent
  // A booked repair is cancelled from the repair, not the request.
  const booked = current("demo").requests.find((q) => q.status === "booked")!;
  await ready("demo");
  await assert.rejects(demo.cancelRequest(booked.id), /booked/);
});

test("no recommendation candidates: no Best Fit or Soonest Strong Fit, no suggestions, nothing to broaden", async () => {
  assert.deepEqual(topPicks([], { repair: "brakes", make: "BMW" }), []);
  const c = await customer("d");
  const r = await live.createRequest(requestInput(c.id));
  // Not a decline, so no replacement panel at all.
  assert.equal(await replacementFor(live, r), null);
});

test("a new real mechanic gets an honest, empty dashboard with a path to become matchable", async () => {
  await ready("live");
  const u = await provisionUser({ id: "zero-mech-1", email: "zero-mech-1@example.test", meta: { name: "Morgan Zero", role: "mechanic" } });
  const m = await live.upsertMechanicProfile({ userId: u!.id, displayName: "Morgan Zero", city: "Los Angeles", neighborhood: "mid-city", serviceRadiusMi: 10, bio: "", workModel: "mobile", declaredRepairCategories: ["brakes"], declaredMakes: ["BMW"], hourlyRateCents: 9000, diagnosticFeeCents: 5000 });
  assert.equal(m.neighborhood, "Mid-City", "based in a launch area, placed on the map from it");
  assert.ok(!m.isDemo);
  const p = toPublicProfile(live.getMechanicSources(m.id));
  assert.deepEqual(opportunities(live, m, p), [], "no opportunities, and never demo ones");
  assert.equal(live.listRequestsForMechanic(m.id).length, 0);
  const ready1 = matchReadiness(live, m);
  assert.equal(ready1.matchable, false);
  assert.ok(ready1.steps.find((s) => s.key === "area")!.done);
  assert.ok(ready1.steps.find((s) => s.key === "repairs")!.done);
  assert.ok(!ready1.steps.find((s) => s.key === "availability")!.done, "availability is the missing required step");
  const idStep = ready1.steps.find((s) => s.key === "identity")!;
  assert.ok(!idStep.done && idStep.optional, "checks are optional steps, shown as not completed");
  assert.ok(!ready1.steps.some((s) => s.optional && ready1.steps.indexOf(s) < ready1.steps.findIndex((x) => x.key === "availability")), "required steps come first");
  // Saved requests that fit their profile are counted (never listed) for them.
  assert.ok(waitingDemandFor(live, m) >= 1);
});

test("without a real screening provider, real checks can't be started or approved by hand; the demo still works", async () => {
  const m = live.getMechanicByUser("zero-mech-1")!;
  await assert.rejects(live.startScreening(m.id, "identity", true), /hosted identity flow/);
  await assert.rejects(live.startScreening(m.id, "background", true), /aren't open yet/);
  assert.equal(live.getMechanicSources(m.id).screenings.length, 0, "nothing was started");
  assert.ok(matchReadiness(live, m).waitingOnProvider);
  // A check started before this rule (as in databases from earlier builds) can't be approved.
  const d = current("live");
  d.screenings.push({ id: "scr-legacy", mechanicId: m.id, kind: "identity", provider: "mock", providerRef: "mock_identity_legacy", status: "in_progress" });
  d.verifications.push({ id: "ver-legacy", mechanicId: m.id, subjectType: "screening_check", subjectId: "scr-legacy", category: "identity", method: "vendor_screening", provider: "mock", status: "in_progress", submittedAt: "2026-09-20", notes: "" } as never);
  const staff = await provisionUser({ id: "zero-staff", email: "staff@example.test", meta: { name: "Sky Staff", role: "customer" } });
  assert.ok(live.unrunScreening(live.getVerification("ver-legacy")!));
  await assert.rejects(live.decideVerification("ver-legacy", "approve", staff!.id, { reasonCode: "evidence_matches" }), /provider decides/);
  await live.refreshScreening(m.id, "identity");
  assert.equal(live.getMechanicSources(m.id).screenings.find((s) => s.id === "scr-legacy")!.status, "in_progress", "the stand-in never clears a real check");
  await assert.rejects(live.decideVerification("ver-legacy", "reject", staff!.id, { reasonCode: "other", note: "Run again" }), /provider decides/, "a provider-run check is never rejected by hand either");
  const dm = current("demo").mechanics.find((x) => x.slug === "marcus-webb") ?? current("demo").mechanics[0];
  await demo.startScreening(dm.id, "background", true);
  await demo.refreshScreening(dm.id, "background");
  const dsc = demo.getMechanicSources(dm.id).screenings.filter((s) => s.kind === "background").at(-1)!;
  assert.equal(dsc.status, "verified", "the demo still shows the full flow");
});

test("once a real mechanic finishes their profile, waiting requests that fit are sent to them; no check is required", async () => {
  const c = await customer("e");
  const r = await live.createRequest(requestInput(c.id));
  const outside = await live.createRequest(requestInput(c.id, { repairCategory: "electrical", symptomDescription: "Dash lights flicker at idle." } as Partial<RepairRequest>));
  // Saved by an earlier build, before requests were marked `waitingSince`.
  const legacy = await live.createRequest(requestInput(c.id));
  delete current("live").requests.find((x) => x.id === legacy.id)!.waitingSince;
  const m = live.getMechanicByUser("zero-mech-1")!;
  assert.equal(live.getRequest(r.id)!.matchedMechanicIds.length, 0, "not sent while the profile has no availability");
  // The mechanic adds when they work: the basic profile is complete. No check has been verified.
  await live.upsertMechanicProfile({ userId: m.userId, displayName: "Morgan Zero", city: "Los Angeles", neighborhood: "mid-city", serviceRadiusMi: 10, bio: "", workModel: "mobile", declaredRepairCategories: ["brakes"], declaredMakes: ["BMW"], hourlyRateCents: 9000, diagnosticFeeCents: 5000, availabilityNote: "Weekdays 8 to 5" });
  assert.ok(matchReadiness(live, live.getMechanic(m.id)!).matchable);
  const e = eligibility(toPublicProfile(live.getMechanicSources(m.id)));
  assert.ok(e.eligible && !e.fullyVerified, "bookable, and shown as not verified");
  // The legacy identity check from the previous test was started but no provider ever ran it.
  assert.deepEqual(e.checks.map((x) => x.label), ["Identity: Could not be verified", "Background check: Not completed", "Driving record: Not completed", "Insurance: Not completed"]);
  const sent = live.getRequest(r.id)!;
  assert.ok(sent.matchedMechanicIds.includes(m.id), "sent on to the mechanic who now fits");
  assert.equal(sent.waitingSince, undefined);
  assert.ok(live.listNotifications(c.userId, "customer").some((n) => n.href === `/customer/requests/${r.id}` && !/verified mechanic/.test(n.title)), "the customer is told, without calling them verified");
  assert.ok(live.listNotifications(m.userId, "mechanic").some((n) => n.href === `/mechanic/requests/${r.id}`));
  assert.ok(live.getRequest(legacy.id)!.matchedMechanicIds.includes(m.id), "a request saved by an earlier build is sent too");
  // A request the mechanic doesn't do stays waiting.
  assert.ok(isWaitingForMatch(live.getRequest(outside.id)!));
  // Declined by the only mechanic: no suggestions or broaden list are invented.
  await live.declineRequest(r.id, m.id);
  const rep = await replacementFor(live, live.getRequest(r.id)!);
  assert.ok(rep, "the customer is told their mechanic can't take it");
  assert.deepEqual(rep!.suggestions, []);
  assert.deepEqual(rep!.broaden, []);
});

test("staff demand view: real unmatched requests only, grouped for recruiting, with no customer identity", async () => {
  await ready("live");
  await ready("demo");
  const d = await unmatchedDemand(live);
  const liveIds = new Set(current("live").requests.map((r) => r.id));
  const demoIds = new Set(seed.requests.map((r) => r.id));
  assert.ok(d.rows.length > 0);
  assert.ok(d.rows.every((r) => liveIds.has(r.id) && !demoIds.has(r.id)), "no demo demand in the real view");
  assert.ok(d.byArea.length && d.byCategory.length && d.byMake.length && d.byStatus.length);
  assert.ok(d.rows.every((r) => r.ageDays >= 0));
  for (const row of d.rows) for (const k of Object.keys(row)) assert.ok(!/customer|name|email|phone|address/i.test(k), `no personal field ${k}`);
  const dd = await unmatchedDemand(demo);
  assert.ok(dd.rows.every((r) => !liveIds.has(r.id)), "no real demand in the demo view");
});
