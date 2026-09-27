import { test } from "node:test";
import assert from "node:assert/strict";
import { repoFor } from "@/lib/data";
import { current, ready, resetMemoryStores } from "@/lib/data/store";
import { provisionUser } from "@/lib/auth/provision";
import { configsFor } from "@/lib/vehicles/catalog";
import { buildSpec, pruneSelection, STATUS_LABEL } from "@/lib/vehicles/spec";
import { NhtsaCatalogProvider, cachedForTests, clearVehicleCache } from "@/lib/vehicles/provider";
import { fixtureFetch, FIXTURE_VINS } from "@/lib/vehicles/fixtures";
import { legacySpec, unconfirmedEssentials, vehicleSpecOf } from "@/lib/vehicles/effective";
import { confirmSpec } from "@/lib/vehicles/record";
import { planVehicleBackfill } from "@/lib/vehicles/backfill";
import { EMPTY_CHOICE } from "@/lib/vehicles/choice";
import { levelOfSpec } from "@/lib/domain/fact-level";

/**
 * Structured vehicles: year → make → model → configuration with a source on every field, the
 * vPIC adapter's cache and outage behaviour (fixtures, no network), VIN conflicts, honest legacy
 * specs, corrections that keep provenance, persistence and demo/live isolation.
 */

resetMemoryStores();
const live = repoFor("live");
const demo = repoFor("demo");
const P135 = "WBAUC73508VF00135";
const P128 = "WBAUP93558VF00128";

test("2008 BMW 135i with a 6-speed manual: the engine is LIKELY N54, never presented as certain", () => {
  const configs = configsFor(2008, "BMW", "135i");
  assert.ok(configs.length >= 2, "coupe and convertible");
  const sel = pruneSelection(configs, { year: 2008, make: "BMW", model: "135i", transmission: "6MT" });
  const s = buildSpec(sel, configs);
  assert.equal(s.engine?.code, "N54");
  assert.equal(s.engine?.status, "likely", "inferred from the model and year, not confirmed");
  assert.equal(STATUS_LABEL[s.engine!.status], "Likely (inferred)");
  assert.equal(levelOfSpec(s.engine!.status), "inferred");
  assert.equal(s.transmission?.id, "6MT");
  assert.equal(s.transmission?.status, "selected");
  assert.equal(s.body?.status, "needs_confirmation", "coupe or convertible decides the chassis");
  assert.equal(STATUS_LABEL.needs_confirmation, "Unknown");
  const gaps = unconfirmedEssentials(s).gaps.map((g) => g.key);
  assert.ok(gaps.includes("engine"), "the likely engine is still a gap to confirm before quoting parts");
  assert.ok(!gaps.includes("transmission"));
});

test("VIN-decoded 2008 135i: identity matches, so the engine and drive are VIN-decoded", async () => {
  clearVehicleCache();
  const p = new NhtsaCatalogProvider(fixtureFetch);
  const d = await p.decodeVin(P135);
  assert.equal(d.ok, true);
  assert.deepEqual([d.year, d.make, d.model, d.transmissionType, d.drivetrain, d.displacementL, d.cylinders], [2008, "BMW", "135i", "manual", "RWD", 3, 6]);
  const configs = configsFor(2008, "BMW", "135i");
  const s = buildSpec(pruneSelection(configs, { year: 2008, make: "BMW", model: "135i" }), configs, d);
  assert.equal(s.engine?.status, "vin_confirmed");
  assert.equal(STATUS_LABEL.vin_confirmed, "VIN-decoded");
  assert.equal(s.transmission?.id, "6MT", "the VIN's manual settles the transmission");
  assert.equal(s.transmission?.status, "vin_confirmed");
  assert.deepEqual(s.vin.conflicts, []);
  assert.equal(s.vin.last6, P135.slice(-6), "only the last six characters are kept on the spec");
});

