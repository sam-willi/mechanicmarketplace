import type { ISODate } from "@/lib/domain/types";

/** Days before expiry at which a verified item is flagged for renewal. */
export { RENEWAL_WINDOW_DAYS as REVERIFY_WINDOW_DAYS } from "./model";

/**
 * Status is stored, but expiry is derived at read time so a lapsed insurance policy or
 * certification can never keep showing as verified. Older stored words are read canonically.
 */
export { effective as effectiveStatus, isCurrentlyVerified as isPubliclyValid } from "./model";
export type { EffectiveStatus } from "./model";

export function addMonths(date: ISODate, months: number): ISODate {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Calendar date in the launch market's timezone (Los Angeles), not UTC. */
export function today(): ISODate {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}
