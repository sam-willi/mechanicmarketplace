import { test } from "node:test";
import assert from "node:assert/strict";
import { repoFor } from "@/lib/data";
import { current, ready, resetMemoryStores, transact } from "@/lib/data/store";
import { provisionUser } from "@/lib/auth/provision";
import { LifecycleError } from "@/lib/domain/transitions";
import { toPublicProfile } from "@/lib/domain/public-profile";
import { eligibility, INSURANCE_UNVERIFIED_NOTE } from "@/lib/domain/eligibility";
import { ACK_TEXT, checksNow, DISCLOSURE_VERSION, disclosureText, snapshotKey } from "@/lib/domain/disclosure";
import { explainSearch, rankSearch } from "@/lib/domain/search";
import { dominantReason, fitReasons, topPicks } from "@/lib/domain/recommend";
import { matchReadiness } from "@/lib/matchable";
import type { Quote } from "@/lib/domain/types";

/**
 * Policy of 2026-09-26: a mechanic with a complete basic profile can receive requests, send
 * estimates and be booked without any verification check. Each check stays separate and
 * visible; booking an unverified mechanic needs the customer's explicit acknowledgement of
 * exactly what isn't verified, kept with the booking. Fictional example.test fixtures only.
 */

resetMemoryStores();
const live = repoFor("live");
let n = 0;

async function customer() {
  await ready("live");
  const id = `vp-cust-${++n}`;
  const u = await provisionUser({ id, email: `${id}@example.test`, meta: { name: `Casey ${n}`, role: "customer" } });
  return live.getCustomerByUser(u!.id)!;
}

let staffId = "";
async function staff() {
  if (!staffId) staffId = (await provisionUser({ id: "vp-staff", email: "staff@example.test", meta: { name: "Sky Staff", role: "customer" } }))!.id;
  return staffId;
}

/** A mechanic with a complete basic profile and no checks at all. */
async function unverifiedMechanic(workModel: "mobile" = "mobile") {
  await ready("live");
  const id = `vp-mech-${++n}`;
  const u = await provisionUser({ id, email: `${id}@example.test`, meta: { name: `Uma ${n}`, role: "mechanic" } });
  return live.upsertMechanicProfile({ userId: u!.id, displayName: `Uma Unverified${n}`, city: "Los Angeles", neighborhood: "mid-city", serviceRadiusMi: 15, bio: "", workModel, declaredRepairCategories: ["brakes"], declaredMakes: ["BMW"], hourlyRateCents: 9000, diagnosticFeeCents: 5000, availabilityNote: "Weekdays" });
}

/** Record ID, background and driving record as a connected provider would, and insurance reviewed by staff. */
async function verify(mechanicId: string, insuranceExpires = "2027-12-31") {
  await transact("live", () => {
    for (const kind of ["identity", "background", "driving_record"] as const) {
      current("live").screenings.push({ id: `scr-${mechanicId}-${kind}`, mechanicId, kind, provider: "provider-under-test", providerRef: `ref-${kind}`, status: "verified", result: "clear", completedAt: "2026-09-20", expiresAt: "2027-09-20" });
    }
  });
  await live.submitInsurance(mechanicId, { carrier: "Test Mutual", expiresOn: insuranceExpires, documentIds: ["doc-test"] });
  const ins = live.listVerifications({ mechanicId, statuses: ["submitted"] }).find((v) => v.category === "insurance")!;
  await live.decideVerification(ins.id, "approve", await staff(), { reasonCode: "evidence_matches", expiresAt: insuranceExpires });
}

async function request(customerId: string, mechanicIds: string[]) {
  const r = await live.createRequest({
    customerId, vehicleId: "", vehicle: { year: 2016, make: "BMW", model: "328i" }, repairCategory: "brakes", categorySource: "customer",
    symptomDescription: "Grinding from the front when braking.", occurrence: { conditions: [] }, onset: {}, warningLights: [], diagnosticCodes: [], smells: [],
    recentRepairs: [], customerParts: [], location: { serviceMode: "mobile", area: "mid-city" }, media: [],
  });
  const missing = mechanicIds.filter((m) => !live.getRequest(r.id)!.matchedMechanicIds.includes(m));
  if (missing.length) await live.forwardRequest(r.id, missing, "broaden");
  return live.getRequest(r.id)!;
}

