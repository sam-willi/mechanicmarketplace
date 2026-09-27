import type { Job, Quote, RepairRequest } from "./types";

/**
 * One job, two vocabularies. Customers see where their repair stands;
 * mechanics see what they need to do next.
 */
export type CustomerRepairStatus =
  | "Requested"
  | "Responses In"
  | "Mechanic Selected"
  | "Scheduled"
  | "In Progress"
  | "Confirm Completion"
  | "Completed"
  | "Cancelled"
  | "Pick a New Mechanic"
  | "Waiting for a Match";

export function customerRepairStatus(r: RepairRequest, quotes: Quote[], job?: Job): CustomerRepairStatus {
  if (job) {
    switch (job.status) {
      case "scheduled":
        return "Scheduled";
      case "in_progress":
        return "In Progress";
      case "awaiting_customer":
        return "Confirm Completion";
      case "completed":
        return "Completed";
      case "cancelled":
        return "Cancelled";
    }
  }
  if (r.status === "cancelled") return "Cancelled";
  if (r.status === "booked") return "Mechanic Selected";
  if (isWaitingForMatch(r)) return "Waiting for a Match";
  if (needsNewMechanic(r, quotes)) return "Pick a New Mechanic";
  if (quotes.some((q) => q.status === "submitted")) return "Responses In";
  return "Requested";
}

export type MechanicJobStatus = "Upcoming" | "In Progress" | "Awaiting Customer" | "Completed" | "Cancelled";

export function mechanicJobStatus(j: Job): MechanicJobStatus {
  return j.status === "scheduled"
    ? "Upcoming"
    : j.status === "in_progress"
      ? "In Progress"
      : j.status === "awaiting_customer"
        ? "Awaiting Customer"
        : j.status === "completed"
          ? "Completed"
          : "Cancelled";
}

export function jobValueCents(j: Job, q?: Quote) {
  return j.finalAmountCents ?? (q ? q.laborCents + q.diagnosticFeeCents + q.travelFeeCents : 0);
}

/**
 * The customer's pick declined or cancelled (or everyone it went to declined),
 * and they haven't sent it on since. Drives the "who else could do it" panel.
 */
export function needsNewMechanic(r: RepairRequest, quotes: Quote[]) {
  if (r.status !== "open" && r.status !== "quoted") return false;
  const last = (r.declines ?? []).at(-1);
  if (!last || (r.handoffs ?? []).some((h) => h.at > last.at)) return false;
  const picked = last.mechanicId === r.requestedMechanicId || Boolean(last.cancelledJob);
  const nobodyLeft = r.matchedMechanicIds.every((mid) => r.declinedBy.includes(mid)) && !quotes.some((q) => q.status === "submitted");
  return picked || nobodyLeft;
}

/** Saved while no mechanic fit it; Clutch sends it on when one does. */
export function isWaitingForMatch(r: RepairRequest) {
  return r.status === "open" && r.matchedMechanicIds.length === 0;
}
