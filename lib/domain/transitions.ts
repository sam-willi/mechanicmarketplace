import type { JobStatus, QuoteStatus, RequestStatus } from "./types";

/**
 * The only allowed moves for a request, an estimate and a booked job. Every
 * mutation in lib/data/mock/repository.ts checks these inside the same
 * transaction that writes the change, so a stale page, a second tab or a
 * retried click can't move anything out of order.
 *
 *  Request:  open ⇄ quoted → booked → completed; open/quoted → cancelled;
 *            booked → open/quoted when the mechanic cancels before starting.
 *  Estimate: draft → submitted (sent) → submitted (revised) → accepted;
 *            submitted → declined / withdrawn / expired;
 *            declined (because another was booked) → submitted when that booking falls through;
 *            accepted → withdrawn when the mechanic cancels before starting.
 *  Job:      scheduled → in_progress → awaiting_customer → completed;
 *            awaiting_customer → in_progress when the customer says it isn't finished;
 *            scheduled → cancelled (either side, before work starts).
 */
export const REQUEST_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  draft: ["open"],
  open: ["quoted", "booked", "cancelled"],
  quoted: ["open", "booked", "cancelled"],
  booked: ["open", "quoted", "completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export const QUOTE_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ["draft", "submitted", "withdrawn", "declined"],
  submitted: ["submitted", "accepted", "declined", "withdrawn", "expired"],
  accepted: ["withdrawn"],
  declined: ["submitted"],
  withdrawn: [],
  expired: [],
};

export const JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  scheduled: ["in_progress", "cancelled"],
  in_progress: ["awaiting_customer"],
  awaiting_customer: ["completed", "in_progress"],
  completed: [],
  cancelled: [],
};

/** A move the rules don't allow, or one made on out-of-date information. The message is safe to show. */
export class LifecycleError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_transition" | "stale" | "forbidden" | "not_found" | "invalid_input" = "invalid_transition",
  ) {
    super(message);
    this.name = "LifecycleError";
  }
}

type Machine = "request" | "estimate" | "job";
const TABLES = { request: REQUEST_TRANSITIONS, estimate: QUOTE_TRANSITIONS, job: JOB_TRANSITIONS } as const;

export function canTransition(kind: Machine, from: string, to: string) {
  return ((TABLES[kind] as Record<string, string[]>)[from] ?? []).includes(to);
}

/** Throws a LifecycleError (with a plain-language message) unless `from → to` is allowed. */
export function assertTransition(kind: Machine, from: string, to: string, message?: string) {
  if (canTransition(kind, from, to)) return;
  throw new LifecycleError(message ?? `This ${kind === "estimate" ? "estimate" : kind} is ${from.replace("_", " ")}, so that can't be done now. Refresh to see where it stands.`);
}

/** One line of history on a request, estimate, job or support case. Role, never a name or contact. */
export interface AuditEntry {
  at: string;
  by: "customer" | "mechanic" | "staff" | "system";
  action: string;
  /** Short, non-private detail (amounts, a reason code, a new time). */
  detail?: string;
}

/** Who is acting. Lifecycle writes take this and check it against the record inside the transaction. */
export type Actor = { role: "customer"; customerId: string } | { role: "mechanic"; mechanicId: string } | { role: "staff"; userId: string };
