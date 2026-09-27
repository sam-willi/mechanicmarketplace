import type { SupportReport } from "./types";

/** Staff queue wording and the reporter's wording for the same status. */
export const CASE_STATUS: Record<SupportReport["status"], string> = { open: "New", in_review: "Reviewing", resolved: "Resolved" };
export const REPORTER_STATUS: Record<SupportReport["status"], string> = { open: "Received", in_review: "Being reviewed", resolved: "Resolved" };
