import Link from "next/link";
import { ArrowRight, Check, ChevronDown, Circle } from "lucide-react";
import type { ReadinessStep } from "@/lib/matchable";

/** The one sentence that says what to do next, per missing profile step. */
const NEXT: Record<string, string> = {
  area: "Add your service area to start receiving requests.",
  repairs: "Choose the repairs you do to start receiving requests.",
  pricing: "Set your prices to start receiving requests.",
  availability: "Say when you usually work to start receiving requests.",
};

/**
 * For a mechanic who can't be sent requests yet. The next required step is the one big action;
 * the other required steps follow; the optional verification checks are separate and collapsed,
 * because they aren't needed to receive requests or be booked. No invented demand.
 */
export function ReadinessPanel({
  steps,
  waitingDemand,
  waitingOnProvider,
  earlierEstimates = 0,
}: {
  steps: ReadinessStep[];
  done?: number;
  waitingDemand: number;
  waitingOnProvider: boolean;
  /** Estimates this mechanic sent before the missing step was required (older records). */
  earlierEstimates?: number;
}) {
  const required = steps.filter((s) => !s.optional);
  const optional = steps.filter((s) => s.optional);
  const requiredDone = required.filter((s) => s.done).length;
  const next = required.find((s) => !s.done);
  const verified = optional.filter((s) => s.done).length;
  return (
    <section aria-labelledby="ready-title" className="border-2 border-ink bg-sheet">
      {next ? (
        <div className="border-b border-rule bg-paper px-5 py-5">
          <p className="text-[0.8125rem] font-bold text-ink-2">
            Next step · {requiredDone} of {required.length} done
          </p>
          <h2 id="ready-title" className="heading mt-1 text-[1.375rem]">
            {NEXT[next.key] ?? `${next.label}: finish this to start receiving requests.`}
          </h2>
          <Link href={next.href} className="btn btn-ink mt-3 min-h-12 px-5">
            {next.cta} <ArrowRight size={16} aria-hidden />
          </Link>
          {earlierEstimates > 0 ? (
            <p className="mt-3 max-w-[62ch] text-[0.875rem] text-ink-2">
              You sent {earlierEstimates === 1 ? "an estimate" : `${earlierEstimates} estimates`} before this step was required. Customers can&apos;t accept{" "}
              {earlierEstimates === 1 ? "it" : "them"} until you finish it.
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="px-5 py-4">
        <p className="field-label">Required to receive requests and be booked</p>
        <ol className="mt-2 divide-y divide-rule-soft">
          {required.map((s) => (
            <li key={s.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
              {s.done ? <Check size={18} className="shrink-0 text-carbon" aria-hidden /> : <Circle size={18} className="shrink-0 text-ink-3" aria-hidden />}
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {s.label}
                  <span className="sr-only">{s.done ? " (done)" : " (to do)"}</span>
                </p>
                <p className="text-[0.875rem] text-ink-2">{s.detail}</p>
              </div>
              {!s.done && s !== next ? (
                <Link href={s.href} className="btn btn-line min-h-11 px-4 text-sm">
                  {s.cta}
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
      <details className="group border-t border-rule">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 py-2 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="font-semibold">Verification checks (optional)</span>
            <span className="block text-[0.8125rem] text-ink-2">
              {verified} of {optional.length} verified. Not needed to be booked; customers see each one, and verified checks rank you higher.
            </span>
          </span>
          <ChevronDown size={18} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <ol className="divide-y divide-rule-soft border-t border-rule-soft px-5">
          {optional.map((s) => (
            <li key={s.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
              {s.done ? <Check size={18} className="shrink-0 text-carbon" aria-hidden /> : <Circle size={18} className="shrink-0 text-ink-3" aria-hidden />}
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{s.label}</p>
                <p className="text-[0.875rem] text-ink-2">{s.detail}</p>
              </div>
              {!s.done ? (
                <Link href={s.href} className="btn btn-quiet min-h-11 px-3 text-sm">
                  {s.cta}
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
        {waitingOnProvider ? (
          <p className="border-t border-rule-soft px-5 py-3 text-[0.875rem] text-ink-2">
            ID, background and driving record checks open once Clutch connects an independent screening company. Until then they show as not completed on your profile.
          </p>
        ) : null}
      </details>
      {waitingDemand > 0 ? (
        <p className="border-t border-rule px-5 py-3 text-[0.875rem] text-ink-2">
          <span className="font-semibold text-ink">{waitingDemand === 1 ? "1 saved customer request fits" : `${waitingDemand} saved customer requests fit`}</span> the repairs
          and area on your profile and {waitingDemand === 1 ? "is" : "are"} waiting for a mechanic.
        </p>
      ) : null}
    </section>
  );
}
