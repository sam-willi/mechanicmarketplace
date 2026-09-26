import type { SupportReport } from "@/lib/domain/types";
import { TOPICS } from "./help-content";

const STATUS: Record<SupportReport["status"], string> = { open: "Received", in_review: "Being reviewed", resolved: "Resolved" };

export function SupportReports({ reports, label }: { reports: SupportReport[]; label: (r: SupportReport) => string }) {
  if (!reports.length) return null;
  return (
    <section>
      <p className="field-label">Your reports</p>
      <ul className="mt-2 border-t border-rule">
        {reports.map((r) => (
          <li key={r.id} className="border-b border-rule-soft py-2.5">
            <p className="flex items-baseline justify-between gap-3 text-[0.9375rem] font-semibold">
              {TOPICS.find(([k]) => k === r.topic)?.[1] ?? "Report"}
              <span className="shrink-0 text-[0.75rem] font-bold uppercase text-ink-2">{STATUS[r.status]}</span>
            </p>
            <p className="truncate text-[0.8125rem] text-ink-3">{label(r)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
