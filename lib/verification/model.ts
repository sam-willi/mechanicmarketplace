/**
 * The canonical verification record: one per check, explicit statuses, an append-only history.
 * Every change goes through `transition` (never assign `status` directly), so no decision is ever
 * silently overwritten. See docs/verification.md.
 */
import type { ISODate } from "@/lib/domain/types";

export const CHECK_STATUSES = ["not_started", "in_progress", "submitted", "needs_more_info", "under_review", "verified", "failed", "expired", "revoked"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

/** Who made a change: a person on staff, the mechanic, a provider's webhook, or Clutch itself (expiry, migration). */
export type Actor = { kind: "staff" | "mechanic" | "provider" | "system" | "customer"; id: string };

export type EventAction =
  | "created"
  | "started"
  | "submitted"
  | "provider_update"
  | "approved"
  | "rejected"
  | "requested_info"
  | "revoked"
  | "expired"
  | "cancelled"
  | "superseded"
  | "reminded"
  | "migrated";

export interface VerificationEvent {
  at: string;
  actor: Actor;
  action: EventAction;
  from?: CheckStatus;
  to: CheckStatus;
  reasonCodes?: string[];
  note?: string;
  /** Provider event id, reminder key, …: the same key never applies twice. */
  idempotencyKey?: string;
}

/**
 * Allowed moves. Anything else throws. A retry after failed/expired/revoked, or a renewal, is a
 * NEW record that supersedes the old one (the old one ends as it was, with its history).
 */
const NEXT: Record<CheckStatus, CheckStatus[]> = {
  not_started: ["in_progress", "submitted", "under_review", "verified", "failed"],
  in_progress: ["in_progress", "submitted", "under_review", "needs_more_info", "verified", "failed", "not_started"],
  submitted: ["under_review", "needs_more_info", "verified", "failed"],
  under_review: ["under_review", "needs_more_info", "verified", "failed"],
  needs_more_info: ["in_progress", "submitted", "under_review", "failed", "verified"],
  verified: ["expired", "revoked"],
  failed: [],
  expired: [],
  revoked: [],
};

export class TransitionError extends Error {
  constructor(from: CheckStatus, to: CheckStatus) {
    super(`A check can't go from ${from.replace(/_/g, " ")} to ${to.replace(/_/g, " ")}.`);
    this.name = "TransitionError";
  }
}

export function canMove(from: CheckStatus, to: CheckStatus) {
  return NEXT[from].includes(to);
}

/** The minimal shape `transition` needs; VerificationRecord satisfies it. */
export interface Transitionable {
  status: CheckStatus;
  events?: VerificationEvent[];
  reasonCodes?: string[];
  submittedAt?: ISODate;
  reviewedAt?: ISODate;
  verifiedAt?: ISODate;
  expiresAt?: ISODate;
  decidedBy?: Actor;
}

/**
 * Apply one change and append it to the history. Idempotent on `idempotencyKey`: a repeated
 * webhook delivery or reminder returns false and changes nothing. Returns true when applied.
 */
export function transition(
  r: Transitionable,
  to: CheckStatus,
  e: { actor: Actor; action: EventAction; reasonCodes?: string[]; note?: string; idempotencyKey?: string; at?: string; expiresAt?: ISODate },
): boolean {
  r.events ??= [];
  if (e.idempotencyKey && r.events.some((x) => x.idempotencyKey === e.idempotencyKey)) return false;
  const from = r.status;
  // "Reminded" records a notice without changing status.
  if (e.action !== "reminded" && !(from === to && (to === "under_review" || to === "in_progress")) && !canMove(from, to)) throw new TransitionError(from, to);
  const at = e.at ?? new Date().toISOString();
  r.events.push({ at, actor: e.actor, action: e.action, from, to, ...(e.reasonCodes?.length ? { reasonCodes: e.reasonCodes } : {}), ...(e.note ? { note: e.note } : {}), ...(e.idempotencyKey ? { idempotencyKey: e.idempotencyKey } : {}) });
  r.status = to;
  const day = at.slice(0, 10);
  if (to === "submitted" || (to === "under_review" && !r.submittedAt)) r.submittedAt ??= day;
  if (["verified", "failed", "needs_more_info", "revoked"].includes(to) && e.action !== "provider_update") r.reviewedAt = day;
  if (e.action === "provider_update" && ["verified", "failed", "needs_more_info"].includes(to)) r.reviewedAt = day;
  if (to === "verified") {
    r.verifiedAt = day;
    if (e.expiresAt) r.expiresAt = e.expiresAt;
  }
  if (e.reasonCodes?.length) r.reasonCodes = e.reasonCodes;
  if (["verified", "failed", "needs_more_info", "revoked"].includes(to)) r.decidedBy = e.actor;
  return true;
}

/**
 * Records stored before this model used other words. They're read as the canonical status (and
 * rewritten by scripts/migrate-verifications.ts), so nothing is lost and nothing reads as more
 * than it was.
 */
export function canonStatus(raw: string, ctx: { method?: string } = {}): CheckStatus {
  switch (raw) {
    case "not_submitted":
      return "not_started";
    case "pending":
      return ctx.method === "vendor_screening" || ctx.method === "hosted_identity" ? "in_progress" : "under_review";
    case "rejected":
      return "failed";
    case "needs_info":
      return "needs_more_info";
    case "reverification_required":
      return "verified";
    default:
      return (CHECK_STATUSES as readonly string[]).includes(raw) ? (raw as CheckStatus) : "not_started";
  }
}

/** Days before expiry that a verified check counts as "renewal due" (still verified). */
export const RENEWAL_WINDOW_DAYS = 30;
const DAY = 86_400_000;

/** What a record means right now: expiry is applied at every read, so a lapsed check never reads as verified. */
export type EffectiveStatus = CheckStatus | "renewal_due";

export function effective(status: CheckStatus | string, expiresAt?: ISODate, now: Date = new Date(), method?: string): EffectiveStatus {
  const s = canonStatus(status, { method });
  if (s !== "verified" || !expiresAt) return s;
  const exp = new Date(expiresAt).getTime();
  if (exp <= now.getTime()) return "expired";
  if (exp - now.getTime() <= RENEWAL_WINDOW_DAYS * DAY) return "renewal_due";
  return "verified";
}

/** Counts as verified to customers right now (renewal due is still valid). */
export function isCurrentlyVerified(s: EffectiveStatus) {
  return s === "verified" || s === "renewal_due";
}

/** The mechanic can act on it (start, resubmit, renew). */
export function needsMechanic(s: EffectiveStatus) {
  return s === "not_started" || s === "needs_more_info" || s === "failed" || s === "expired" || s === "revoked" || s === "renewal_due";
}

/**
 * A history for a record that never had one (seeded demo data, or data from before this model),
 * built only from the dates it carries. The first event says where it came from.
 */
export function reconstructedHistory(
  v: { status: CheckStatus; submittedAt?: string; verifiedAt?: string; reviewedAt?: string; reviewerId?: string; provider?: string; notes?: string },
  origin: { actor: Actor; note: string },
): VerificationEvent[] {
  const at = (d?: string) => (d ? (d.length === 10 ? `${d}T12:00:00.000Z` : d) : undefined);
  const start = at(v.submittedAt) ?? at(v.verifiedAt) ?? at(v.reviewedAt) ?? new Date(0).toISOString();
  const events: VerificationEvent[] = [{ at: start, actor: origin.actor, action: "migrated", to: v.status === "not_started" ? "not_started" : "submitted", note: origin.note }];
  if (v.status !== "not_started" && v.status !== "submitted") {
    const decider: Actor = v.reviewerId ? { kind: "staff", id: v.reviewerId } : v.provider ? { kind: "provider", id: v.provider } : origin.actor;
    const action: EventAction = v.status === "verified" || v.status === "expired" ? "approved" : v.status === "failed" ? "rejected" : v.status === "needs_more_info" ? "requested_info" : v.status === "revoked" ? "revoked" : "provider_update";
    events.push({ at: at(v.verifiedAt) ?? at(v.reviewedAt) ?? start, actor: decider, action, from: "submitted", to: v.status === "expired" ? "verified" : v.status, ...(v.notes ? { note: v.notes } : {}) });
  }
  return events;
}
