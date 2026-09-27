import type { PublicMechanicProfile, PublicStatus } from "./public-profile";
import { SAFETY } from "./provenance";
import { AREAS } from "./areas";
import { monthYear } from "@/lib/format";
import { REVERIFY_WINDOW_DAYS } from "@/lib/verification/lifecycle";
import { statement } from "@/lib/verification/claims";

/**
 * Two separate questions, never merged:
 *
 * 1. READY: can this mechanic receive requests, send estimates and be booked? Only the basic
 *    profile a job needs: a service area, the repairs they do, a pricing approach and when
 *    they work. (Policy since 2026-09-26: verification is NOT required to be booked.)
 *
 * 2. VERIFIED: which of the four checks has Clutch verified? Identity, Background check,
 *    Driving record (when they drive to customers), Insurance, each with its own status.
 *    Unverified mechanics are shown as unverified everywhere and customers acknowledge what
 *    Clutch hasn't verified before booking one (lib/domain/disclosure.ts). A verified
 *    mechanic ranks higher; an unverified one is still found and can still be booked.
 */
export type ScreeningState = "verified" | "expiring" | "pending" | "unavailable" | "missing" | "expired" | "rejected";
export type ScreeningKey = "identity" | "background" | "insurance" | "driving_record";

export function screeningState(s: PublicStatus): ScreeningState {
  switch (s.status) {
    case "verified":
      return "verified";
    case "renewal_due":
      return "expiring";
    case "in_progress":
    case "submitted":
    case "under_review":
    case "needs_more_info":
      return s.unavailable ? "unavailable" : "pending";
    case "expired":
      return "expired";
    case "failed":
    case "revoked":
      return "rejected";
    default:
      return "missing";
  }
}

/** The customer-facing status words. Exact, never a vague "verified" badge. */
export const STATUS_WORD: Record<ScreeningState, string> = {
  verified: "Verified",
  expiring: "Verified",
  pending: "Pending",
  unavailable: "Could not be verified",
  missing: "Not completed",
  expired: "Expired",
  rejected: "Not verified",
};

export interface ScreeningItem {
  key: ScreeningKey;
  /** "Identity", "Background check", "Driving record", "Insurance". */
  name: string;
  state: ScreeningState;
  /** Did Clutch verify it (and is it current)? */
  verified: boolean;
  /** "Identity: Verified", "Insurance: Expired Sep 2026", "Background check: Not completed". */
  label: string;
  /** Owner/admin wording. */
  privateLabel: string;
  /** Expiry month, when known. */
  when?: string;
  /** The plain public sentence: "Identity verified by Stripe Identity on Sep 26, 2026". */
  statement: string;
  /** Who checked it, when verified. */
  by?: string;
  verifiedAt?: string;
}

const NAME: Record<ScreeningKey, string> = {
  identity: "Identity",
  background: "Background check",
  driving_record: "Driving record",
  insurance: "Insurance",
};

export function screeningItems(p: Pick<PublicMechanicProfile, "safety">): ScreeningItem[] {
  const s = p.safety;
  const keys: ScreeningKey[] = ["identity", "background", ...(s.drivingApplies ? (["driving_record"] as const) : []), "insurance"];
  return keys.map((key) => {
    const st = s[key];
    const state = screeningState(st);
    const name = NAME[key];
    const exp = st.expiresAt ? monthYear(st.expiresAt) : undefined;
    const word = STATUS_WORD[state];
    const label =
      state === "expiring" ? `${name}: Verified, renews ${exp}` : state === "expired" ? `${name}: Expired${exp ? ` ${exp}` : ""}` : `${name}: ${word}`;
    const privateLabel = state === "rejected" ? `${name}: not approved` : label;
    return {
      key,
      name,
      state,
      verified: state === "verified" || state === "expiring",
      label,
      privateLabel,
      when: exp,
      statement: statement(key, { state, by: st.by, verifiedAt: st.verifiedAt, expiresAt: st.expiresAt }),
      by: st.by,
      verifiedAt: st.verifiedAt,
    };
  });
}

/** What Clutch says about insurance it hasn't verified. No conclusions about who's responsible for what. */
export const INSURANCE_UNVERIFIED_NOTE = "Clutch has not verified active insurance coverage. Ask the mechanic for proof of insurance before the work starts.";

export interface ReadinessItem {
  key: "area" | "repairs" | "pricing" | "availability";
  label: string;
  done: boolean;
}