test("a VIN that disagrees with the customer's selections is flagged; nothing is overwritten or upgraded", async () => {
  clearVehicleCache();
  const p = new NhtsaCatalogProvider(fixtureFetch);
  const d = await p.decodeVin(P128);
  const configs = configsFor(2008, "BMW", "135i");
  const s = buildSpec(pruneSelection(configs, { year: 2008, make: "BMW", model: "135i", transmission: "6MT" }), configs, d);
  assert.ok(s.vin.conflicts.some((c) => /VIN says 128i, you selected 135i/.test(c)), s.vin.conflicts.join(" "));
  assert.ok(s.vin.conflicts.some((c) => /VIN says automatic/.test(c)));
  assert.equal(s.transmission?.status, "selected", "the customer's choice is kept, not replaced by the VIN");
  assert.equal(s.engine?.status, "likely", "a conflicting VIN never makes the engine 'VIN-decoded'");
  assert.ok(s.open.some((q) => /disagree/.test(q)));
  assert.ok(unconfirmedEssentials(s).conflicts.length >= 2);
});

test("vPIC adapter: live models, then an outage falls back to the catalog; a bad VIN never dead-ends", async () => {
  clearVehicleCache();
  const ok = new NhtsaCatalogProvider(fixtureFetch);
  const m = await ok.models(2008, "BMW");
  assert.equal(m.source, "nhtsa");
  assert.ok(m.models.includes("135i") && m.models.includes("128i"));
  clearVehicleCache();
  let calls = 0;
  const down = new NhtsaCatalogProvider(async () => {
    calls++;
    throw new Error("timeout");
  });
  const f = await down.models(2008, "BMW");
  assert.equal(f.source, "catalog", "the curated catalog answers when NHTSA can't");
  assert.ok(f.models.includes("135i"));
  const before = calls;
  await down.models(2008, "BMW");
  assert.equal(calls, before, "a failure is remembered briefly: an outage isn't hammered");
  const v = await down.decodeVin(P135);
  assert.equal(v.ok, false);
  assert.match(v.warnings.join(" "), /isn't reachable right now. You can still pick the car yourself/);
  const bad = await ok.decodeVin("WBA-not-a-vin");
  assert.equal(bad.ok, false);
  assert.match(bad.warnings[0], /17 letters and numbers/);
});

test("the cache serves fresh answers, keeps the last good answer through an outage, and backs off after a failure", async () => {
  clearVehicleCache();
  let n = 0;
  const t0 = 1_000_000;
  const load = async () => `v${++n}`;
  assert.equal(await cachedForTests("k", 1000, load, t0), "v1");
  assert.equal(await cachedForTests("k", 1000, load, t0 + 500), "v1", "fresh");
  assert.equal(await cachedForTests("k", 1000, load, t0 + 2000), "v2", "refreshed after the TTL");
  const fail = async () => {
    throw new Error("down");
  };
  assert.equal(await cachedForTests("k", 1000, fail, t0 + 5000), "v2", "stale, but better than nothing, during an outage");
  let tried = 0;
  const counting = async () => {
    tried++;
    return "v3";
  };
  assert.equal(await cachedForTests("k", 1000, counting, t0 + 10_000), "v2", "within the back-off it doesn't retry");
  assert.equal(tried, 0);
  assert.equal(await cachedForTests("k", 1000, counting, t0 + 70_000), "v3", "after it, it does");
  await assert.rejects(cachedForTests("never", 1000, fail, t0), /down/, "nothing cached and nothing live: the caller falls back");
});

test("a car saved before structured details is labelled honestly: entered, likely, or unknown", () => {
  const s = legacySpec({ year: 2008, make: "BMW", model: "135i", transmission: "manual" });
  assert.equal(s.legacy, true);
  assert.equal(s.engine?.status, "likely");
  assert.equal(s.transmission?.id, "6MT");
  assert.equal(s.transmission?.status, "customer_text", "from the old form: customer entered, not selected from factory options");
  assert.equal(STATUS_LABEL.customer_text, "Customer entered");
  const other = legacySpec({ year: 2012, make: "Kia", model: "Soul" } as never);
  assert.equal(other.engine?.status, "not_recorded");
  assert.equal(other.engine?.label, "Unknown");
  assert.ok(other.open[0].startsWith("Saved before Clutch recorded structured vehicle details"));
  const snap = buildSpec({ year: 2017, make: "BMW", model: "330i" }, configsFor(2017, "BMW", "330i"));
  assert.equal(vehicleSpecOf({ year: 2017, make: "BMW", model: "330i", spec: undefined }, snap), snap, "a request's own snapshot wins");
});

test("sign-up with the structured picker stores the full spec; editing adds a VIN and keeps the correction history", async () => {
  await ready("live");
  const u = await provisionUser({
    id: "veh-cust-1",
    email: "veh-cust-1@example.test",
    meta: { name: "Jamie Park", role: "customer", car: { choice: { ...EMPTY_CHOICE, year: "2008", make: "BMW", model: "135i", transmission: "6MT" }, year: 2008, make: "BMW", model: "135i", mileage: 94000 } },
  });
  const c = live.getCustomerByUser(u!.id)!;
  const v = live.listVehicles(c.id)[0];
  assert.deepEqual([v.year, v.make, v.model, v.mileage], [2008, "BMW", "135i", 94000]);
  assert.equal(v.spec?.engine?.code, "N54");
  assert.equal(v.spec?.engine?.status, "likely");
  assert.equal(v.engine, undefined, "the flat engine field never records a likely engine as fact");
  assert.equal(v.transmission, "manual");
  // The customer adds the VIN: the engine becomes VIN-decoded, and the history says what it was.
  clearVehicleCache();
  const d = await new NhtsaCatalogProvider(fixtureFetch).decodeVin(P135);
  const configs = configsFor(2008, "BMW", "135i");
  const next = buildSpec(pruneSelection(configs, { year: 2008, make: "BMW", model: "135i", transmission: "6MT" }), configs, d);
  await live.updateVehicle(v.id, { spec: next, vin: P135 });
  const after = live.getVehicle(v.id)!;
  assert.equal(after.spec?.engine?.status, "vin_confirmed");
  const eng = after.spec!.corrections!.find((x) => x.field === "engine")!;
  assert.deepEqual([eng.by, eng.from.status, eng.to.status], ["customer", "likely", "vin_confirmed"]);
  assert.ok(after.spec!.corrections!.some((x) => x.field === "vin"));
  // A mechanic confirms the drivetrain at completion: added, earlier corrections kept.
  const confirmed = confirmSpec(after.spec!, { drivetrain: "RWD" });
  assert.equal(confirmed.corrections!.length, after.spec!.corrections!.length + (after.spec!.drivetrain?.status === "mechanic_confirmed" ? 0 : 1));
  assert.ok(confirmed.corrections!.slice(0, after.spec!.corrections!.length).every((x, i) => x === after.spec!.corrections![i] || JSON.stringify(x) === JSON.stringify(after.spec!.corrections![i])), "history is appended, never rewritten");
  // Persisted in the live store; never in the demo.
  assert.ok(current("live").vehicles.some((x) => x.id === v.id && x.spec?.engine?.status === "vin_confirmed"));
  await ready("demo");
  assert.equal(demo.getVehicle(v.id), undefined);
  assert.ok(current("demo").vehicles.every((x) => x.vin !== P135));
});

test("backfill: only vehicles without a spec, marked legacy; a rerun changes nothing", () => {
  const vs = [
    { id: "a", customerId: "c", year: 2008, make: "BMW", model: "135i", transmission: "manual" },
    { id: "b", customerId: "c", year: 2017, make: "BMW", model: "330i", spec: buildSpec({ year: 2017, make: "BMW", model: "330i" }, configsFor(2017, "BMW", "330i")) },
  ] as never[];
  const plan = planVehicleBackfill(vs);
  assert.deepEqual(plan.map((p) => p.id), ["a"]);
  assert.equal((plan[0].after as { spec: { legacy: boolean } }).spec.legacy, true);
  assert.deepEqual(planVehicleBackfill([plan[0].after as never, vs[1]]), []);
});

test("fixture VINs are fictional test data and only what the adapter needs", () => {
  for (const [vin, r] of Object.entries(FIXTURE_VINS)) {
    assert.equal(vin.length, 17);
    assert.ok(!/SSN|Owner|Address|Name/i.test(JSON.stringify(r)));
  }
});
