import { test } from "node:test";
import assert from "node:assert/strict";
import { repoFor } from "@/lib/data";
import { current, ready, resetMemoryStores, transact } from "@/lib/data/store";
import { provisionUser } from "@/lib/auth/provision";
import { buildSeed } from "@/lib/data/mock/seed";
import { inheritedDemoFlags } from "@/lib/data/demo-flags";
import { matchReadiness } from "@/lib/matchable";
import type { MechanicProfile } from "@/lib/domain/types";

/**
 * A real request saved while no mechanic fits stays open, and reaches a real mechanic exactly
 * once when their profile starts to fit (here: they finally set a service area). Demo-only
 * flags never survive on real records, and the demo never sees any of it.
 * Fictional example.test fixtures only.
 */

resetMemoryStores();
const live = repoFor("live");
const demo = repoFor("demo");
const seed = buildSeed();

async function starterRequest(tag: string) {
  await ready("live");
  const u = await provisionUser({ id: `wd-cust-${tag}`, email: `wd-cust-${tag}@example.test`, meta: { name: `Casey ${tag}`, role: "customer" } });
  const c = live.getCustomerByUser(u!.id)!;
  return live.createRequest({
    customerId: c.id, vehicleId: "", vehicle: { year: 2015, make: "BMW", model: "328i" }, repairCategory: "starters", categorySource: "customer",
    symptomDescription: "Clicks but won't crank in the morning.", occurrence: { conditions: [] }, onset: {}, warningLights: [], diagnosticCodes: [], smells: [],
    recentRepairs: [], customerParts: [], location: { serviceMode: "mobile", area: "silver-lake" }, media: [],
  });
}

/** A real mechanic as older onboarding left some: no service area, and the demo flag it set on everyone. */
async function legacyMechanic(tag: string) {
  const u = await provisionUser({ id: `wd-mech-${tag}`, email: `wd-mech-${tag}@example.test`, meta: { name: `Sam ${tag}`, role: "mechanic" } });
  const m = await live.upsertMechanicProfile({ userId: u!.id, displayName: `Sam Legacy${tag}`, city: "Los Angeles", neighborhood: "echo-park", serviceRadiusMi: 15, bio: "", workModel: "mobile", declaredRepairCategories: ["brakes", "starters"], declaredMakes: ["BMW"], hourlyRateCents: 12000, diagnosticFeeCents: 10000, availabilityNote: "Weekdays 8 to 5" });
  // Drop the area and add the flag, as the pre-a8baa5b records were stored.
  await transact("live", () => {
    const rec = current("live").mechanics.find((x) => x.id === m.id)! as MechanicProfile & { neighborhood?: string };
    delete rec.neighborhood;
    rec.isDemo = true;
  });
  return { user: u!, m: live.getMechanic(m.id)! };
}

const edit = (m: MechanicProfile, neighborhood?: string) =>
  live.upsertMechanicProfile({ id: m.id, userId: m.userId, displayName: m.displayName, city: m.city, neighborhood, serviceRadiusMi: 15, bio: m.bio, workModel: "mobile", declaredRepairCategories: m.declaredRepairCategories, declaredMakes: m.declaredMakes, hourlyRateCents: m.hourlyRateCents, diagnosticFeeCents: m.diagnosticFeeCents, availabilityNote: m.availabilityNote });

test("a waiting real request reaches a mechanic exactly once, when they set a matching service area", async () => {
  const { user, m } = await legacyMechanic("a");
  const r = await starterRequest("a");
  assert.equal(r.status, "open");
  assert.deepEqual(r.matchedMechanicIds, [], "no mechanic fits: saved, not sent");
  assert.ok(r.waitingSince, "kept waiting for supply");

  const before = matchReadiness(live, m);
  assert.equal(before.matchable, false);
  assert.equal(before.steps.find((s) => !s.optional && !s.done)?.key, "area", "the service area is the step that's missing");
  assert.equal(live.listRequestsForMechanic(m.id).length, 0);

  await edit(m, "echo-park");
  const after = live.getRequest(r.id)!;
  assert.deepEqual(after.matchedMechanicIds, [m.id], "sent to them, once");
  assert.equal(after.waitingSince, undefined);
  assert.deepEqual(live.listRequestsForMechanic(m.id).map((x) => x.id), [r.id], "in their requests");
  const notes = () => live.listNotifications(user.id, "mechanic").filter((x) => x.href === `/mechanic/requests/${r.id}`);
  assert.equal(notes().length, 1, "one notification, linking to the request");
  assert.equal(live.getMechanic(m.id)!.isDemo, undefined, "saving a real profile drops the demo-only flag");

  // Saving again (or any later write) never sends it twice.
  await edit(live.getMechanic(m.id)!, "echo-park");
  await edit(live.getMechanic(m.id)!, "hollywood");
  assert.deepEqual(live.getRequest(r.id)!.matchedMechanicIds, [m.id]);
  assert.equal(notes().length, 1);

  // The demo marketplace never sees the real request, and no demo mechanic received it.
  await ready("demo");
  assert.equal(demo.getRequest(r.id), undefined);
  assert.ok(current("demo").mechanics.every((x) => !live.getRequest(r.id)!.matchedMechanicIds.includes(x.id)));
  assert.ok(current("demo").notifications.every((x) => !x.href.includes(r.id)));
});

