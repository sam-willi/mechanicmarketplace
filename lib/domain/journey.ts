import type { Job, Quote, RepairRequest } from "./types";
import { isWaitingForMatch, needsNewMechanic } from "./status";

/**
 * One status model for a repair, the same on both sides. Six stages, and for the current one:
 * what's happening now, the next action, and who that action belongs to. Customer and mechanic
 * screens word the sentences for their reader; the stage and the responsible party never differ.
 */
export const STAGES = ["Request submitted", "Receiving quotes", "Mechanic selected", "Scheduled", "In progress", "Completed"] as const;
export type StageName = (typeof STAGES)[number];
export type Party = "customer" | "mechanic" | "clutch" | "nobody";

export interface Journey {
  /** 0–5 into STAGES. */
  stage: number;
  /** STAGES[stage], or "Cancelled" / "Closed" when it ended without a repair (for this reader). */
  label: StageName | "Cancelled" | "Closed";
  ended: boolean;
  /** What is true right now, one sentence. */
  now: string;
  /** The next action, for whoever it belongs to; null when nothing is left to do. */
  next: string | null;
  /** Who the next action belongs to. */
  waitingOn: Party;
  /** The reader has to act. */
  yourTurn: boolean;
}

export interface JourneyInput {
  request: RepairRequest;
  quotes: Quote[];
  job?: Job;
  audience: "customer" | "mechanic";
  /** The mechanic reading (mechanic side). */
  mechanicId?: string;
  /** First names, for the sentences. */
  names: { customer: string; mechanic?: string };
}

export function journey({ request: r, quotes, job, audience, mechanicId, names }: JourneyInput): Journey {
  const you = (p: Party) => p === audience;
  const c = names.customer;
  const m = names.mechanic ?? "the mechanic";
  const make = (stage: number, now: string, waitingOn: Party, next: string | null): Journey => ({ stage, label: STAGES[stage], ended: false, now, next, waitingOn, yourTurn: you(waitingOn) && next !== null });
  const end = (stage: number, label: "Cancelled" | "Closed", now: string): Journey => ({ stage, label, ended: true, now, next: null, waitingOn: "nobody", yourTurn: false });

  // A mechanic reading someone else's booking sees it closed for them, nothing more.
  if (audience === "mechanic" && mechanicId && job && job.mechanicId !== mechanicId) return end(2, "Closed", `${c} booked another mechanic.`);
  if (audience === "mechanic" && mechanicId && r.declinedBy.includes(mechanicId) && !job) return end(1, "Closed", "You declined this request.");

  if (job) {
    if (job.status === "cancelled") return end(job.startedAt ? 4 : job.confirmedAt ? 3 : 2, "Cancelled", job.cancelledBy === "mechanic" ? `${m} cancelled the booking.` : "The booking was cancelled.");
    if (job.status === "completed")
      return make(5, "Done and confirmed. It's on the mechanic's verified record.", "nobody", null);
    if (job.status === "awaiting_customer")
      return you("customer") ? make(4, `${m} says the repair is done.`, "customer", "Confirm the work is done") : make(4, "You marked it done.", "customer", `Wait for ${c} to confirm`);
    if (job.status === "in_progress") {
      if (job.scopeChange?.status === "pending")
        return you("customer") ? make(4, `${m} found more to do and asked first.`, "customer", "Approve or decline the extra work") : make(4, "You asked to do extra work.", "customer", `Wait for ${c}'s answer`);
      return you("mechanic") ? make(4, "You're on the job.", "mechanic", "Add photos and mark it complete") : make(4, `${m} is working on it.`, "mechanic", `${m} marks it complete`);
    }
    // scheduled
    if (job.confirmedAt)
      return you("mechanic") ? make(3, `Confirmed for ${job.scheduledFor}.`, "mechanic", "Check in when you arrive") : make(3, `${m} is confirmed for ${job.scheduledFor}.`, "mechanic", `${m} checks in on the day`);
    return you("mechanic") ? make(2, `${c} booked you for ${job.scheduledFor}.`, "mechanic", "Confirm the time") : make(2, `You booked ${m} for ${job.scheduledFor}.`, "mechanic", `${m} confirms the time`);
  }

  if (r.status === "cancelled") return end(r.matchedMechanicIds.length ? 1 : 0, "Cancelled", audience === "customer" ? "You cancelled this request." : `${c} cancelled this request.`);
  if (r.status === "booked") return make(2, "An estimate was accepted.", "mechanic", audience === "mechanic" ? "Confirm the time" : `${m} confirms the time`);

  const sent = quotes.filter((q) => q.status === "submitted");
  if (audience === "customer") {
    if (isWaitingForMatch(r)) return make(0, "Saved. No mechanic on Clutch serves this car, repair and area yet.", "clutch", "Clutch sends it on when one does");
    if (needsNewMechanic(r, quotes)) return make(1, "The mechanic you picked can't take it.", "customer", "Choose another mechanic");
    if (sent.length) return make(1, `${sent.length} ${sent.length === 1 ? "estimate" : "estimates"} to compare.`, "customer", "Compare and book one");
    return make(1, `Sent to ${r.matchedMechanicIds.length} ${r.matchedMechanicIds.length === 1 ? "mechanic" : "mechanics"}.`, "mechanic", "Mechanics reply with estimates or questions");
  }
  const mine = quotes.find((q) => q.mechanicId === mechanicId && q.status !== "draft");
  if (mine?.status === "submitted") return make(1, "Your estimate is with the customer.", "customer", `Wait for ${c} to choose`);
  if (mine && mine.status !== "accepted") return end(1, "Closed", mine.status === "withdrawn" ? "You withdrew your estimate." : `${c} chose another mechanic.`);
  return make(1, `${c} is waiting for estimates.`, "mechanic", "Send an estimate, ask a question, or decline");
}

/** "You", or who. */
export function partyLabel(p: Party, audience: "customer" | "mechanic", names: { customer: string; mechanic?: string }) {
  if (p === audience) return "You";
  if (p === "customer") return names.customer;
  if (p === "mechanic") return names.mechanic ?? "The mechanic";
  if (p === "clutch") return "Clutch";
  return "Nobody";
}

/** For lists: the stage label and whether the reader has to act. */
export function repairChip(r: RepairRequest, quotes: Quote[], job: Job | undefined, audience: "customer" | "mechanic" = "customer", mechanicId?: string) {
  const j = journey({ request: r, quotes, job, audience, mechanicId, names: { customer: "the customer" } });
  return { label: j.label, action: j.yourTurn, ended: j.ended, stage: j.stage, next: j.next };
}
