import { ArrowRight, Check } from "lucide-react";
import { STAGES, partyLabel, type Journey } from "@/lib/domain/journey";

/**
 * Where a repair stands, the same on both sides: the six stages, what's true now, the next action
 * and whose it is. Phones show the current stage by name over a six-part bar; wider screens name
 * every stage.
 */
export function JourneyStatus({ j, audience, names, action }: { j: Journey; audience: "customer" | "mechanic"; names: { customer: string; mechanic?: string }; action?: React.ReactNode }) {
  const who = partyLabel(j.waitingOn, audience, names);
  return (
    <section aria-label="Status" className="sheet">
      <div className="border-b border-rule-soft px-4 pt-3 pb-3 sm:px-5">
        <p className="flex items-baseline justify-between gap-3">
          <span className="text-[0.8125rem] font-bold text-ink-2">
            {j.ended ? j.label : `Step ${j.stage + 1} of ${STAGES.length} · ${j.label}`}
          </span>
          {j.next ? (
            <span className={`shrink-0 text-[0.75rem] font-bold ${j.yourTurn ? "bg-brand px-1.5 py-0.5 text-on-brand" : "text-ink-3"}`}>
              {j.yourTurn ? "Your turn" : `Waiting on ${who}`}
            </span>
          ) : null}
        </p>
        <ol className="mt-2 grid grid-cols-6 gap-1" aria-label="Stages">
          {STAGES.map((s, i) => {
            const state = j.ended ? (i < j.stage ? "done" : "off") : i < j.stage || (i === j.stage && j.stage === STAGES.length - 1) ? "done" : i === j.stage ? "current" : "todo";
            return (
              <li key={s} className="min-w-0">
                <span
                  aria-hidden
                  className={`block h-1.5 ${state === "done" ? "bg-ink" : state === "current" ? "bg-brand" : state === "off" ? "bg-rule-soft" : "bg-rule"}`}
                />
                <span
                  className={`mt-1.5 hidden items-center gap-1 text-[0.75rem] leading-tight md:flex ${state === "current" ? "font-bold text-ink" : state === "done" ? "text-ink-2" : "text-ink-3"}`}
                >
                  {state === "done" ? <Check size={12} strokeWidth={3} className="shrink-0" aria-hidden /> : null}
                  {s}
                </span>
                <span className="sr-only">
                  {s}: {state === "done" ? "done" : state === "current" ? "current" : "not yet"}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
        <div className="min-w-0">
          <p className="font-semibold">{j.now}</p>
          {j.next ? (
            <p className="mt-0.5 text-[0.9375rem] text-ink-2">
              <ArrowRight size={14} className="mr-1 inline align-[-2px]" aria-hidden />
              Next: <span className={j.yourTurn ? "font-semibold text-ink" : ""}>{j.next}</span>
            </p>
          ) : null}
        </div>
        {action ? <div className="sm:justify-self-end">{action}</div> : null}
      </div>
    </section>
  );
}