const quote = (requestId: string, mechanicId: string): Omit<Quote, "id" | "status" | "createdAt" | "customerQuestions"> => ({
  requestId, mechanicId, laborCents: 30000, diagnosticFeeCents: 5000, travelFeeCents: 0, partsIncluded: true, partsEstimateCents: 12000, durationHours: 2,
  availableOn: "Tue, Sep 29 · 9:00 AM", availableAt: { date: "2026-09-29", time: "09:00" }, serviceMode: "mobile", scope: "Replace front pads and rotors.",
});

const profileOf = (id: string) => toPublicProfile(live.getMechanicSources(id));
const ackFor = (mechanicId: string) => ({ version: DISCLOSURE_VERSION, snapshot: snapshotKey(checksNow(profileOf(mechanicId))) });

test("an unverified mechanic with a complete profile is matchable, can quote and can be booked, and is shown as unverified", async () => {
  const m = await unverifiedMechanic();
  const e = eligibility(profileOf(m.id));
  assert.equal(e.eligible, true, "bookable on the basic profile alone");
  assert.equal(e.fullyVerified, false);
  assert.deepEqual(e.checks.map((c) => c.label), ["Identity: Not completed", "Background check: Not completed", "Driving record: Not completed", "Insurance: Not completed"]);
  assert.ok(!/safe|trusted|vetted/i.test(e.customerLine), "never implies safety");
  assert.ok(matchReadiness(live, m).matchable);
  const c = await customer();
  const r = await request(c.id, []);
  assert.ok(r.matchedMechanicIds.includes(m.id), "matching sends it to them");
  const q = await live.submitQuote(quote(r.id, m.id));
  assert.equal(q.status, "submitted");
});

test("booking an unverified mechanic needs the acknowledgement: missing, outdated or tampered ones are refused and book nothing", async () => {
  const m = await unverifiedMechanic();
  const c = await customer();
  const r = await request(c.id, [m.id]);
  const q = await live.submitQuote(quote(r.id, m.id));
  const refused = async (ack: Parameters<typeof live.acceptQuote>[3], code: string, why: string) => {
    await assert.rejects(live.acceptQuote(q.id, c.id, undefined, ack), (e: unknown) => e instanceof LifecycleError && e.code === code, why);
    assert.equal(live.getQuote(q.id)!.status, "submitted", `${why}: estimate untouched`);
    assert.equal(live.listJobsForCustomer(c.id).length, 0, `${why}: nothing booked`);
  };
  await refused(undefined, "invalid_input", "no acknowledgement (a direct call that skips the confirmation step)");
  await refused({ version: "unverified-booking/2025-01-01.0", snapshot: ackFor(m.id).snapshot }, "stale", "an old disclosure version");
  await refused({ version: DISCLOSURE_VERSION, snapshot: "identity:verified|background:verified|insurance:verified" }, "stale", "a tampered status list");
  await refused({ version: DISCLOSURE_VERSION, snapshot: "" }, "stale", "an empty status list");
});

test("the statuses changed between reading and booking: the old acknowledgement is refused until the customer reviews again", async () => {
  const m = await unverifiedMechanic();
  const c = await customer();
  const r = await request(c.id, [m.id]);
  const q = await live.submitQuote(quote(r.id, m.id));
  const read = ackFor(m.id);
  // Meanwhile ID and background get verified (insurance still isn't), committed like any write.
  await transact("live", () => {
    for (const kind of ["identity", "background", "driving_record"] as const) {
      current("live").screenings.push({ id: `scr-late-${m.id}-${kind}`, mechanicId: m.id, kind, provider: "provider-under-test", providerRef: "x", status: "verified", result: "clear", completedAt: "2026-09-21", expiresAt: "2027-09-21" });
    }
  });
  await assert.rejects(live.acceptQuote(q.id, c.id, undefined, read), /changed since you reviewed it/);
  const job = await live.acceptQuote(q.id, c.id, undefined, ackFor(m.id));
  const byKey = Object.fromEntries(job.verificationAtBooking!.checks.map((x) => [x.key, x]));
  assert.ok(byKey.identity.verified && byKey.background.verified, "the booking records what was true when the customer re-read it");
  assert.equal(byKey.insurance.status, "Not completed");
});

