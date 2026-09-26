import type { ISODate, VerificationStatus } from "@/lib/domain/types";

/** Days before expiry at which a verified item is flagged for reverification. */
export const REVERIFY_WINDOW_DAYS = 30;

const DAY = 86_400_000;

/**
 * Status is stored, but expiry is derived at read time so a lapsed insurance
 * policy or certification can never keep showing as verified.
 */
export function effectiveStatus(
  stored: VerificationStatus,
  expiresAt?: ISODate,
  now: Date = new Date(),
): VerificationStatus {
  if (stored !== "verified" || !expiresAt) return stored;
  const exp = new Date(expiresAt).getTime();
  if (exp <= now.getTime()) return "expired";
  if (exp - now.getTime() <= REVERIFY_WINDOW_DAYS * DAY) return "reverification_required";
  return "verified";
}

/** Still counts publicly as verified (inside the reverification window it is still valid). */
export function isPubliclyValid(status: VerificationStatus) {
  return status === "verified" || status === "reverification_required";
}

export function addMonths(date: ISODate, months: number): ISODate {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Calendar date in the launch market's timezone (Los Angeles), not UTC. */
export function today(): ISODate {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}
