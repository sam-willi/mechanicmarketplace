import type { VerificationStatus } from "@/lib/domain/types";

/** The staff review queue's tabs. One definition for the page, the in-memory counts and the SQL counts. */
export const QUEUE_FILTERS: { key: string; label: string; statuses: VerificationStatus[] }[] = [
  { key: "queue", label: "Needs review", statuses: ["pending"] },
  { key: "waiting", label: "Waiting on mechanic", statuses: ["needs_info"] },
  { key: "expiring", label: "Expiring / expired", statuses: ["verified", "expired", "reverification_required"] },
  { key: "done", label: "Decided", statuses: ["verified", "rejected"] },
];

/** Does a verification with this effective status and method belong in that tab? */
export function inQueue(key: string, status: VerificationStatus, method?: string) {
  if (key === "expiring") return status === "expired" || status === "reverification_required";
  if (key === "done") return (status === "verified" || status === "rejected") && method !== "platform_job" && method !== "customer_confirmation";
  return (QUEUE_FILTERS.find((f) => f.key === key)?.statuses ?? []).includes(status);
}

export type QueueCounts = Record<string, number> & { approvedThisWeek: number };