test("after the acknowledgement: one booking, with the exact disclosure, version, statuses, customer and time recorded, and in the history", async () => {
  const m = await unverifiedMechanic();
  const c = await customer();
  const r = await request(c.id, [m.id]);
  const q = await live.submitQuote(quote(r.id, m.id));
  const job = await live.acceptQuote(q.id, c.id, q.version, ackFor(m.id));
  const at = job.verificationAtBooking!;
  assert.equal(at.fullyVerified, false);
  assert.deepEqual(at.checks.map((x) => [x.key, x.status, x.verified]), [["identity", "Not completed", false], ["background", "Not completed", false], ["driving_record", "Not completed", false], ["insurance", "Not completed", false]]);
  assert.equal(at.acknowledgement!.version, DISCLOSURE_VERSION);
  assert.equal(at.acknowledgement!.text, ACK_TEXT);
  assert.equal(at.acknowledgement!.customerId, c.id);
  assert.equal(at.acknowledgement!.userId, c.userId);
  assert.ok(Date.parse(at.acknowledgement!.at) > 0);
  assert.equal(at.acknowledgement!.disclosure, disclosureText(m.firstName, at.checks), "the text the confirmation step showed");
  for (const line of ["- Identity not verified by Clutch", "- Background check not verified by Clutch", "- Driving record not verified by Clutch", "- Insurance not verified by Clutch", INSURANCE_UNVERIFIED_NOTE, ACK_TEXT]) assert.ok(at.acknowledgement!.disclosure.includes(line), line);
  const h = job.history!.find((x) => x.action === "acknowledged unverified checks")!;
  assert.equal(h.by, "customer");
  assert.ok(h.detail!.startsWith(DISCLOSURE_VERSION) && h.detail!.includes("Insurance not completed"), h.detail);
  // Idempotent: the same acceptance again returns the same booking, still with its record.
  const again = await live.acceptQuote(q.id, c.id, q.version, ackFor(m.id));
  assert.equal(again.id, job.id);
});

test("the record at booking never changes, even when the mechanic's checks do; current and at-booking are both visible", async () => {
  const m = await unverifiedMechanic();
  const c = await customer();
  const r = await request(c.id, [m.id]);
  const q = await live.submitQuote(quote(r.id, m.id));
  const job = await live.acceptQuote(q.id, c.id, undefined, ackFor(m.id));
  const before = structuredClone(job.verificationAtBooking);
  await verify(m.id);
  assert.equal(eligibility(profileOf(m.id)).fullyVerified, true, "now fully verified");
  await live.confirmAppointment(job.id, m.id);
  await live.startJob(job.id, m.id);
  await live.markJobDone(job.id, m.id, 35000);
  await live.completeJob(job.id, c.id, { status: "paid", amountCents: 35000 });
  assert.deepEqual(live.getJob(job.id)!.verificationAtBooking, before, "the booking keeps what the customer acknowledged");
});

test("expired or unverified insurance: Clutch says only that it hasn't verified coverage, and to ask for proof", async () => {
  const m = await unverifiedMechanic();
  await verify(m.id, "2026-01-31"); // insurance verified once, since lapsed
  const e = eligibility(profileOf(m.id));
  assert.equal(e.eligible, true);
  assert.deepEqual(e.unverified.map((x) => x.label), ["Insurance: Expired Jan 2026"]);
  const text = disclosureText(m.firstName, checksNow(profileOf(m.id)));
  assert.ok(text.includes("- Insurance expired Jan 2026, so it's no longer verified") && text.includes(INSURANCE_UNVERIFIED_NOTE), text);
  assert.ok(!/liab|responsib|fault|at your own risk|waive/i.test(text), "no legal conclusions, no waiver language");
  assert.ok(!/liab|responsib|fault|waive/i.test(INSURANCE_UNVERIFIED_NOTE));
});

