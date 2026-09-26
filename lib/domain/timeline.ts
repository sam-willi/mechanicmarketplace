import type { Job, Quote, RepairRequest, Review } from "./types";
import { dayMonth, plural } from "@/lib/format";

export type Step = { label: string; detail?: string; at?: string; state: "done" | "current" | "todo" };

/**
 * The customer's view of one repair, from request to review. Every step and
 * count comes from a real record; nothing is inferred to create urgency.
 */
export function customerTimeline(
  r: RepairRequest,
  quotes: Quote[],
  job: Job | undefined,
  review: Review | undefined,
  mechanicFirstName?: string,
): Step[] {
  const sent = quotes.filter((q) => q.status !== "draft");
  const matched = r.matchedMechanicIds.length;
  const interested = new Set([...r.interested.map((i) => i.mechanicId), ...sent.map((q) => q.mechanicId)]).size;
  const accepted = sent.find((q) => q.status === "accepted");
  const who = mechanicFirstName ?? "Your mechanic";

  const raw: { label: string; detail?: string; at?: string; done: boolean }[] = [
    { label: "Request submitted", at: dayMonth(r.createdAt), done: true },
    { label: "Mechanics reviewing", detail: matched ? `Sent to ${plural(matched, "qualified mechanic")}` : undefined, done: matched > 0 },
    { label: "Mechanics interested", detail: interested ? `${interested} so far` : "No replies yet", done: interested > 0 },
    { label: "Estimates received", detail: sent.length ? plural(sent.length, "written estimate") : undefined, done: sent.length > 0 },
    { label: "Mechanic selected", detail: accepted ? `You chose ${who}` : undefined, done: Boolean(accepted) },
    { label: "Appointment scheduled", detail: job ? job.scheduledFor : undefined, done: Boolean(job) },
    { label: "Mechanic confirmed", detail: job?.confirmedAt ? `${who} confirmed the time` : job ? `Waiting for ${who} to confirm` : undefined, done: Boolean(job?.confirmedAt || (job && job.status !== "scheduled")) },
    { label: "Repair in progress", detail: job?.startedAt ? `${who} checked in` : undefined, at: job?.startedAt ? dayMonth(job.startedAt) : undefined, done: Boolean(job?.startedAt) },
    { label: "Repair completed", detail: job?.status === "awaiting_customer" ? "Confirm it's done" : undefined, at: job?.completedAt ? dayMonth(job.completedAt) : undefined, done: job?.status === "completed" },
    { label: "Review", detail: review ? "Thanks for your review" : job?.status === "completed" ? "How did it go?" : undefined, done: Boolean(review) },
  ];
  if (job?.status === "cancelled" || r.status === "cancelled") {
    const cut = raw.findIndex((s) => !s.done);
    return [...raw.slice(0, cut).map((s) => ({ ...s, state: "done" as const })), { label: "Cancelled", state: "current" as const }];
  }
  const firstOpen = raw.findIndex((s) => !s.done);
  return raw.map((s, i) => ({
    label: s.label,
    detail: s.detail,
    at: s.at,
    state: i < firstOpen || firstOpen === -1 ? "done" : i === firstOpen ? "current" : "todo",
  }));
}
