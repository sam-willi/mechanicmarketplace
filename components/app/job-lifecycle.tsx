import { Bell, ChevronDown, Eye, Hourglass } from "lucide-react";
import type { Current, Stage } from "@/lib/domain/lifecycle";
import { StatusTimeline } from "@/components/visual/timeline";

/** The current step, spelled out: what happened, who's waiting, what to do, what it triggers. */
export function NowPanel({ current, children, hideHeadline = false, hideWaiting = false }: { current: Current | null; children?: React.ReactNode; hideHeadline?: boolean; hideWaiting?: boolean }) {
  if (!current) return null;
  // With the shared status (components/app/journey-status.tsx) above it, only the actions and what they trigger remain.
  const compact = hideHeadline && hideWaiting;
  if (compact && !children && !current.notifies && !current.becomesPublic) return null;
  return (
    <section aria-label={compact ? "What to do" : "Where this repair stands"} className="border-2 border-ink bg-sheet">
      {compact ? null : <div className="border-b border-rule-soft px-4 py-3 sm:px-5">
        <p className="field-label">Now</p>
        {hideHeadline ? null : <h2 className="heading mt-0.5 text-[1.25rem]">{current.headline}</h2>}
        {current.waiting && !hideWaiting ? (
          <p className="mt-1 flex items-center gap-1.5 text-[0.9375rem] text-ink-2">
            <Hourglass size={15} aria-hidden /> {current.waiting}
          </p>
        ) : null}
      </div>}
      {children ? <div className="px-4 py-4 sm:px-5">{children}</div> : null}
      {current.notifies || current.becomesPublic ? (
        <ul className="space-y-1 border-t border-rule-soft bg-paper/50 px-4 py-3 text-[0.8125rem] text-ink-2 sm:px-5">
          {current.notifies ? (
            <li className="flex gap-1.5">
              <Bell size={14} className="mt-0.5 shrink-0" aria-hidden /> <span>{current.notifies}</span>
            </li>
          ) : null}
          {current.becomesPublic ? (
            <li className="flex gap-1.5">
              <Eye size={14} className="mt-0.5 shrink-0" aria-hidden /> <span>{current.becomesPublic}</span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}

/** The detailed job checklist under the shared status: collapsed, so the six stages stay the one status. */
export function LifecycleRail({ stages }: { stages: Stage[] }) {
  const done = stages.filter((s) => s.state === "done").length;
  return (
    <details className="sheet group">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 [&::-webkit-details-marker]:hidden">
        <span className="font-semibold">
          Job checklist <span className="font-normal text-ink-3">· {done} of {stages.filter((s) => s.state !== "skipped").length}</span>
        </span>
        <ChevronDown size={16} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-rule-soft px-4 py-4">
        <StatusTimeline steps={stages.map((s) => ({ label: s.label, detail: s.detail, at: s.at, state: s.state }))} />
      </div>
    </details>
  );
}
