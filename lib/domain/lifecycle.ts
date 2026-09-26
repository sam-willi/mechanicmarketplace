import type { Job, Review } from "./types";
import { dayMonth, usd } from "@/lib/format";

/**
 * One booked repair, from booking to review, as ten stages. For the current
 * stage it says what happened, who is waiting on whom, the next action, what
 * notification it sends, and what becomes public. Both apps render this.
 */
export type Audience = "customer" | "mechanic";
export type StageKey =
  | "booked"
  | "confirmed"
  | "checked_in"
  | "diagnosis"
  | "scope"
  | "working"
  | "completion"
  | "customer_confirm"
  | "verified"
  | "review";

export interface Stage {
  key: StageKey;
  label: string;
  state: "done" | "current" | "todo" | "skipped";
  at?: string;
  detail?: string;
}

export interface Current {
  key: StageKey;
  headline: string;
  waitingOn: "customer" | "mechanic" | "nobody";
  /** Plain sentence for "who is waiting on whom". */
  waiting: string;
  /** Next thing the viewer should do (or null if it's the other person's turn). */
  next: string | null;
  notifies?: string;
  becomesPublic?: string;
}

export function jobLifecycle(job: Job, review: Review | undefined, names: { customer: string; mechanic: string }, audience: Audience): { stages: Stage[]; current: Current | null } {
  const c = names.customer;
  const m = names.mechanic;
  const sc = job.scopeChange;
  const started = Boolean(job.startedAt) || job.status !== "scheduled";
  const done = {
    booked: true,
    confirmed: Boolean(job.confirmedAt) || started,
    checked_in: started && job.status !== "scheduled",
    diagnosis: Boolean(job.diagnosis) || job.status === "awaiting_customer" || job.status === "completed",
    scope: sc ? sc.status !== "pending" : Boolean(job.diagnosis) || job.status === "awaiting_customer" || job.status === "completed",
    working: job.status === "awaiting_customer" || job.status === "completed",
    completion: job.status === "awaiting_customer" || job.status === "completed",
    customer_confirm: job.status === "completed",
    verified: job.status === "completed",
    review: Boolean(review),
  } satisfies Record<StageKey, boolean>;

  const labels: [StageKey, string, string | undefined, string | undefined][] = [
    ["booked", "Booked", job.scheduledFor, undefined],
    ["confirmed", "Appointment confirmed", job.confirmedAt ? dayMonth(job.confirmedAt) : undefined, undefined],
    ["checked_in", "Mechanic checked in", job.startedAt ? dayMonth(job.startedAt) : undefined, undefined],
    ["diagnosis", "Diagnosis shared", job.diagnosis ? dayMonth(job.diagnosis.at) : undefined, job.diagnosis ? (job.diagnosis.matchesEstimate ? "Matches the estimate" : "Different from the estimate") : undefined],
    ["scope", "Extra work approval", sc?.respondedAt ? dayMonth(sc.respondedAt) : undefined, sc ? `${usd(sc.extraCents)} extra · ${sc.status}` : "Only if something else is found"],
    ["working", "Work in progress", undefined, undefined],
    ["completion", "Photos and final amount", job.mechanicCompletedAt ? dayMonth(job.mechanicCompletedAt) : undefined, job.finalAmountCents ? usd(job.finalAmountCents) : undefined],
    ["customer_confirm", "Customer confirms", job.completedAt ? dayMonth(job.completedAt) : undefined, undefined],
    ["verified", "Added to the verified record", job.completedAt ? dayMonth(job.completedAt) : undefined, undefined],
    ["review", "Review", undefined, review ? `${review.overall} of 5` : undefined],
  ];

  if (job.status === "cancelled") {
    return {
      stages: labels.map(([key, label, at]) => ({ key, label, at, state: key === "booked" ? "done" : "skipped" })),
      current: { key: "booked", headline: "This booking was cancelled", waitingOn: "nobody", waiting: "Nothing more to do.", next: null },
    };
  }

  const firstOpen = labels.findIndex(([k]) => !done[k]);
  const stages: Stage[] = labels.map(([key, label, at, detail], i) => ({
    key,
    label,
    at,
    detail,
    state: key === "scope" && !sc && done.diagnosis ? "skipped" : done[key] ? "done" : i === firstOpen ? "current" : "todo",
  }));
  if (firstOpen === -1) return { stages, current: null };
  const key = labels[firstOpen][0];
  const you = (who: Audience) => audience === who;

  const cur: Record<StageKey, () => Current> = {
    booked: () => ({ key, headline: "Booked", waitingOn: "mechanic", waiting: "", next: null }),
    confirmed: () => ({
      key,
      headline: `Waiting for ${m} to confirm ${job.scheduledFor}`,
      waitingOn: "mechanic",
      waiting: you("mechanic") ? `${c} is waiting on you.` : `You're waiting on ${m}.`,
      next: you("mechanic") ? "Confirm the appointment time" : null,
      notifies: `${c} gets "${m} is confirmed for ${job.scheduledFor}".`,
    }),
    checked_in: () => ({
      key,
      headline: `${m} is confirmed for ${job.scheduledFor}`,
      waitingOn: "mechanic",
      waiting: you("mechanic") ? "Check in when you arrive or start." : `${m} checks in when they arrive.`,
      next: you("mechanic") ? "Check in and start" : null,
      notifies: `${c} gets "${m} checked in".`,
    }),
    diagnosis: () => ({
      key,
      headline: `${m} is diagnosing the problem`,
      waitingOn: "mechanic",
      waiting: you("mechanic") ? `${c} is waiting to hear what you found.` : `You're waiting on ${m}'s diagnosis.`,
      next: you("mechanic") ? "Share what you found" : null,
      notifies: `${c} sees your diagnosis note.`,
    }),
    scope: () => ({
      key,
      headline: `${m} asked to do extra work`,
      waitingOn: "customer",
      waiting: you("customer") ? `${m} is waiting on your answer before doing more.` : `You're waiting on ${c} to approve or decline.`,
      next: you("customer") ? "Approve or decline the extra work" : null,
      notifies: `${m} is told your answer.`,
    }),
    working: () => ({
      key,
      headline: "Work in progress",
      waitingOn: "mechanic",
      waiting: you("mechanic") ? "When you're done, add photos and the final amount." : `${m} is working on it.`,
      next: you("mechanic") ? "Add photos and mark it complete" : null,
      notifies: `${c} is asked to confirm the work is done.`,
    }),
    completion: () => cur.working(),
    customer_confirm: () => ({
      key,
      headline: `${m} says the repair is done`,
      waitingOn: "customer",
      waiting: you("customer") ? `${m} is waiting on your confirmation.` : `You're waiting on ${c} to confirm.`,
      next: you("customer") ? "Confirm the work is done" : null,
      notifies: `${m} is told the repair is confirmed.`,
      becomesPublic: `The repair (car, repair type, month) joins ${m}'s public record as verified through a Clutch job, with any job photos. Your name and address are never shown.`,
    }),
    verified: () => cur.customer_confirm(),
    review: () => ({
      key,
      headline: "Repair complete and verified",
      waitingOn: "customer",
      waiting: you("customer") ? `${m} would value your review.` : `Waiting on ${c}'s review (optional).`,
      next: you("customer") ? "Leave a review" : null,
      becomesPublic: `The review appears on ${m}'s profile with your first name and initial, the car and the repair.`,
    }),
  };
  return { stages, current: cur[key]() };
}
