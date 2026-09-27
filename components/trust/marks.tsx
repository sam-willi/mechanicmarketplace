import type { ProvenanceSource } from "@/lib/domain/types";
import type { EffectiveStatus } from "@/lib/verification/model";

/**
 * The form's tick box, drawn once and reused everywhere. Filled carbon = proven.
 * Dashed pencil = self-reported (a blank the mechanic filled in themselves).
 * Hollow = in progress. Struck = lapsed.
 */
export function Tick({ state = "verified", size = 16, className = "" }: { state?: TickState; size?: number; className?: string }) {
  const s = size;
  if (state === "verified")
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden className={`shrink-0 ${className}`}>
        <rect x="0.5" y="0.5" width="15" height="15" rx="1.5" fill="var(--carbon)" stroke="var(--carbon)" />
        <path d="M4 8.3 6.7 11 12 5.2" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="square" />
      </svg>
    );
  if (state === "self")
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden className={`shrink-0 ${className}`}>
        <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="1.5" fill="none" stroke="var(--pencil)" strokeWidth="1.2" strokeDasharray="2.4 2" />
      </svg>
    );
  if (state === "pending")
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden className={`shrink-0 ${className}`}>
        <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="1.5" fill="none" stroke="var(--ink-3)" strokeWidth="1.2" />
        <path d="M8 4.2V8l2.4 1.6" fill="none" stroke="var(--ink-3)" strokeWidth="1.4" />
      </svg>
    );
  if (state === "lapsed")
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden className={`shrink-0 ${className}`}>
        <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="1.5" fill="var(--alert-wash)" stroke="var(--alert)" strokeWidth="1.2" />
        <path d="M4.5 11.5 11.5 4.5" stroke="var(--alert)" strokeWidth="1.5" />
      </svg>
    );
  if (state === "renewing")
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden className={`shrink-0 ${className}`}>
        <rect x="0.5" y="0.5" width="15" height="15" rx="1.5" fill="var(--carbon)" stroke="var(--carbon)" />
        <path d="M4 8.3 6.7 11 12 5.2" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="square" />
        <circle cx="13.5" cy="2.5" r="2.5" fill="var(--amber)" stroke="var(--sheet)" strokeWidth="1" />
      </svg>
    );
  if (state === "inferred")
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden className={`shrink-0 ${className}`}>
        <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="1.5" fill="none" stroke="var(--ink-3)" strokeWidth="1.2" strokeDasharray="0.1 2.3" strokeLinecap="round" />
        <circle cx="8" cy="8" r="1.8" fill="var(--ink-3)" />
      </svg>
    );
  return (
    <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden className={`shrink-0 ${className}`}>
      <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="1.5" fill="none" stroke="var(--rule)" strokeWidth="1.2" />
    </svg>
  );
}

/** inferred: worked out by Clutch from other facts (dotted, with a centre dot), never shown as confirmed. */
export type TickState = "verified" | "self" | "pending" | "lapsed" | "renewing" | "inferred" | "blank";

export function tickForStatus(status: EffectiveStatus, provenance?: ProvenanceSource): TickState {
  if (provenance === "self" && (status === "not_started" || status === "verified")) return "self";
  switch (status) {
    case "verified":
      return "verified";
    case "renewal_due":
      return "renewing";
    case "in_progress":
    case "submitted":
    case "under_review":
    case "needs_more_info":
      return provenance === "self" ? "self" : "pending";
    case "expired":
    case "failed":
    case "revoked":
      return "lapsed";
    default:
      return "blank";
  }
}
