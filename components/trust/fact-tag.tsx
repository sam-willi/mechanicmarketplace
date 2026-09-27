import { FACT_LABEL, type FactLevel } from "@/lib/domain/fact-level";
import { Tick, type TickState } from "./marks";

const TICK: Record<FactLevel, TickState> = {
  verified: "verified",
  customer_confirmed: "verified",
  self_reported: "self",
  inferred: "inferred",
  unverified: "blank",
};
const TONE: Record<FactLevel, string> = {
  verified: "text-carbon",
  customer_confirmed: "text-carbon",
  self_reported: "text-pencil",
  inferred: "text-ink-3",
  unverified: "text-ink-3",
};

/** How sure a fact is: the tick plus a short label ("Customer said", "From VIN"); the level's own name by default. */
export function FactTag({ level, label, className = "" }: { level: FactLevel; label?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[0.75rem] font-semibold whitespace-nowrap ${TONE[level]} ${className}`} title={FACT_LABEL[level]}>
      <Tick state={TICK[level]} size={12} />
      {label ?? FACT_LABEL[level]}
      {label ? <span className="sr-only"> ({FACT_LABEL[level]})</span> : null}
    </span>
  );
}
