import type { Job, Quote, RepairRequest } from "./types";

/** Status labels live in ./journey.ts (one model for both sides); these are the facts it builds on. */
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
