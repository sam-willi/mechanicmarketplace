import { CircleAlert, CircleCheck, CircleHelp } from "lucide-react";
import type { Readiness } from "@/lib/domain/readiness";

const STYLE = {
  ready: { icon: CircleCheck, cls: "border-ink bg-sheet text-ink" },
  range: { icon: CircleHelp, cls: "border-amber bg-amber-wash text-amber" },
  ask: { icon: CircleAlert, cls: "border-alert bg-alert-wash text-alert" },
} as const;

/** "Is there enough to quote?" with the specific gaps. */
export function ReadinessBadge({ readiness, audience = "mechanic" }: { readiness: Readiness; audience?: "mechanic" | "customer" }) {
  const S = STYLE[readiness.level];
  const shown = readiness.gaps.slice(0, 3);
  return (
    <div className={`border px-3 py-2 text-[0.875rem] ${S.cls}`}>
      <p className="flex items-center gap-1.5 font-bold">
        <S.icon size={16} aria-hidden />
        {audience === "customer"
          ? { ready: "Mechanics have what they need to quote", range: "Mechanics can quote, with a wider range", ask: "Mechanics will probably need to ask you first" }[readiness.level]
          : readiness.headline}
      </p>
      {shown.length ? (
        <ul className="mt-1 space-y-0.5 text-ink">
          {shown.map((g) => (
            <li key={g.text} className="flex gap-1.5">
              <span aria-hidden className={`mt-[0.55em] size-1.5 shrink-0 rounded-full ${g.blocks ? "bg-current" : "border border-current"}`} />
              <span>
                {g.text}
                {g.blocks ? <span className="ml-1 text-[0.75rem] font-bold uppercase">· needed</span> : null}
              </span>
            </li>
          ))}
          {readiness.gaps.length > shown.length ? <li className="text-ink-2">+{readiness.gaps.length - shown.length} more</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