/** The basic profile a mechanic needs before requests reach them and customers can book them. */
export function readiness(
  p: Pick<PublicMechanicProfile, "neighborhood" | "serviceRadiusMi" | "pricing" | "availabilityNote" | "openings"> & { selfReported: Pick<PublicMechanicProfile["selfReported"], "declaredCategories"> },
): { ready: boolean; items: ReadinessItem[]; missing: ReadinessItem[] } {
  const items: ReadinessItem[] = [
    { key: "area", label: "Service area", done: AREAS.some((a) => a.label === p.neighborhood) && p.serviceRadiusMi > 0 },
    { key: "repairs", label: "Repairs offered", done: p.selfReported.declaredCategories.length > 0 },
    { key: "pricing", label: "Pricing", done: p.pricing.hourlyRateCents > 0 || p.pricing.fixed.length > 0 },
    { key: "availability", label: "Availability", done: Boolean(p.availabilityNote?.trim()) || p.openings.length > 0 },
  ];
  const missing = items.filter((i) => !i.done);
  return { ready: missing.length === 0, items, missing };
}

export interface Eligibility {
  /** Can receive requests, send estimates and be booked: the basic profile is complete. Verification is separate. */
  eligible: boolean;
  /** Every applicable check verified and current. */
  fullyVerified: boolean;
  /** Each check with its own status. */
  checks: ScreeningItem[];
  /** The checks Clutch has NOT verified (for disclosure). */
  unverified: ScreeningItem[];
  /** Verified, but expiring within the renewal window. */
  expiring: ScreeningItem[];
  /** Profile steps still missing (why a mechanic isn't bookable). */
  missing: ReadinessItem[];
  /** ok = ready and fully verified; warn = ready, not fully verified; stop = profile incomplete. */
  tone: "ok" | "warn" | "stop";
  /** One line for customers: exactly what is and isn't verified. Never "safe". */
  customerLine: string;
  /** One line for the mechanic. */
  mechanicLine: string;
}

type ProfileForEligibility = Pick<PublicMechanicProfile, "safety" | "firstName" | "neighborhood" | "serviceRadiusMi" | "pricing" | "availabilityNote" | "openings"> & {
  selfReported: Pick<PublicMechanicProfile["selfReported"], "declaredCategories">;
};

export function eligibility(p: ProfileForEligibility): Eligibility {
  const checks = screeningItems(p);
  const unverified = checks.filter((c) => !c.verified);
  const expiring = checks.filter((c) => c.state === "expiring");
  const r = readiness(p);
  const fullyVerified = unverified.length === 0;
  const notVerified = unverified.map((c) => `${c.name.toLowerCase()} (${STATUS_WORD[c.state].toLowerCase()})`).join(", ");
  const verifiedNames = checks.filter((c) => c.verified).map((c) => c.name.toLowerCase());
  const customerLine = !r.ready
    ? `${p.firstName} hasn't finished their profile yet, so they can't be booked.`
    : fullyVerified
      ? `Clutch verified: ${verifiedNames.join(", ")}.`
      : `Clutch has not verified: ${notVerified}.${verifiedNames.length ? ` Verified: ${verifiedNames.join(", ")}.` : ""}`;
  const mechanicLine = !r.ready
    ? `Finish your profile to receive requests: ${r.missing.map((m) => m.label.toLowerCase()).join(", ")}.`
    : fullyVerified
      ? expiring.length
        ? `Renew within ${REVERIFY_WINDOW_DAYS} days to stay fully verified: ${expiring.map((e) => `${e.name.toLowerCase()} expires ${e.when}`).join(", ")}.`
        : "All checks verified. Customers see this, and it helps your ranking."
      : `You can receive requests and be booked. Customers see what isn't verified yet (${notVerified}); verified checks build trust and improve your ranking.`;
  return { eligible: r.ready, fullyVerified, checks, unverified, expiring, missing: r.missing, tone: !r.ready ? "stop" : fullyVerified ? "ok" : "warn", customerLine, mechanicLine };
}

/** One line for cards: "All 4 checks verified" or "2 of 4 checks verified". Always shown with the per-check list nearby. */
export function screeningSummary(p: Pick<PublicMechanicProfile, "safety">) {
  const items = screeningItems(p);
  const ok = items.filter((i) => i.verified).length;
  return { ok, total: items.length, current: ok === items.length, label: ok === items.length ? `All ${items.length} checks verified` : `${ok} of ${items.length} checks verified` };
}

/** Why someone can't be booked right now (only an incomplete profile stops booking). */
export function notBookableStatus(e: Eligibility) {
  return e.missing.length ? `Profile incomplete: ${e.missing.map((m) => m.label.toLowerCase()).join(", ")}` : "Available";
}

export const CHECK_NAMES = NAME;
export { SAFETY };
