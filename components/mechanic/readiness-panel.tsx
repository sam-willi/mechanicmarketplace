import Link from "next/link";
import { ArrowRight, Check, Circle } from "lucide-react";
import type { ReadinessStep } from "@/lib/matchable";

/**
 * For a mechanic who can't be sent requests yet: exactly what's left, in order,
 * and what being matchable means. No invented demand, no promised volume.
 */
export function ReadinessPanel({ steps, waitingDemand, waitingOnProvider }: { steps: ReadinessStep[]; done?: number; waitingDemand: number; waitingOnProvider: boolean }) {
  const next = steps.find((s) => !s.done && !s.waiting);
  const required = steps.filter((s) => !s.optional);
  const requiredDone = required.filter((s) => s.done).length;
  return (
    <section aria-labelledby="ready-title" className="border-2 border-ink bg-sheet">
      <div className="border-b border-rule px-5 py-4">
        <h2 id="ready-title" className="heading text-[1.375rem]">
          Get matched with customers
        </h2>
        <p className="mt-1 max-w-[68ch] text-[0.9375rem] text-ink-2">
          Clutch is launching in Los Angeles. Customer requests reach you, and customers can book you, once the required profile steps are done and a request fits your
          repairs and area. The verification checks are optional: customers see which ones Clutch has verified, and verified checks improve your ranking.
        </p>
        <p className="mt-2 text-[0.875rem] font-semibold">
          {requiredDone} of {required.length} required steps done
        </p>
      </div>
      <ol className="divide-y divide-rule-soft">
        {steps.map((s) => (
          <li key={s.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
            {s.done ? <Check size={18} className="shrink-0 text-carbon" aria-hidden /> : <Circle size={18} className="shrink-0 text-ink-3" aria-hidden />}
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {s.label}
                {s.optional ? <span className="ml-2 text-[0.75rem] font-bold tracking-wide text-ink-3 uppercase">Optional</span> : null}
                <span className="sr-only">{s.done ? " (done)" : " (to do)"}</span>
              </p>
              <p className="text-[0.875rem] text-ink-2">{s.detail}</p>
            </div>
            {!s.done ? (
              <Link href={s.href} className={`btn min-h-11 px-4 text-sm ${s === next ? "btn-ink" : "btn-line"}`}>
                {s.cta} <ArrowRight size={14} aria-hidden />
              </Link>
            ) : null}
          </li>
        ))}
      </ol>
      {waitingDemand > 0 || waitingOnProvider ? (
        <div className="space-y-1 border-t border-rule px-5 py-3 text-[0.875rem] text-ink-2">
          {waitingDemand > 0 ? (
            <p>
              <span className="font-semibold text-ink">{waitingDemand === 1 ? "1 saved customer request fits" : `${waitingDemand} saved customer requests fit`}</span> the
              repairs and area on your profile and {waitingDemand === 1 ? "is" : "are"} waiting for a mechanic.
            </p>
          ) : null}
          {waitingOnProvider ? (
            <p>
              ID, background and driving record checks open once Clutch connects an independent screening company. Until then they show as not completed on your profile.
              You can still receive requests and be booked once your profile steps are done.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
