import type { VerificationStatus } from "@/lib/domain/types";
import type { EffectiveStatus } from "@/lib/verification/model";

/** The staff review queue's tabs. One definition for the page, the in-memory counts and the SQL counts. */
export const QUEUE_FILTERS: { key: string; label: string; statuses: VerificationStatus[] }[] = [
  { key: "queue", label: "Needs review", statuses: ["submitted", "under_review"] },
  { key: "waiting", label: "Waiting on mechanic", statuses: ["needs_more_info"] },
  { key: "expiring", label: "Expiring / expired", statuses: ["verified", "expired"] },
  { key: "done", label: "Decided", statuses: ["verified", "failed", "revoked"] },
];

/** Staff never review what a provider decides (identity, screening) or what's automatic. */
export const STAFF_SKIP = ["hosted_identity", "vendor_screening", "email_link", "sms_code", "platform_job"];
export const STAFF_REVIEWED = (method?: string) => !STAFF_SKIP.includes(method ?? "");

/** Does a verification with this effective status and method belong in that tab? */
export function inQueue(key: string, status: EffectiveStatus, method?: string) {
  if (key === "expiring") return status === "expired" || status === "renewal_due";
  if (key === "queue") return (status === "submitted" || status === "under_review") && STAFF_REVIEWED(method);
  if (key === "done") return (status === "verified" || status === "failed" || status === "revoked") && method !== "platform_job" && method !== "customer_confirmation";
  return ((QUEUE_FILTERS.find((f) => f.key === key)?.statuses ?? []) as string[]).includes(status);
}

export type QueueCounts = Record<string, number> & { approvedThisWeek: number };