test("a fully verified mechanic is booked without the extra step, and the booking records that", async () => {
  const m = await unverifiedMechanic();
  await verify(m.id);
  const c = await customer();
  const r = await request(c.id, [m.id]);
  const q = await live.submitQuote(quote(r.id, m.id));
  const job = await live.acceptQuote(q.id, c.id);
  assert.equal(job.verificationAtBooking!.fullyVerified, true);
  assert.equal(job.verificationAtBooking!.acknowledgement, undefined);
});

test("search: everyone bookable is shown by default; full verification ranks higher only at equal experience; filters are the customer's choice", async () => {
  const u = await unverifiedMechanic();
  const v = await unverifiedMechanic();
  await verify(v.id);
  const profiles = [profileOf(u.id), profileOf(v.id)];
  const mech = (id: string) => live.getMechanic(id)!;
  const def = rankSearch(profiles, mech, { repair: "brakes", make: "BMW" });
  assert.deepEqual(def.open.map((r) => r.p.id), [v.id, u.id], "both shown; the verified one first at equal experience");
  assert.deepEqual(rankSearch(profiles, mech, { verifiedOnly: true }).open.map((r) => r.p.id), [v.id], "fully verified only");
  assert.deepEqual(rankSearch(profiles, mech, { checks: ["insurance"] }).open.map((r) => r.p.id), [v.id], "insurance verified");
  assert.equal(rankSearch(profiles, mech, { verifiedOnly: true }).openCount({}), 2, "removing the filter would show both");
  // Experience still comes first: give the unverified mechanic three verified BMW brake jobs.
  for (let i = 0; i < 3; i++) current("live").pastRepairs.push({ id: `pr-u-${i}`, mechanicId: u.id, source: "customer_confirmed", year: 2016, make: "BMW", model: "328i", repairCategory: "brakes", title: "Brakes", performedOn: "2026-01-0" + (i + 1), evidence: [] });
  const withExp = rankSearch([profileOf(u.id), profileOf(v.id)], mech, { repair: "brakes", make: "BMW" });
  assert.equal(withExp.open[0].p.id, u.id, "verification is a tie-breaker after experience, never an exclusion");
});

test("recommendation explanations never imply an unverified mechanic passed checks", async () => {
  const u = await unverifiedMechanic();
  for (let i = 0; i < 4; i++) current("live").pastRepairs.push({ id: `pr-rec-${u.id}-${i}`, mechanicId: u.id, source: "customer_confirmed", year: 2016, make: "BMW", model: "328i", repairCategory: "brakes", title: "Brakes", performedOn: "2026-02-0" + (i + 1), evidence: [] });
  const p = profileOf(u.id);
  const ranked = rankSearch([p], (id) => live.getMechanic(id)!, { repair: "brakes", make: "BMW" });
  const picks = topPicks(ranked.relevant, { repair: "brakes", make: "BMW" });
  assert.equal(picks.length, 1, "an unverified mechanic can still be a pick on experience");
  const ex = explainSearch(ranked, { repair: "brakes", make: "BMW" });
  const said = [picks[0].title, picks[0].definition, JSON.stringify(dominantReason(ranked.open[0], { repair: "brakes", make: "BMW" })), ...fitReasons(ranked.open[0], { repair: "brakes", make: "BMW" })].join(" ");
  assert.ok(!/identity|background|insur|screen|driving record|checks? (passed|cleared)/i.test(said), `explanation mentions checks: ${said}`);
  assert.deepEqual(ex.picks[0].checks, ["Identity: Not completed", "Background check: Not completed", "Driving record: Not completed", "Insurance: Not completed"], "the checks travel with the pick, as they are");
  assert.ok(ex.picks[0].factors.some((f) => f.label === "Checks Clutch verified" && f.value === "0 of 4"));
});

