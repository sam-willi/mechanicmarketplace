import { reportIssue } from "@/app/actions/customer";
import { TOPICS } from "./help-content";

/** Report an issue. Attaches the job or request only if it belongs to the reporter (checked server-side). */
export function ReportForm({
  jobs,
  jobId,
  requestId,
}: {
  jobs: { id: string; label: string }[];
  jobId?: string;
  requestId?: string;
}) {
  return (
    <form action={reportIssue} className="sheet space-y-4 p-4 sm:p-5">
      <div>
        <h2 className="heading text-[1.25rem]">Report an issue</h2>
        <p className="text-[0.9375rem] text-ink-2">Tell us what happened. The trust team sees the job&apos;s estimate, notes and photos alongside your report.</p>
      </div>
      <label className="block">
        <span className="field-label">What&apos;s this about?</span>
        <select name="topic" className="input mt-1" defaultValue="work_quality">
          {TOPICS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {jobs.length > 0 && (
        <label className="block">
          <span className="field-label">Which job?</span>
          <select name="jobId" className="input mt-1" defaultValue={jobId ?? ""}>
            <option value="">Not about a specific job</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
      <label className="block">
        <span className="field-label">What happened?</span>
        <textarea name="details" required rows={5} className="input mt-1" placeholder="What happened, when, and what you'd like to happen next." />
      </label>
      <button className="btn btn-ink min-h-12 w-full sm:w-auto">Send report</button>
    </form>
  );
}
