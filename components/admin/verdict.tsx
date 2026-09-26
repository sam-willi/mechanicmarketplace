import { Check, Clock, Hourglass, MessageCircleQuestion, RotateCcw, X } from "lucide-react";
import type { VerificationStatus } from "@/lib/domain/types";
import type { ScreeningItem, ScreeningState } from "@/lib/domain/eligibility";

/** Status as a solid, colour-coded chip: green approved, red rejected/expired, amber waiting. Always icon + words. */
const VERDICT: Record<VerificationStatus, { label: string; cls: string; icon: typeof Check }> = {
  verified: { label: "Approved", cls: "border-go bg-go-wash text-go", icon: Check },
  rejected: { label: "Rejected", cls: "border-alert bg-alert-wash text-alert", icon: X },
  pending: { label: "Needs review", cls: "border-amber bg-amber-wash text-amber", icon: Hourglass },
  needs_info: { label: "Waiting on mechanic", cls: "border-brand-tint bg-brand-wash text-brand-deep", icon: MessageCircleQuestion },
  expired: { label: "Expired", cls: "border-alert bg-alert-wash text-alert", icon: Clock },
  reverification_required: { label: "Renewal due", cls: "border-amber bg-amber-wash text-amber", icon: RotateCcw },
  not_submitted: { label: "Not submitted", cls: "border-rule bg-sheet text-ink-3", icon: Clock },
} as Record<VerificationStatus, { label: string; cls: string; icon: typeof Check }>;

export function VerdictChip({ status, big = false }: { status: VerificationStatus; big?: boolean }) {
  const v = VERDICT[status] ?? VERDICT.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 border font-bold whitespace-nowrap ${big ? "px-3 py-1.5 text-[0.9375rem]" : "px-2 py-0.5 text-[0.8125rem]"} ${v.cls}`}>
      <v.icon size={big ? 17 : 14} strokeWidth={2.75} aria-hidden /> {v.label}
    </span>
  );
}

const SAFETY: Record<ScreeningState, { cls: string; icon: typeof Check; word: string }> = {
  verified: { cls: "border-go bg-go-wash text-go", icon: Check, word: "passed" },
  expiring: { cls: "border-amber bg-amber-wash text-amber", icon: RotateCcw, word: "renewal due" },
  pending: { cls: "border-amber bg-amber-wash text-amber", icon: Hourglass, word: "in progress" },
  unavailable: { cls: "border-amber bg-amber-wash text-amber", icon: Clock, word: "could not be verified (no provider)" },
  missing: { cls: "border-rule bg-sheet text-ink-3", icon: Clock, word: "not submitted" },
  expired: { cls: "border-alert bg-alert-wash text-alert", icon: X, word: "expired" },
  rejected: { cls: "border-alert bg-alert-wash text-alert", icon: X, word: "not approved" },
};

/** The four safety checks at a glance: green ✓, amber waiting, red ✕. */
export function SafetyChips({ items }: { items: ScreeningItem[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Verification checks">
      {items.map((i) => {
        const s = SAFETY[i.state];
        return (
          <li key={i.key} className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[0.75rem] font-bold ${s.cls}`}>
            <s.icon size={13} strokeWidth={3} aria-hidden /> {i.name}
            <span className="sr-only"> {s.word}</span>
          </li>
        );
      })}
    </ul>
  );
}