test("an area that doesn't reach the request keeps it waiting", async () => {
  const { m } = await legacyMechanic("b");
  const r = await starterRequest("b");
  // Another fitting mechanic may already have it from the first test; this one is out of range.
  const wasMatched = live.getRequest(r.id)!.matchedMechanicIds.length > 0;
  await live.upsertMechanicProfile({ id: m.id, userId: m.userId, displayName: m.displayName, city: m.city, neighborhood: "long-beach", serviceRadiusMi: 5, bio: "", workModel: "mobile", declaredRepairCategories: ["starters"], declaredMakes: ["BMW"], hourlyRateCents: 12000, diagnosticFeeCents: 10000, availabilityNote: "Weekdays" });
  assert.ok(!live.getRequest(r.id)!.matchedMechanicIds.includes(m.id), "Long Beach within 5 mi doesn't reach Silver Lake");
  if (!wasMatched) assert.deepEqual(live.getRequest(r.id)!.matchedMechanicIds, []);
});

test("new real mechanics never carry the demo flag; demo mechanics keep theirs", async () => {
  await ready("live");
  const u = await provisionUser({ id: "wd-mech-new", email: "wd-mech-new@example.test", meta: { name: "Noa New", role: "mechanic" } });
  const m = await live.upsertMechanicProfile({ userId: u!.id, displayName: "Noa New", city: "Los Angeles", neighborhood: "mid-city", serviceRadiusMi: 10, bio: "", workModel: "mobile", declaredRepairCategories: ["brakes"], declaredMakes: ["BMW"], hourlyRateCents: 9000, diagnosticFeeCents: 5000, availabilityNote: "Weekdays" });
  assert.equal(m.isDemo, undefined);
  assert.ok(!/^mech-noa-new$/.test(m.id), "opaque id, never name-based");
  await ready("demo");
  const derek = demo.getMechanic("mech-derek-hall")!;
  await demo.upsertMechanicProfile({ id: derek.id, userId: derek.userId, displayName: derek.displayName, city: derek.city, neighborhood: "mid-city", serviceRadiusMi: derek.serviceRadiusMi, bio: derek.bio, workModel: "mobile", declaredRepairCategories: derek.declaredRepairCategories, declaredMakes: derek.declaredMakes, hourlyRateCents: derek.hourlyRateCents, diagnosticFeeCents: derek.diagnosticFeeCents });
  assert.equal(demo.getMechanic(derek.id)!.isDemo, true, "a demo record stays demo");
});

test("repair: clears isDemo only where provenance proves it wrong", () => {
  const liveUsers = [
    { id: "user-real", email: "real@example.test", roles: ["customer", "mechanic"], name: "Real Person", notificationPrefs: { email: true, sms: false, push: true } },
    { id: "user-demoacct", email: "someone@clutch.demo", roles: ["mechanic"], name: "Demo-ish", notificationPrefs: { email: true, sms: false, push: true } },
    { id: "user-flagged", demo: true, email: "flagged@example.test", roles: ["mechanic"], name: "Flagged", notificationPrefs: { email: true, sms: false, push: true } },
  ];
  const base = seed.mechanics[0];
  const liveMechanics = [
    { ...base, id: "mech-real-person", userId: "user-real", isDemo: true }, // legacy onboarding: repaired
    { ...base, id: "mech-clean", userId: "user-real", isDemo: undefined }, // no flag: untouched
    { ...base, userId: base.userId, isDemo: true }, // a seed record in live: a leak, not ours to relabel
    { ...base, id: "mech-demo-owner", userId: "user-demoacct", isDemo: true }, // owned by a demo address
    { ...base, id: "mech-flagged-owner", userId: "user-flagged", isDemo: true }, // owned by a demo account
    { ...base, id: "mech-orphan", userId: "user-missing", isDemo: true }, // owner unknown: no proof
  ];
  const found = inheritedDemoFlags({ users: liveUsers, mechanics: liveMechanics } as never, seed);
  assert.deepEqual(found.map((f) => f.id), ["mech-real-person"]);
  assert.equal(found[0].userId, "user-real");
});
