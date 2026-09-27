import { test } from "node:test";
import assert from "node:assert/strict";
import { repoFor } from "@/lib/data";
import { current, ready, resetMemoryStores, transact } from "@/lib/data/store";
import { provisionUser } from "@/lib/auth/provision";
import { LifecycleError, canTransition } from "@/lib/domain/transitions";
import { toPublicProfile } from "@/lib/domain/public-profile";
import type { Quote } from "@/lib/domain/types";

/**
 * The request → estimate → booking → repair → confirmation → review lifecycle, in the
 * real (live) store with fictional example.test fixtures. Every refusal is a LifecycleError
 * thrown inside the write's own transaction.
 */

resetMemoryStores();
const live = repoFor("live");
let n = 0;

async function customer() {
  await ready("live");
  const id = `lc-cust-${++n}`;
  const u = await provisionUser({ id, email: `${id}@example.test`, meta: { name: `Casey ${n}`, role: "customer" } });
  return live.getCustomerByUser(u!.id)!;
}

let staffId: string;
async function staff() {
  if (staffId) return staffId;
  const u = await provisionUser({ id: "lc-staff", email: "staff@example.test", meta: { name: "Sky Staff", role: "customer" } });
  staffId = u!.id;
  return staffId;
}

/** A bookable fictional mechanic: profile, screening results as a connected provider would return them, insurance verified by staff. */
async function mechanic() {
  await ready("live");
  const id = `lc-mech-${++n}`;
  const u = await provisionUser({ id, email: `${id}@example.test`, meta: { name: `Morgan ${n}`, role: "mechanic" } });
  const m = await live.upsertMechanicProfile({ userId: u!.id, displayName: `Morgan Test${n}`, city: "Los Angeles", neighborhood: "mid-city", serviceRadiusMi: 15, bio: "", workModel: "mobile", declaredRepairCategories: ["brakes"], declaredMakes: ["BMW"], hourlyRateCents: 9000, diagnosticFeeCents: 5000, availabilityNote: "Weekdays" });
  for (const kind of ["identity", "background", "driving_record"] as const) {
    current("live").screenings.push({ id: `scr-${id}-${kind}`, mechanicId: m.id, kind, provider: "provider-under-test", providerRef: `ref-${id}-${kind}`, status: "verified", result: "clear", completedAt: "2026-09-20", expiresAt: "2027-09-20" });
  }
  await live.submitInsurance(m.id, { carrier: "Test Mutual", expiresOn: "2027-12-31", documentIds: ["doc-test"] });
  const ins = live.listVerifications({ mechanicId: m.id, statuses: ["submitted"] }).find((v) => v.category === "insurance")!;
  await live.decideVerification(ins.id, "approve", await staff(), { reasonCode: "evidence_matches", expiresAt: "2027-12-31" });
  return live.getMechanic(m.id)!;
}

