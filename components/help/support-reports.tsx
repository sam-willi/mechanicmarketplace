import type { SupportReport } from "@/lib/domain/types";
import { REPORTER_STATUS } from "@/lib/domain/support";
import { addReportMessage } from "@/app/actions/customer";
import { TOPICS } from "./help-content";
import { emailAlertsOn } from "@/lib/notify/config";

const stamp = (at: string) => new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });

/** The conversation on one report, as the reporter or staff see it. */
export function SupportThread({ report, viewer }: { report: SupportReport; viewer: "reporter" | "staff" }) {
  const msgs = report.messages ?? [];
  if (!msgs.length) return viewer === "staff" ? <p className="text-[0.875rem] text-ink-3">No replies yet.</p> : null;
  return (
    <ol className="space-y-2" aria-label="Messages">
      {msgs.map((m, i) => (
        <li key={`${m.at}-${i}`} className={`border px-3 py-2 text-[0.9375rem] ${m.from === "staff" ? "border-brand bg-sheet" : "border-rule bg-paper"}`}>
          <p className="text-[0.75rem] font-semibold text-ink-3">
            {m.from === "staff" ? "Clutch staff" : viewer === "reporter" ? "You" : "Reporter"} · {stamp(m.at)}
          </p>
          <p className="mt-0.5 whitespace-pre-line">{m.body}</p>
        </li>
      ))}
    </ol>
  );
}

/** The reporter's own reports: status, staff replies, and a way to add more. Replies are in the app; an alert only says there's an update. */
export function SupportReports({ reports, label }: { reports: SupportReport[]; label: (r: SupportReport) => string }) {
  if (!reports.length) return null;
  return (
    <section aria-labelledby="my-reports">
      <p id="my-reports" className="field-label">
        Your reports
      </p>
      <p className="mt-1 text-[0.8125rem] text-ink-3">
        Clutch staff reply here, in the app. There&apos;s no set response time.{" "}
        {emailAlertsOn() ? "You'll also get an email alert that there's an update (it doesn't include the reply)." : "Replies aren't sent by email or text."}
      </p>
      <ul className="mt-2 border-t border-rule">
        {reports.map((r) => (
          <li key={r.id} id={`report-${r.id}`} className="scroll-mt-24 space-y-2 border-b border-rule-soft py-3">
            <p className="flex items-baseline justify-between gap-3 text-[0.9375rem] font-semibold">
              {TOPICS.find(([k]) => k === r.topic)?.[1] ?? "Report"}
              <span className="shrink-0 text-[0.75rem] font-bold text-ink-2 uppercase">{REPORTER_STATUS[r.status]}</span>
            </p>
            <p className="text-[0.8125rem] text-ink-3">
              {r.id.toUpperCase()} · {label(r)}
            </p>
            <p className="line-clamp-3 text-[0.875rem] text-ink-2">{r.details}</p>
            <SupportThread report={r} viewer="reporter" />
            <form action={addReportMessage.bind(null, r.id)} className="flex flex-col gap-2 sm:flex-row">
              <label className="sr-only" htmlFor={`msg-${r.id}`}>
                Add to this report
              </label>
              <textarea id={`msg-${r.id}`} name="message" required rows={1} maxLength={4000} className="input min-h-11 flex-1" placeholder={r.status === "resolved" ? "Still a problem? Add a message to reopen it." : "Add details for Clutch staff"} />
              <button className="btn btn-line min-h-11 shrink-0">Send</button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
