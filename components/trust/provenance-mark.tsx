"use client";

import type { EvidenceDetail } from "@/lib/domain/evidence";
import { BadgeCheck, Building2, FileCheck2, UserCheck, Wrench, type LucideIcon } from "lucide-react";
import type { ProvenanceSource } from "@/lib/domain/types";
import { EvidenceTrigger } from "./evidence-sheet";
import { Tick, tickForStatus } from "./marks";

/** One glyph per kind of proof, so a job record, a past customer and a certificate don't all look like the same checkbox. */
const SOURCE_ICON: Partial<Record<ProvenanceSource, LucideIcon>> = {
  platform: Wrench,
  customer: UserCheck,
  institution: BadgeCheck,
  employer: Building2,
  document: FileCheck2,
};

/**
 * The single provenance chip used across Clutch. Verified sources print in
 * carbon; self-reported prints in pencil with a dashed box and is never green,
 * never filled, never equal.
 */
export function ProvenanceMark({
  detail,
  size = "sm",
  showLabel = true,
  className = "",
}: {
  detail: EvidenceDetail;
  size?: "sm" | "md";
  showLabel?: boolean;
  className?: string;
}) {
  const tick = detail.kind === "safety" ? tickForStatus(detail.status) : tickForStatus(detail.status, detail.source);
  const tone =
    tick === "self"
      ? "text-pencil"
      : tick === "lapsed"
        ? "text-alert"
        : tick === "pending" || tick === "blank"
          ? "text-ink-3"
          : "text-carbon";
  return (
    <EvidenceTrigger
      detail={detail}
      className={`group inline-flex items-center gap-1.5 whitespace-nowrap ${size === "md" ? "text-[0.875rem]" : "text-[0.8125rem]"} font-semibold ${tone} ${className}`}
    >
      {tick === "verified" && detail.kind !== "safety" && SOURCE_ICON[detail.source]
        ? (() => {
            const Icon = SOURCE_ICON[detail.source]!;
            return <Icon size={size === "md" ? 16 : 14} strokeWidth={2.2} aria-hidden className="shrink-0" />;
          })()
        : <Tick state={tick} size={size === "md" ? 16 : 14} />}
      {showLabel && (
        <span className="underline decoration-current/45 decoration-dotted decoration-1 underline-offset-[3px] transition-colors group-hover:decoration-solid group-hover:decoration-current">
          {detail.label}
        </span>
      )}
    </EvidenceTrigger>
  );
}
