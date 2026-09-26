import { Bell, Eye, Hourglass } from "lucide-react";
import type { Current, Stage } from "@/lib/domain/lifecycle";
import { StatusTimeline } from "@/components/visual/timeline";

/** The current step, spelled out: what happened, who's waiting, what to do, what it triggers. */
export function NowPanel({ current, children, hideHeadline = false }: { current: Current | null; children?: React.ReactNode; hideHeadline?: boolean }) {
  if (!current) return null;
  return (
    <section aria-label="Where this repair stands" className="border-2 border-ink bg-sheet">
      <div className="border-b border-rule-soft px-4 py-3 sm:px-5">
        <p className="field-label">Now</p>
        {hideHeadline ? null : <h2 className="heading mt-0.5 text-[1.25rem]">{current.headline}</h2>}
        {current.waiting ? (
          <p className="mt-1 flex items-center gap-1.5 text-[0.9375rem] text-ink-2">
            <Hourglass size={15} aria-hidden /> {current.waiting}
          </p>
        ) : null}
      </div>
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

export function LifecycleRail({ stages }: { stages: Stage[] }) {
  return (
    <div className="sheet px-4 py-4">
      <p className="field-label">Every step</p>
      <StatusTimeline steps={stages.map((s) => ({ label: s.label, detail: s.detail, at: s.at, state: s.state }))} className="mt-3" />
    </div>
  );
}
