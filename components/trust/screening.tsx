"use client";

import type { EvidenceDetail } from "@/lib/domain/evidence";
import type { ScreeningState } from "@/lib/domain/eligibility";
import { EvidenceTrigger } from "./evidence-sheet";
import { SCREENING_STYLE } from "./screening-style";

export function ScreeningChip({ state, detail, compact = false }: { state: ScreeningState; detail: EvidenceDetail; compact?: boolean }) {
  const S = SCREENING_STYLE[state];
  return (
    <EvidenceTrigger detail={detail} className={`inline-flex min-h-8 items-center gap-1.5 border px-2 py-1 font-semibold ${compact ? "text-[0.75rem]" : "text-[0.8125rem]"} ${S.cls}`}>
      <S.icon size={compact ? 13 : 14} strokeWidth={2.2} aria-hidden />
      <span>{detail.label}</span>
    </EvidenceTrigger>
  );
}