async function request(customerId: string, key?: string) {
  return live.createRequest({
    customerId,
    vehicleId: "",
    vehicle: { year: 2016, make: "BMW", model: "328i" },
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

/** Two mechanics, one request with an estimate from each. */
async function scenario() {
  const [a, b] = [await mechanic(), await mechanic()];
  const c = await customer();
  const first = await request(c.id);
  // Matching sends a request to the top few; make sure this scenario's two are among them.
  const missing = [a.id, b.id].filter((id) => !first.matchedMechanicIds.includes(id));
  if (missing.length) await live.forwardRequest(first.id, missing, "broaden");
  const r = live.getRequest(first.id)!;
  assert.ok(r.matchedMechanicIds.includes(a.id) && r.matchedMechanicIds.includes(b.id), "both fixtures matched");
  const qa = await live.submitQuote(quoteBody(r.id, a.id));
  const qb = await live.submitQuote(quoteBody(r.id, b.id, 28000));
  return { a, b, c, r, qa, qb };
}

const lifecycle = (p: Promise<unknown>) => assert.rejects(p, (e: unknown) => e instanceof LifecycleError);

test("the transition tables allow only forward moves", () => {
  assert.ok(canTransition("job", "scheduled", "in_progress"));
  assert.ok(!canTransition("job", "scheduled", "completed"), "can't confirm completion of work that never started");
  assert.ok(!canTransition("job", "completed", "cancelled"));
  assert.ok(!canTransition("job", "in_progress", "cancelled"), "no cancelling once work has started");
  assert.ok(!canTransition("estimate", "accepted", "submitted"), "an accepted estimate can't be revised");
  assert.ok(!canTransition("estimate", "withdrawn", "accepted"));
  assert.ok(!canTransition("request", "cancelled", "booked"));
  assert.ok(!canTransition("request", "completed", "open"));
});

test("authorization: only the request's customer and the job's mechanic can act, and others see 'not found'", async () => {
  const { a, b, c, qa } = await scenario();
  const stranger = await customer();
  await assert.rejects(live.acceptQuote(qa.id, stranger.id), /wasn't found/);
  await assert.rejects(live.declineQuote(qa.id, stranger.id), /wasn't found/);
  await assert.rejects(live.askAboutQuote(qa.id, stranger.id, "Hi?"), /wasn't found/);
  await assert.rejects(live.answerQuoteQuestion(qa.id, b.id, 0, "No"), /wasn't found/, "another mechanic can't touch this estimate");
  const job = await live.acceptQuote(qa.id, c.id);
  for (const p of [
    live.startJob(job.id, b.id),
    live.confirmAppointment(job.id, b.id),
    live.recordDiagnosis(job.id, b.id, "x", true),
    live.requestScopeChange(job.id, b.id, "x", 100),
    live.markJobDone(job.id, b.id, 100),
    live.cancelJob(job.id, { role: "mechanic", mechanicId: b.id }),
    live.completeJob(job.id, stranger.id),
    live.reopenJob(job.id, stranger.id, "not done"),
    live.cancelJob(job.id, { role: "customer", customerId: stranger.id }),
    live.respondScopeChange(job.id, stranger.id, true),
    live.proposeReschedule(job.id, { role: "customer", customerId: stranger.id }, "Fri 9am"),
    live.reportPayment(job.id, { role: "customer", customerId: stranger.id }, { status: "paid" }),
    live.submitReview(job.id, stranger.id, { overall: 1, comment: "" }),
  ]) await assert.rejects(p, /wasn't found/);
  assert.equal(live.getJob(job.id)!.status, "scheduled", "nothing changed");
  void a;
});

test("accepting is atomic and idempotent: one job, competing estimates closed, retries return the same job", async () => {
  const { c, r, qa, qb } = await scenario();
  const [j1, j2] = await Promise.all([live.acceptQuote(qa.id, c.id), live.acceptQuote(qa.id, c.id)]); // double click
  assert.equal(j1.id, j2.id);
  assert.equal(current("live").jobs.filter((j) => j.requestId === r.id).length, 1);
  assert.equal(live.getQuote(qa.id)!.status, "accepted");
  assert.equal(live.getQuote(qa.id)!.acceptedVersion, 1);
  assert.equal(live.getQuote(qb.id)!.status, "declined");
  assert.equal(live.getQuote(qb.id)!.closedReason, "chose_other");
  assert.equal(live.getRequest(r.id)!.status, "booked");
  // A second tab still showing the other estimate:
  await assert.rejects(live.acceptQuote(qb.id, c.id), /already booked/);
  assert.equal(current("live").jobs.filter((j) => j.requestId === r.id).length, 1);
});

test("two estimates accepted at the same moment produce exactly one booking", async () => {
  const { c, r, qa, qb } = await scenario();
  const results = await Promise.allSettled([live.acceptQuote(qa.id, c.id), live.acceptQuote(qb.id, c.id)]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(results.filter((x) => x.status === "rejected" && x.reason instanceof LifecycleError).length, 1);
  const jobs = current("live").jobs.filter((j) => j.requestId === r.id);
  assert.equal(jobs.length, 1);
  const accepted = [live.getQuote(qa.id)!, live.getQuote(qb.id)!].filter((q) => q.status === "accepted");
  assert.equal(accepted.length, 1, "exactly one winner");
  assert.equal(jobs[0].quoteId, accepted[0].id);
});

test("a mechanic declining while the customer accepts never leaves a contradictory state", async () => {
  for (const order of ["decline-first", "accept-first"] as const) {
    const { a, c, r, qa } = await scenario();
    const ops = order === "decline-first" ? [live.declineRequest(r.id, a.id), live.acceptQuote(qa.id, c.id)] : [live.acceptQuote(qa.id, c.id), live.declineRequest(r.id, a.id)];
    const res = await Promise.allSettled(ops);
    const job = current("live").jobs.find((j) => j.requestId === r.id && j.status !== "cancelled");
    const q = live.getQuote(qa.id)!;
    if (order === "decline-first") {
      assert.equal(res[1].status, "rejected", "accepting a withdrawn estimate is refused");
      assert.equal(job, undefined);
      assert.equal(q.status, "withdrawn");
    } else {
      assert.equal(res[1].status, "rejected", "declining a booked job is refused");
      assert.equal(job?.mechanicId, a.id);
      assert.equal(q.status, "accepted");
      assert.ok(!live.getRequest(r.id)!.declinedBy.includes(a.id));
    }
  }
});

test("stale pages: accepting a revised, cancelled or withdrawn estimate is refused with a reason", async () => {
  const { a, c, r, qa, qb } = await scenario();
  // The customer opened version 1; the mechanic revises to version 2.
  await live.submitQuote({ ...quoteBody(r.id, a.id, 36000), scope: "Pads, rotors and a caliper." });
  const revised = live.getQuote(qa.id)!;
  assert.equal(revised.version, 2);
  assert.equal(revised.revisions?.length, 1);
  assert.equal(revised.revisions![0].totalCents, 30000 + 5000 + 12000, "the earlier price is kept");
  await assert.rejects(live.acceptQuote(qa.id, c.id, 1), /revised this estimate/);
  assert.equal(live.getQuote(qa.id)!.status, "submitted");
  // Accepting the version they're now looking at works, and records exactly that version and total.
  const job = await live.acceptQuote(qa.id, c.id, 2);
  const acc = live.getQuote(qa.id)!;
  assert.equal(acc.acceptedVersion, 2);
  assert.equal(acc.acceptedTotalCents, 36000 + 5000 + 12000);
  assert.ok(job.history?.some((h) => h.action.startsWith("booked")));
  // Cancelled request elsewhere:
  const c2 = await customer();
  const r2 = await request(c2.id);
  if (!r2.matchedMechanicIds.includes(a.id)) await live.forwardRequest(r2.id, [a.id], "broaden");
  const q2 = await live.submitQuote(quoteBody(r2.id, a.id));
  await live.cancelRequest(r2.id);
  await assert.rejects(live.acceptQuote(q2.id, c2.id), /cancelled|closed/);
  void qb;
});

test("an accepted estimate is frozen; extra work needs the customer's explicit approval first", async () => {
  const { a, c, r, qa } = await scenario();
  const job = await live.acceptQuote(qa.id, c.id);
  await lifecycle(live.submitQuote({ ...quoteBody(r.id, a.id, 99000) }));
  assert.equal(live.getQuote(qa.id)!.laborCents, 30000, "price unchanged after acceptance");
  await lifecycle(live.requestScopeChange(job.id, a.id, "Caliper", 8000)); // not started yet
  await live.startJob(job.id, a.id);
  await live.requestScopeChange(job.id, a.id, "Replace seized caliper", 8000);
  await lifecycle(live.requestScopeChange(job.id, a.id, "Another", 100)); // one pending at a time
  await lifecycle(live.markJobDone(job.id, a.id, 43000)); // can't finish while waiting on the customer
  await live.respondScopeChange(job.id, c.id, true);
  await live.respondScopeChange(job.id, c.id, true); // same answer again: harmless
  await lifecycle(live.respondScopeChange(job.id, c.id, false)); // can't flip an answered request
  await live.requestScopeChange(job.id, a.id, "Brake fluid flush", 4000);
  await live.respondScopeChange(job.id, c.id, false);
  const j = live.getJob(job.id)!;
  assert.equal(j.scopeChangeHistory?.length, 1, "earlier extra-work request kept");
  assert.equal(live.approvedLaborAndFees(j), 30000 + 5000 + 8000, "only approved extras count");
});

test("final amounts and payments are self-reported and checked against what was approved", async () => {
  const { a, c, qa } = await scenario();
  const job = await live.acceptQuote(qa.id, c.id);
  await lifecycle(live.markJobDone(job.id, a.id, 35000)); // must start first
  await lifecycle(live.reportPayment(job.id, { role: "customer", customerId: c.id }, { status: "paid" })); // too early
  await live.startJob(job.id, a.id);
  await lifecycle(live.markJobDone(job.id, a.id, -500));
  await live.markJobDone(job.id, a.id, 50000, "Done", undefined, { status: "not_paid" });
  await live.markJobDone(job.id, a.id, 50000); // double click
  const j = live.getJob(job.id)!;
  assert.equal(j.status, "awaiting_customer");
  assert.equal(j.finalExceedsApproved, true, "above the approved labor and fees");
  assert.equal(j.payment?.mechanic?.status, "not_paid");
  await live.reportPayment(job.id, { role: "customer", customerId: c.id }, { status: "paid", amountCents: 35000 });
  const after = live.getJob(job.id)!;
  assert.equal(after.payment?.customer?.amountCents, 35000);
  assert.equal(after.payment?.mechanic?.status, "not_paid", "each side's report is kept separately");
});

test("completion: only after the mechanic marks it done; 'not finished' sends it back; confirming twice creates one record", async () => {
  const { a, c, qa } = await scenario();
  const job = await live.acceptQuote(qa.id, c.id);
  await assert.rejects(live.completeJob(job.id, c.id), /hasn't marked this repair complete/);
  await live.startJob(job.id, a.id);
  await live.markJobDone(job.id, a.id, 35000);
  await lifecycle(live.reopenJob(job.id, c.id, "  ")); // needs a reason
  await live.reopenJob(job.id, c.id, "Squeal is still there");
  assert.equal(live.getJob(job.id)!.status, "in_progress");
  assert.ok(live.getJob(job.id)!.history?.some((h) => h.action === "said it isn't finished" && h.detail === "Squeal is still there"));
  await live.markJobDone(job.id, a.id, 35000);
  await Promise.all([live.completeJob(job.id, c.id), live.completeJob(job.id, c.id)]);
  assert.equal(live.getJob(job.id)!.status, "completed");
  assert.equal(current("live").pastRepairs.filter((x) => x.jobId === job.id).length, 1, "one verified record");
  assert.equal(current("live").verifications.filter((x) => x.evidenceSummary?.includes("328i") && x.mechanicId === a.id && x.method === "platform_job").length, 1);
  await lifecycle(live.reopenJob(job.id, c.id, "late"));
  await lifecycle(live.cancelJob(job.id, { role: "customer", customerId: c.id }));
});

test("cancelling: either side before work starts, never after; a mechanic cancelling reopens the request honestly", async () => {
  {
    const { a, c, r, qa } = await scenario();
    const job = await live.acceptQuote(qa.id, c.id);
    await live.startJob(job.id, a.id);
    await assert.rejects(live.cancelJob(job.id, { role: "customer", customerId: c.id }), /already started/);
    await assert.rejects(live.cancelJob(job.id, { role: "mechanic", mechanicId: a.id }), /already started/);
    void r;
  }
  {
    const { c, r, qa } = await scenario();
    const job = await live.acceptQuote(qa.id, c.id);
    await live.cancelJob(job.id, { role: "customer", customerId: c.id });
    await live.cancelJob(job.id, { role: "customer", customerId: c.id }); // idempotent
    assert.equal(live.getJob(job.id)!.status, "cancelled");
    assert.equal(live.getRequest(r.id)!.status, "cancelled");
    assert.equal(live.getQuote(qa.id)!.status, "withdrawn");
  }
  {
    const { a, c, r, qa, qb } = await scenario();
    const job = await live.acceptQuote(qa.id, c.id);
    await live.cancelJob(job.id, { role: "mechanic", mechanicId: a.id }, "booked_up");
    assert.equal(live.getQuote(qa.id)!.status, "withdrawn");
    assert.equal(live.getQuote(qb.id)!.status, "submitted", "the estimate passed over is open again");
    assert.equal(live.getRequest(r.id)!.status, "quoted");
    // The customer can now book the other mechanic: one live job again.
    const job2 = await live.acceptQuote(qb.id, c.id);
    assert.equal(current("live").jobs.filter((j) => j.requestId === r.id && j.status !== "cancelled").length, 1);
    assert.notEqual(job2.id, job.id);
  }
});

test("rescheduling needs the other side's yes; the booked time changes only then", async () => {
  const { a, c, qa } = await scenario();
  const job = await live.acceptQuote(qa.id, c.id);
  const orig = job.scheduledFor;
  await live.proposeReschedule(job.id, { role: "customer", customerId: c.id }, "Thu, Oct 1 · 10:00 AM", { date: "2026-10-01", time: "10:00" });
  assert.equal(live.getJob(job.id)!.scheduledFor, orig, "unchanged until accepted");
  await assert.rejects(live.respondReschedule(job.id, { role: "customer", customerId: c.id }, true), /other side/);
  await lifecycle(live.proposeReschedule(job.id, { role: "mechanic", mechanicId: a.id }, "Fri 9am")); // answer theirs first
  await live.respondReschedule(job.id, { role: "mechanic", mechanicId: a.id }, true);
  await live.respondReschedule(job.id, { role: "mechanic", mechanicId: a.id }, true); // retry
  const j = live.getJob(job.id)!;
  assert.equal(j.scheduledFor, "Thu, Oct 1 · 10:00 AM");
  assert.deepEqual(j.appointment, { date: "2026-10-01", time: "10:00" });
  assert.ok(j.confirmedAt);
  await live.startJob(job.id, a.id);
  await lifecycle(live.proposeReschedule(job.id, { role: "customer", customerId: c.id }, "Sat"));
});

test("reviews: once, only after a confirmed repair, only by its customer; edits keep history and count once", async () => {
  const { a, c, qa } = await scenario();
  const job = await live.acceptQuote(qa.id, c.id);
  await assert.rejects(live.submitReview(job.id, c.id, { overall: 5, comment: "" }), /once you've confirmed/);
  await live.startJob(job.id, a.id);
  await live.markJobDone(job.id, a.id, 35000);
  await assert.rejects(live.submitReview(job.id, c.id, { overall: 5, comment: "" }), /once you've confirmed/);
  await live.completeJob(job.id, c.id);
  await lifecycle(live.submitReview(job.id, c.id, { overall: 9, comment: "" }));
  const [r1, r2] = await Promise.all([live.submitReview(job.id, c.id, { overall: 4, comment: "Good" }), live.submitReview(job.id, c.id, { overall: 1, comment: "dup" })]);
  assert.equal(r1.id, r2.id, "the second submit returns the first review");
  assert.equal(current("live").reviews.filter((x) => x.jobId === job.id).length, 1);
  await live.updateReview(job.id, c.id, { overall: 5, comment: "Great after a follow-up" });
  const rev = live.getReviewForJob(job.id)!;
  assert.equal(rev.overall, 5);
  assert.deepEqual(rev.edits?.map((e) => e.overall), [4]);
  const p = toPublicProfile(live.getMechanicSources(a.id));
  assert.equal(p.reputation.rating?.count, 1, "counts once");
  assert.equal(p.reputation.rating?.average, 5);
  const other = await customer();
  await assert.rejects(live.updateReview(job.id, other.id, { overall: 1, comment: "" }), /wasn't found/);
});

test("support cases are worked in the app: reporter sees staff replies and status; only staff can change them", async () => {
  const { a, c, qa } = await scenario();
  const job = await live.acceptQuote(qa.id, c.id);
  const user = live.getCustomer(c.id)!.userId;
  const rep = await live.createSupportReport({ userId: user, reporterRole: "customer", topic: "no_show", details: "Nobody came at 9.", jobId: job.id });
  assert.equal(rep.status, "open");
  await assert.rejects(live.updateSupportCase(rep.id, user, { status: "resolved" }), /Only Clutch staff/);
  await assert.rejects(live.addSupportMessage(rep.id, live.getMechanic(a.id)!.userId, "not mine"), /wasn't found/);
  await live.addSupportMessage(rep.id, user, "Still waiting at 10.");
  const sid = await staff();
  await live.updateSupportCase(rep.id, sid, { status: "in_review", reply: "We're looking at the job history." });
  let x = live.getSupportReport(rep.id)!;
  assert.equal(x.status, "in_review");
  assert.deepEqual(x.messages?.map((m) => m.from), ["reporter", "staff"]);
  assert.ok(live.listNotifications(user, "customer").some((nn) => nn.kind === "support_update"), "reporter sees it in the app");
  await live.updateSupportCase(rep.id, sid, { status: "resolved" });
  await live.addSupportMessage(rep.id, user, "It happened again.");
  x = live.getSupportReport(rep.id)!;
  assert.equal(x.status, "open", "a new message reopens a resolved case");
  assert.ok(x.history!.length >= 5);
  await lifecycle(live.createSupportReport({ userId: user, reporterRole: "customer", topic: "other", details: "   " }));
});

test("double submits of the same draft create one request; history records who did what without names", async () => {
  const c = await customer();
  const [r1, r2] = await Promise.all([request(c.id, "draft-key-1"), request(c.id, "draft-key-1")]);
  assert.equal(r1.id, r2.id);
  assert.equal(current("live").requests.filter((x) => x.customerId === c.id).length, 1);
  const { a, c: c2, qa } = await scenario();
  const job = await live.acceptQuote(qa.id, c2.id);
  await live.confirmAppointment(job.id, a.id);
  await live.startJob(job.id, a.id);
  const h = live.getJob(job.id)!.history!;
  assert.deepEqual(
    h.map((e) => e.by),
    ["customer", "mechanic", "mechanic"],
  );
  const names = [live.getCustomer(c2.id)!.displayName, a.displayName];
  assert.ok(h.every((e) => names.every((nm) => !`${e.action} ${e.detail ?? ""}`.includes(nm))), "no names in history");
});

test("a write that fails partway leaves nothing half-applied in memory", async () => {
  const { c, r, qa } = await scenario();
  const before = JSON.stringify(live.getRequest(r.id));
  await assert.rejects(
    transact("live", () => {
      const req = current("live").requests.find((x) => x.id === r.id)!;
      req.status = "booked"; // changed…
      throw new LifecycleError("…then refused");
    }),
    LifecycleError,
  );
  assert.equal(JSON.stringify(live.getRequest(r.id)), before, "rolled back");
  // And the next real write doesn't carry the discarded change with it.
  await live.declineQuote(qa.id, c.id);
  assert.equal(live.getRequest(r.id)!.status, "quoted");
});