test("an incomplete profile still can't be booked or receive requests (the one hard gate)", async () => {
  await ready("live");
  const u = await provisionUser({ id: "vp-incomplete", email: "vp-incomplete@example.test", meta: { name: "Ivy Incomplete", role: "mechanic" } });
  const m = await live.upsertMechanicProfile({ userId: u!.id, displayName: "Ivy Incomplete", city: "Los Angeles", neighborhood: "mid-city", serviceRadiusMi: 15, bio: "", workModel: "mobile", declaredRepairCategories: ["brakes"], declaredMakes: ["BMW"], hourlyRateCents: 9000, diagnosticFeeCents: 5000 });
  const e = eligibility(profileOf(m.id));
  assert.equal(e.eligible, false);
  assert.deepEqual(e.missing.map((x) => x.key), ["availability"]);
  const c = await customer();
  const r = await request(c.id, []);
  assert.ok(!r.matchedMechanicIds.includes(m.id));
});

test("a request saved while nobody fits goes to a new mechanic as soon as onboarding publishes a fitting profile in one step", async () => {
  const c = await customer();
  const r = await live.createRequest({
    customerId: c.id, vehicleId: "", vehicle: { year: 2016, make: "BMW", model: "328i" }, repairCategory: "brakes", categorySource: "customer",
    symptomDescription: "Grinding from the front when braking.", occurrence: { conditions: [] }, onset: {}, warningLights: [], diagnosticCodes: [], smells: [],
    recentRepairs: [], customerParts: [], location: { serviceMode: "mobile", area: "long-beach" }, media: [],
  });
  assert.deepEqual(live.getRequest(r.id)!.matchedMechanicIds, [], "nobody fits yet: saved, not sent");
  const u = await provisionUser({ id: "vp-newcomer", email: "vp-newcomer@example.test", meta: { name: "Morgan", role: "mechanic" } });
  const m = await live.upsertMechanicProfile({ userId: u!.id, displayName: "Morgan Newcomer", city: "Long Beach", neighborhood: "long-beach", serviceRadiusMi: 10, bio: "", workModel: "mobile", declaredRepairCategories: ["brakes"], declaredMakes: ["BMW"], hourlyRateCents: 9000, diagnosticFeeCents: 5000, availabilityNote: "Weekdays" });
  assert.deepEqual(live.getRequest(r.id)!.matchedMechanicIds, [m.id], "sent on first publish, no edit needed");
});

test("copy never vouches for mechanics as a group: no 'qualified', 'screened' or 'trust' claims in pages, components or domain text", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = `${d}/${f}`;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|mdx?)$/.test(f)) files.push(p);
    }
  };
  for (const d of ["app", "components", "lib/domain"]) walk(d);
  const banned = [/qualified mechanic/i, /screening current/i, /Screened ·/, /safety baseline/i, /someone you can trust/i, /vetted/i, /background[- ]checked mechanic/i, /verified mechanics? (near|in) /i, /someone (you|they) (can )?trust/i, /verifying our first mechanics/i];
  const hits = files.flatMap((f) => readFileSync(f, "utf8").split("\n").map((line, i) => ({ f, i: i + 1, line })).filter(({ line }) => banned.some((b) => b.test(line))));
  assert.deepEqual(hits.map((h) => `${h.f}:${h.i}: ${h.line.trim().slice(0, 100)}`), []);
});

test("no verification check is marked as required for work; the basic profile is what's required", async () => {
  const { profileSteps } = await import("@/lib/domain/completeness");
  const m = await unverifiedMechanic();
  const steps = profileSteps(profileOf(m.id), { hasPhoto: false, hasPricing: true, shared: false });
  const checks = steps.filter((s) => /identity|background|driving|insurance/i.test(s.label));
  assert.equal(checks.length, 4);
  assert.ok(checks.every((s) => !s.requiredForWork), "checks are optional");
  assert.ok(checks.every((s) => /Not required to be booked/.test(s.why)));
  assert.ok(!steps.some((s) => /^Required before/.test(s.why)));
});

