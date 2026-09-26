import { INSURANCE_UNVERIFIED_NOTE, STATUS_WORD, screeningItems } from "./eligibility";
import type { PublicMechanicProfile } from "./public-profile";
import type { CheckSnapshot } from "./types";

export type { CheckSnapshot, VerificationAtBooking } from "./types";

/**
 * Booking a mechanic Clutch hasn't fully verified: the customer sees exactly which checks
 * Clutch has and hasn't verified, and ticks an (unticked by default) acknowledgement before
 * booking. It is a disclosure, not a waiver: it doesn't remove any risk or anyone's obligations.
 * The text, its version, the statuses shown, who and when are kept with the booking and never
 * change afterwards, even if the mechanic's checks later do.
 *
 * Policy decision of 2026-09-26 (bookable without verification). Needs legal review before launch.
 */
export const DISCLOSURE_VERSION = "unverified-booking/2026-09-26.1";
export const ACK_TEXT = "I understand these checks have not been completed or verified by Clutch.";

export function checksNow(p: Pick<PublicMechanicProfile, "safety">): CheckSnapshot[] {
  return screeningItems(p).map((c) => ({
    key: c.key,
    name: c.name,
    state: c.state,
    status: c.state === "expiring" ? `Verified, renews ${c.when}` : c.state === "expired" && c.when ? `Expired ${c.when}` : STATUS_WORD[c.state],
    verified: c.verified,
  }));
}

/** What a customer sends back from the confirmation step (the server re-checks all of it). */
export interface BookingAcknowledgement {
  version: string;
  /** snapshotKey of the checks as the customer read them. */
  snapshot: string;
}

/**
 * A short, stable fingerprint of the statuses: the form carries the one the customer read,
 * and the server refuses the booking if the mechanic's checks have changed since.
 */
export function snapshotKey(checks: CheckSnapshot[]) {
  return checks.map((c) => `${c.key}:${c.state}`).join("|");
}

/** The disclosure, as plain text: exactly what the confirmation step says. */
export function disclosureText(firstName: string, checks: CheckSnapshot[]) {
  const done = checks.filter((c) => c.verified);
  const notDone = checks.filter((c) => !c.verified);
  const lines = [
    `Clutch has not verified these checks for ${firstName}:`,
    ...notDone.map((c) => `- ${c.name}: ${c.status}`),
    ...(done.length ? [`Clutch has verified:`, ...done.map((c) => `- ${c.name}: ${c.status}`)] : []),
    ...(notDone.some((c) => c.key === "insurance") ? [INSURANCE_UNVERIFIED_NOTE] : []),
    `Clutch doesn't vouch for checks it hasn't verified. You can still book, ask ${firstName} directly, or choose a fully verified mechanic.`,
    ACK_TEXT,
  ];
  return lines.join("\n");
}
