import { AlertTriangle, Ban, CircleCheck, CircleHelp, CircleDashed, MessageCircleWarning } from "lucide-react";
import type { SiteAssessment, SiteFactKind, SiteStatus } from "@/lib/domain/site";

const FACT: Record<SiteFactKind, { icon: typeof CircleCheck; cls: string; tag?: string }> = {
  ok: { icon: CircleCheck, cls: "text-ink" },
  missing: { icon: CircleDashed, cls: "text-ink-3", tag: "Not answered" },
  unsure: { icon: CircleHelp, cls: "text-ink-2", tag: "Customer unsure" },
  risk: { icon: AlertTriangle, cls: "text-amber", tag: "Risk" },
  blocker: { icon: Ban, cls: "text-alert", tag: "Blocks mobile work" },
};

export const SITE_TONE: Record<SiteStatus, string> = {
  ok: "border-ink bg-sheet text-ink",
  shop: "border-rule bg-sheet text-ink-2",
  unknown: "border-rule bg-sheet text-ink",
  risk: "border-amber bg-amber-wash text-amber",
  blocker: "border-alert bg-alert-wash text-alert",
  conflict: "border-alert bg-alert-wash text-alert",
};

/** The single site-feasibility summary: one headline, each fact once, conflicts called out. */
export function SiteSummary({ a }: { a: SiteAssessment }) {
  return (
    <div className="space-y-2">
      <p className={`inline-flex items-center gap-1.5 border px-2 py-1 text-[0.875rem] font-bold ${SITE_TONE[a.status]}`}>
        {a.status === "conflict" ? <MessageCircleWarning size={15} aria-hidden /> : a.status === "blocker" ? <Ban size={15} aria-hidden /> : null}
        {a.headline}
      </p>
      {a.conflicts.map((c) => (
        <p key={c} className="text-[0.875rem] text-alert">
          {c}
        </p>
      ))}
      {a.facts.length > 0 && (
        <ul className="space-y-1">
          {a.facts.map((f) => {
            const F = FACT[f.kind];
            return (
              <li key={f.text} className={`flex items-start gap-1.5 text-[0.9375rem] ${F.cls}`}>
                <F.icon size={15} className="mt-[3px] shrink-0" aria-hidden />
                <span>
                  {f.text}
                  {F.tag ? <span className="ml-1.5 text-[0.75rem] font-bold tracking-[0.04em] uppercase">· {F.tag}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {a.mitigations.map((m) => (
        <p key={m} className="text-[0.875rem] text-ink-2">
          {m}
        </p>
      ))}
    </div>
  );
}
