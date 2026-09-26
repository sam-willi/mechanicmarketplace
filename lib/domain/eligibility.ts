import type { PublicMechanicProfile, PublicStatus } from "./public-profile";
import { SAFETY } from "./provenance";
import { monthYear } from "@/lib/format";
import { REVERIFY_WINDOW_DAYS } from "@/lib/verification/lifecycle";

/**
 * One set of rules for "can this mechanic quote, be booked, and do the work?",
 * used by search, profiles, estimates, jobs and the mechanic's own dashboard.
 *
 * Required screening: identity, background check, insurance, and a driving
 * record check when the mechanic drives to customers. Every required item must
 * be verified (or verified and expiring soon). Anything else blocks.
 */
export type ScreeningState = "verified" | "expiring" | "pending" | "missing" | "expired" | "rejected";
export type ScreeningKey = "identity" | "background" | "insurance" | "driving_record";

export function screeningState(s: PublicStatus): ScreeningState {
  switch (s.status) {
    case "verified":
      return "verified";
    case "reverification_required":
      return "expiring";
    case "pending":
      return "pending";
    case "expired":
      return "expired";
    case "rejected":
    case "needs_info":
      return "rejected";
    default:
      return "missing";
  }
}

export interface ScreeningItem {
  key: ScreeningKey;
  name: string;
  state: ScreeningState;
  /** Public wording. A failed or returned check reads "not verified": screening outcomes are never exposed. */
  label: string;
  /** Owner/admin wording, which may say "rejected". */
  privateLabel: string;
  when?: string;
}

const NAME: Record<ScreeningKey, string> = {
  identity: "ID check",
  background: "Background check",
  driving_record: "Driving record check",
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
    const label = {
      verified: SAFETY[key].passLabel,
      expiring: `${SAFETY[key].passLabel}, expires ${exp}`,
      pending: `${name} in progress`,
      missing: `${name} not provided`,
      expired: `${name} expired ${exp ?? ""}`.trim(),
      rejected: `${name} not verified`,
    }[state];
    const privateLabel = state === "rejected" ? `${name} not approved` : label;
    return { key, name, state, label, privateLabel, when: exp };
  });
}

export interface Eligibility {
  /** Can send estimates, be booked, and start booked work. The same rule for all three. */
  eligible: boolean;
  tone: "ok" | "warn" | "stop";
  /** Short line for customers, e.g. "Can't be booked right now: insurance expired Sep 2026". */
  customerLine: string;
  /** For the mechanic: what to do. */
  mechanicLine: string;
  blocking: ScreeningItem[];
  expiring: ScreeningItem[];
}

export function eligibility(p: Pick<PublicMechanicProfile, "safety" | "firstName">): Eligibility {
  const items = screeningItems(p);
  const blocking = items.filter((i) => i.state !== "verified" && i.state !== "expiring");
  const expiring = items.filter((i) => i.state === "expiring");
  if (blocking.length) {
    const worst = blocking.find((b) => b.state === "expired") ?? blocking.find((b) => b.state === "rejected") ?? blocking.find((b) => b.state === "missing") ?? blocking[0];
    const why = blocking.map((b) => b.label.charAt(0).toLowerCase() + b.label.slice(1)).join(", ");
    return {
      eligible: false,
      tone: "stop",
      customerLine: `${why.charAt(0).toUpperCase()}${why.slice(1)}. Clutch doesn't allow estimates or bookings until ${p.firstName}'s required screening is current.`,
      mechanicLine:
        worst.state === "pending"
          ? `You can send estimates once your ${blocking.map((b) => b.name.toLowerCase()).join(" and ")} ${blocking.length === 1 ? "is" : "are"} verified.`
          : `Estimates and bookings are paused until you fix: ${blocking.map((b) => b.privateLabel.toLowerCase()).join(", ")}.`,
      blocking,
      expiring,
    };
  }
  if (expiring.length) {
    return {
      eligible: true,
      tone: "warn",
      customerLine: `Screening complete. ${expiring.map((e) => `${e.name} renews ${e.when}`).join(", ")}.`,
      mechanicLine: `Renew before it lapses (within ${REVERIFY_WINDOW_DAYS} days): ${expiring.map((e) => `${e.name.toLowerCase()} expires ${e.when}`).join(", ")}. After that, estimates and bookings pause.`,
      blocking,
      expiring,
    };
  }
  return { eligible: true, tone: "ok", customerLine: "Screening complete: can be booked.", mechanicLine: "All required screening is current.", blocking, expiring };
}

/** One line for cards and dashboards: "Screening current" or "3 of 4 current". */
export function screeningSummary(p: Pick<PublicMechanicProfile, "safety">) {
  const items = screeningItems(p);
  const ok = items.filter((i) => i.state === "verified" || i.state === "expiring").length;
  return { ok, total: items.length, current: ok === items.length, label: ok === items.length ? "Screening current" : `Screening ${ok} of ${items.length} current` };
}

/** Why someone can't be booked, as one short status ("Insurance expired", "Screening incomplete"). */
export function notBookableStatus(e: Eligibility) {
  const expired = e.blocking.filter((b) => b.state === "expired");
  if (expired.length === 1) return `${expired[0].name} expired`;
  return "Screening incomplete";
}