test("an estimate can't be sent until the basic profile is complete (a draft can be saved); verification still isn't required", async () => {
  const c = await customer();
  const u = await provisionUser({ id: "vp-noarea", email: "vp-noarea@example.test", meta: { name: "Nia", role: "mechanic" } });
  // No service area: not a launch area.
  const m = await live.upsertMechanicProfile({ userId: u!.id, displayName: "Nia Noarea", city: "Los Angeles", serviceRadiusMi: 15, bio: "", workModel: "mobile", declaredRepairCategories: ["brakes"], declaredMakes: ["BMW"], hourlyRateCents: 9000, diagnosticFeeCents: 5000, availabilityNote: "Weekdays" });
  const r = await request(c.id, [m.id]);
  await assert.rejects(live.submitQuote(quote(r.id, m.id)), (e: unknown) => e instanceof LifecycleError && e.code === "forbidden" && /Finish your profile before sending estimates: service area/.test(e.message));
  const draft = await live.submitQuote(quote(r.id, m.id), { draft: true });
  assert.equal(draft.status, "draft");
  assert.equal(live.listQuotesForRequest(r.id).filter((q) => q.status === "submitted").length, 0, "the customer is sent nothing");
  // Once the area is set, the same mechanic (still with no checks verified) can send it.
  await live.upsertMechanicProfile({ id: m.id, userId: u!.id, displayName: "Nia Noarea", city: "Los Angeles", neighborhood: "mid-city", serviceRadiusMi: 15, bio: "", workModel: "mobile", declaredRepairCategories: ["brakes"], declaredMakes: ["BMW"], hourlyRateCents: 9000, diagnosticFeeCents: 5000, availabilityNote: "Weekdays" });
  const sent = await live.submitQuote(quote(r.id, m.id));
  assert.equal(sent.status, "submitted");
  assert.equal(eligibility(profileOf(m.id)).fullyVerified, false);
});

test("onboarding says what's actually required: the basic profile, not verification (one source, lib/domain/mechanic-requirements.ts)", async () => {
  const { UNLOCKS } = await import("@/lib/domain/mechanic-requirements");
  const { readiness } = await import("@/lib/domain/eligibility");
  const book = UNLOCKS.find((u) => /be booked/.test(u.goal))!;
  // Each required readiness item is named in the words onboarding shows.
  const labels = readiness({ neighborhood: undefined, serviceRadiusMi: 0, pricing: { hourlyRateCents: 0, diagnosticFeeCents: 0, fixed: [] }, availabilityNote: "", openings: [], selfReported: { declaredCategories: [] } } as never).items.map((i) => i.key);
  assert.deepEqual(labels, ["area", "repairs", "pricing", "availability"]);
  for (const words of [/where you start from and how far you travel/, /repairs you do/, /prices/, /available/]) assert.match(book.needs, words);
  assert.doesNotMatch(book.needs, /verif|ID check|background|insurance|driving record/i, "checks aren't a requirement");
  const checks = UNLOCKS.find((u) => /Verification checks/.test(u.goal))!;
  assert.match(checks.goal, /optional/);
  assert.match(checks.needs, /None is required to be booked/);
  // And the stale sentence can't come back anywhere in the app.
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const files: string[] = [];
  const walk = (d: string) => readdirSync(d).forEach((f) => (statSync(`${d}/${f}`).isDirectory() ? walk(`${d}/${f}`) : /\.tsx?$/.test(f) && files.push(`${d}/${f}`)));
  ["app", "components", "lib"].forEach(walk);
  const stale = [/ID check, background check and insurance verified/i, /(checks?|identity|background|insurance)[^."]{0,40}\b(must|need to|has to|have to) be verified[^."]{0,40}(send|book|request)/i, /verified,? plus a driving record check/i];
  const hits = files.filter((f) => stale.some((r) => r.test(readFileSync(f, "utf8"))));
  assert.deepEqual(hits, []);
});
