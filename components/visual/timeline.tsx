import { Check } from "lucide-react";

export type TimelineStep = { label: string; detail?: string; at?: string; state: "done" | "current" | "todo" | "skipped" };

/**
 * Where a repair stands, as a vertical progress line. Done steps are solid,
 * the current step is outlined in ink, upcoming steps are quiet.
 */
export function StatusTimeline({ steps, className = "" }: { steps: TimelineStep[]; className?: string }) {
  return (
    <ol className={`relative ${className}`}>
      {steps.map((s, i) => (
        <li key={s.label} className="relative flex gap-3 pb-4 last:pb-0">
          {i < steps.length - 1 && (
            <span aria-hidden className={`absolute top-6 bottom-0 left-[11px] w-0.5 ${s.state === "done" ? "bg-brand" : "bg-rule-soft"}`} />
          )}
          <span
            aria-hidden
            className={`relative z-10 grid size-6 shrink-0 place-items-center rounded-full border-2 ${
              s.state === "done" ? "border-brand bg-brand text-sheet" : s.state === "current" ? "border-ink bg-sheet ring-4 ring-brand/15" : s.state === "skipped" ? "border-dashed border-rule bg-paper" : "border-rule bg-sheet"
            }`}
          >
            {s.state === "done" ? <Check size={13} strokeWidth={3} /> : s.state === "current" ? <span className="size-2 rounded-full bg-brand" /> : null}
          </span>
          <div className="min-w-0 pt-0.5">
            <p className={`text-[0.9375rem] leading-tight ${s.state === "todo" || s.state === "skipped" ? "text-ink-3" : "font-semibold text-ink"}`}>
              {s.label}
              {s.state === "current" ? <span className="ml-1.5 text-[0.6875rem] font-extrabold tracking-[0.06em] uppercase">Now</span> : null}
              {s.state === "skipped" ? <span className="ml-1.5 text-[0.75rem]">(not needed)</span> : null}
              <span className="sr-only">{s.state === "done" ? " (done)" : s.state === "current" ? " (current step)" : ""}</span>
            </p>
            {s.detail ? <p className={`mt-0.5 text-[0.8125rem] ${s.state === "todo" ? "text-ink-3" : "text-ink-2"}`}>{s.detail}</p> : null}
            {s.at ? <p className="mt-0.5 text-[0.75rem] text-ink-3">{s.at}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Build a sequential list of steps given how many are done. */
export function stepsFrom(labels: (string | { label: string; detail?: string; at?: string })[], doneCount: number, finished = false): TimelineStep[] {
  return labels.map((l, i) => {
    const o = typeof l === "string" ? { label: l } : l;
    return { ...o, state: i < doneCount || (finished && i === doneCount) ? "done" : i === doneCount ? "current" : "todo" };
  });
}
