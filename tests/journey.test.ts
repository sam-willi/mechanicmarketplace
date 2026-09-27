import { test } from "node:test";
import assert from "node:assert/strict";
import { journey, STAGES } from "@/lib/domain/journey";
import type { Job, Quote, RepairRequest } from "@/lib/domain/types";

/** One status model for both sides: same stage and same responsible party, sentences per reader. */

const req = (x: Partial<RepairRequest> = {}) => ({ id: "r1", status: "open", matchedMechanicIds: ["m1", "m2"], declinedBy: [], interested: [], questions: [], ...x }) as unknown as RepairRequest;
const quote = (x: Partial<Quote> = {}) => ({ id: "q1", requestId: "r1", mechanicId: "m1", status: "submitted", ...x }) as unknown as Quote;
const job = (x: Partial<Job> = {}) => ({ id: "j1", requestId: "r1", mechanicId: "m1", status: "scheduled", scheduledFor: "Tue 9:00 AM", ...x }) as unknown as Job;
const names = { customer: "Maya", mechanic: "Derek" };
const both = (r: RepairRequest, quotes: Quote[], j?: Job) => ({
  c: journey({ request: r, quotes, job: j, audience: "customer", names }),
  m: journey({ request: r, quotes, job: j, audience: "mechanic", mechanicId: "m1", names }),
});

test("the six stages, in order", () => {
  assert.deepEqual([...STAGES], ["Request submitted", "Receiving quotes", "Mechanic selected", "Scheduled", "In progress", "Completed"]);
});

test("each state: one stage, one responsible party, on both sides", () => {
  const cases: [string, RepairRequest, Quote[], Job | undefined, string, string][] = [
    ["sent, no replies", req(), [], undefined, "Receiving quotes", "mechanic"],
    ["estimate in", req({ status: "quoted" }), [quote()], undefined, "Receiving quotes", "customer"],
    ["booked, not confirmed", req({ status: "booked" }), [quote({ status: "accepted" })], job(), "Mechanic selected", "mechanic"],
    ["confirmed", req({ status: "booked" }), [], job({ confirmedAt: "2026-09-26" }), "Scheduled", "mechanic"],
    ["working", req({ status: "booked" }), [], job({ status: "in_progress", startedAt: "x" }), "In progress", "mechanic"],
    ["extra work asked", req({ status: "booked" }), [], job({ status: "in_progress", scopeChange: { status: "pending" } as never }), "In progress", "customer"],
    ["marked done", req({ status: "booked" }), [], job({ status: "awaiting_customer" }), "In progress", "customer"],
    ["confirmed done", req({ status: "booked" }), [], job({ status: "completed" }), "Completed", "nobody"],
  ];
  for (const [name, r, qs, j, stage, party] of cases) {
    const { c, m } = both(r, qs, j);
    assert.equal(c.label, stage, `${name}: customer stage`);
    assert.equal(m.label, stage, `${name}: mechanic stage`);
    assert.equal(c.waitingOn, party, `${name}: customer sees who's responsible`);
    assert.equal(m.waitingOn, party, `${name}: mechanic sees who's responsible`);
    assert.equal(c.yourTurn, party === "customer", `${name}: customer's turn`);
    assert.equal(m.yourTurn, party === "mechanic", `${name}: mechanic's turn`);
    for (const x of [c, m]) {
      assert.ok(x.now.length > 0 && x.now.length < 90, `${name}: one short sentence`);
      if (x.waitingOn !== "nobody") assert.ok(x.next, `${name}: a next action`);
    }
  }
});

test("before anyone is matched: submitted, waiting on Clutch", () => {
  const c = journey({ request: req({ matchedMechanicIds: [] }), quotes: [], audience: "customer", names });
  assert.equal(c.label, "Request submitted");
  assert.equal(c.waitingOn, "clutch");
  assert.equal(c.yourTurn, false);
});

test("ends: cancelled for both; closed for a mechanic who wasn't chosen or declined", () => {
  const { c, m } = both(req({ status: "cancelled" }), [], undefined);
  assert.equal(c.label, "Cancelled");
  assert.equal(m.label, "Cancelled");
  assert.ok(c.ended && m.ended && !c.next && !m.next);
  const other = journey({ request: req({ status: "booked" }), quotes: [], job: job({ mechanicId: "m2" }), audience: "mechanic", mechanicId: "m1", names });
  assert.equal(other.label, "Closed");
  const declined = journey({ request: req({ declinedBy: ["m1"] }), quotes: [], audience: "mechanic", mechanicId: "m1", names });
  assert.equal(declined.label, "Closed");
  const notChosen = journey({ request: req({ status: "quoted" }), quotes: [quote({ status: "declined" as never })], audience: "mechanic", mechanicId: "m1", names });
  assert.equal(notChosen.label, "Closed");
});

test("a mechanic who has quoted waits on the customer; one who hasn't is asked to respond", () => {
  const quoted = journey({ request: req({ status: "quoted" }), quotes: [quote()], audience: "mechanic", mechanicId: "m1", names });
  assert.equal(quoted.waitingOn, "customer");
  assert.equal(quoted.yourTurn, false);
  const fresh = journey({ request: req({ status: "quoted" }), quotes: [quote()], audience: "mechanic", mechanicId: "m2", names });
  assert.equal(fresh.waitingOn, "mechanic");
  assert.equal(fresh.yourTurn, true);
  assert.equal(fresh.label, "Receiving quotes");
});
