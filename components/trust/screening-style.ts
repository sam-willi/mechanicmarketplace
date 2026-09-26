import { Ban, CircleDashed, Clock, Hourglass, ShieldAlert, ShieldCheck } from "lucide-react";
import type { ScreeningState } from "@/lib/domain/eligibility";

/**
 * Screening status, one visual per state so they can be told apart at a glance
 * (and without color: each has its own icon and words).
 */
export const SCREENING_STYLE: Record<ScreeningState, { icon: typeof ShieldCheck; cls: string; word: string }> = {
  verified: { icon: ShieldCheck, cls: "border-carbon/30 bg-carbon-wash text-carbon", word: "Verified" },
  expiring: { icon: Clock, cls: "border-amber/50 bg-amber-wash text-amber", word: "Expiring soon" },
  pending: { icon: Hourglass, cls: "border-rule bg-sheet text-ink-2", word: "In progress" },
  missing: { icon: CircleDashed, cls: "border-dashed border-rule bg-transparent text-ink-3", word: "Not provided" },
  expired: { icon: ShieldAlert, cls: "border-alert bg-alert-wash text-alert", word: "Expired" },
  rejected: { icon: Ban, cls: "border-alert bg-alert-wash text-alert", word: "Not verified" },
};

