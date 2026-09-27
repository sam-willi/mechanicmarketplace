import { AlertTriangle } from "lucide-react";
import type { RepairRequest } from "@/lib/domain/types";
import { jobStatus, mediaCounts, urgencyLabel } from "@/lib/domain/intake";
import { REPAIR_LABEL } from "@/lib/domain/provenance";
import { findArea } from "@/lib/domain/areas";
import { levelOfCategory, type FactLevel } from "@/lib/domain/fact-level";
import { FactTag } from "@/components/trust/fact-tag";

export interface MatchEvidence {
  level: FactLevel;
  text: string;
}

/**
 * The whole job in one ruled box, for a mechanic deciding in seconds: the car, what it's doing
 * (in the customer's words), whether it runs, where and when, what's attached, and why it came
 * to them. Each fact says how sure it is. Everything else sits below, in the full request.
 */
export function JobBrief({ r, distanceMi, match }: { r: RepairRequest; distanceMi?: number; match: MatchEvidence }) {
  const st = jobStatus(r);
  const area = findArea(r.location.area);
  const media = mediaCounts(r);
  const cell = "border-b border-rule-soft px-4 py-3 sm:px-5";
  return (
    <section aria-label="Job summary" className="sheet">
      <div className={`${cell} space-y-1.5`}>
        <p className="field-label">What the car is doing</p>
        <p className="line-clamp-3 text-[1.0625rem] font-semibold">&ldquo;{r.symptomDescription}&rdquo;</p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[0.9375rem] font-bold">{REPAIR_LABEL[r.repairCategory]}</span>
          <FactTag level={levelOfCategory(r.categorySource)} label={r.categorySource === "inferred" ? "Inferred from their words" : "Customer chose"} />
        </p>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-4">
        <div className={`${cell} border-r`}>
          <dt className="field-label">Condition</dt>
          <dd className={`mt-0.5 flex items-center gap-1 font-semibold ${st.tone === "stop" ? "text-alert" : st.tone === "caution" ? "text-amber" : ""}`}>
            {st.tone === "stop" ? <AlertTriangle size={14} aria-hidden /> : null}
            {st.headline}
          </dd>
        </div>
        <div className={`${cell} sm:border-r`}>
          <dt className="field-label">Where</dt>
          <dd className="mt-0.5 font-semibold">
            {area?.label ?? "Not given"}
            {distanceMi !== undefined ? <span className="font-normal text-ink-2"> · {distanceMi < 1 ? "under a mile" : `${Math.round(distanceMi)} mi`}</span> : null}
          </dd>
        </div>
        <div className={`${cell} border-r`}>
          <dt className="field-label">How soon</dt>
          <dd className={`mt-0.5 font-semibold ${r.urgency === "stranded" ? "text-alert" : ""}`}>{urgencyLabel(r.urgency) ?? "Not given"}</dd>
        </div>
        <div className={cell}>
          <dt className="field-label">Attached</dt>
          <dd className="mt-0.5 font-semibold">{media || <span className="font-normal text-ink-3">Nothing yet</span>}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-5">
        <span className="field-label">Why it came to you</span>
        <span className="text-[0.9375rem]">{match.text}</span>
        <FactTag level={match.level} />
      </div>
    </section>
  );
}
