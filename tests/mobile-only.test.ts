import { test } from "node:test";
import assert from "node:assert/strict";
import { repoFor } from "@/lib/data";
import { current, ready, resetMemoryStores, transact } from "@/lib/data/store";
import { provisionUser } from "@/lib/auth/provision";
import { toPublicProfile } from "@/lib/domain/public-profile";
import { eligibility } from "@/lib/domain/eligibility";
import { emptyDraft, stepErrors } from "@/lib/domain/intake-draft";
import { draftToRequest } from "@/lib/domain/intake-preview";
import { serves, findArea } from "@/lib/domain/areas";
import { siteAssessment } from "@/lib/domain/site";

/**
 * Since 2026-09-26 every Clutch mechanic is mobile: they go to the car. Customers are only asked
 * where the car is, and records saved before (a "shop" mechanic, a "shop" request) behave as
 * mobile everywhere. Fictional example.test fixtures only.
 */

resetMemoryStores();
const live = repoFor("live");

async function mechanic(id: string, radius: number) {
  await ready("live");
  const u = await provisionUser({ id, email: `${id}@example.test`, meta: { name: "Rae", role: "mechanic" } });
  return live.upsertMechanicProfile({ userId: u!.id, displayName: `Rae ${id}`, city: "Los Angeles", neighborhood: "mid-city", serviceRadiusMi: radius, bio: "", workModel: "mobile", declaredRepairCategories: ["brakes"], declaredMakes: ["BMW"], hourlyRateCents: 9000, diagnosticFeeCents: 5000, availabilityNote: "Weekdays" });
}

test("the request form doesn't ask where the repair happens; every request is at the car", () => {
  const d = { ...emptyDraft(), symptomDescription: "Grinding from the front when braking.", startsStatus: "normal" as const, area: "mid-city" };
  assert.deepEqual(stepErrors(d, 2, true), [], "area is all the location step needs");
  assert.deepEqual(stepErrors({ ...d, area: "" }, 2, true), ["Choose the area the car is in."]);
  const { preview } = draftToRequest({ ...d, address: "1 Fixture St", parkingType: "driveway" }, "c1", []);
  assert.equal(preview.location.serviceMode, "mobile");
  assert.equal(preview.location.address, "1 Fixture St", "the address and site details are always kept");
  assert.equal(preview.location.parkingType, "driveway");
});

test("a mechanic saved as shop-only before the change is shown, matched and checked as mobile", async () => {
  const m = await mechanic("mo-legacy", 10);
  // As an older record would hold it.
  await transact("live", () => {
    const row = current("live").mechanics.find((x) => x.id === m.id)!;
    Object.assign(row, { workModel: "shop", shopName: "Legacy Garage (demo)" });
  });
  const p = toPublicProfile(live.getMechanicSources(m.id));
  assert.equal(p.workModel, "mobile");
  assert.ok(!("shopName" in p) || !(p as { shopName?: string }).shopName, "no shop name on the public profile");
  assert.ok(p.safety.drivingApplies, "a driving record applies to every mechanic");
  assert.deepEqual(eligibility(p).checks.map((c) => c.name), ["Identity", "Background check", "Driving record", "Insurance"]);
  // Reach is the travel radius, not the old 20-mile shop rule.
  const far = findArea("pasadena")!;
  assert.equal(serves(live.getMechanic(m.id)!, far), false);
  assert.equal(serves(live.getMechanic(m.id)!, findArea("mid-city")!), true);
});

test("a request saved as a shop visit before the change is matched and assessed as at the car", async () => {
  const near = await mechanic("mo-near", 15);
  const c = (await provisionUser({ id: "mo-cust", email: "mo-cust@example.test", meta: { name: "Casey", role: "customer" } }))!;
  const cust = live.getCustomerByUser(c.id)!;
  const r = await live.createRequest({
    customerId: cust.id, vehicleId: "", vehicle: { year: 2016, make: "BMW", model: "328i" }, repairCategory: "brakes", categorySource: "customer",
    symptomDescription: "Grinding from the front when braking.", occurrence: { conditions: [] }, onset: {}, warningLights: [], diagnosticCodes: [], smells: [],
    recentRepairs: [], customerParts: [], location: { serviceMode: "shop" as never, area: "mid-city" }, media: [],
  });
  const got = live.getRequest(r.id)!;
  assert.ok(got.matchedMechanicIds.includes(near.id), "matched by travel radius");
  assert.notEqual(siteAssessment(got).headline, "", "the site is assessed as a mobile job");
  assert.doesNotMatch(siteAssessment(got).headline, /shop/i);
});

test("a place is named once: never 'Inglewood, Inglewood'", async () => {
  const { placeLabel } = await import("@/lib/domain/areas");
  assert.equal(placeLabel("Inglewood", "Inglewood"), "Inglewood");
  assert.equal(placeLabel("Mid-City", "Los Angeles"), "Mid-City, Los Angeles");
  assert.equal(placeLabel(undefined, "Los Angeles"), "Los Angeles");
  assert.equal(placeLabel("long beach", "Long Beach"), "long beach");
  assert.equal(placeLabel("", ""), "");
});
