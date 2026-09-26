import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getRepo } from "@/lib/data";
import { getSession, isStaff, needs } from "@/lib/session";
import { dayMonth, usd } from "@/lib/format";
import { quoteTotals } from "@/lib/domain/quote";
import { vehicleLine } from "@/lib/domain/intake";
import { CASE_STATUS } from "@/lib/domain/support";
import { updateSupportCase } from "@/app/actions/admin";
import { SiteHeader } from "@/components/site/site-header";
import { NeedsPersona, PageTitle } from "@/components/workspace/ui";
import { TOPICS } from "@/components/help/help-content";
import { HistoryList } from "@/components/app/history-list";
import { SupportThread } from "@/components/help/support-reports";
import { SubmitButton } from "@/components/auth/submit-button";
import { emailAlertsOn } from "@/lib/notify/config";

export const metadata: Metadata = { title: "Support case" };

/** One report, with the facts staff need beside it: the job, its estimate, amounts reported by each side, and its history. */
export default async function SupportCase({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const repo = await getRepo();
  const s = await getSession();
  if (!isStaff(s))
    return (
      <>
        <SiteHeader />
        <NeedsPersona role="admin" />
      </>
    );
  const { id } = await params;
  await (await needs(s)).supportCase(id);
  const sp = await searchParams;
  const r = repo.getSupportReport(id);
  if (!r) notFound();
  const reporter = repo.getUser(r.userId);
  const job = r.jobId ? repo.getJob(r.jobId) : undefined;
  const q = job ? repo.getQuote(job.quoteId) : undefined;
  const v = job ? repo.getVehicle(job.vehicleId) : undefined;
  const mech = job ? repo.getMechanic(job.mechanicId) : undefined;
  const cust = job ? repo.getCustomer(job.customerId) : undefined;
  const approved = job ? repo.approvedLaborAndFees(job) : 0;
  const pay = (p?: { status: string; amountCents?: number; at: string }) => (p ? `${p.status === "paid" ? "Paid" : "Not paid"}${p.amountCents !== undefined ? ` ${usd(p.amountCents)}` : ""} · ${dayMonth(p.at)}` : "Not reported");

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1100px] space-y-6 px-4 pt-8 pb-24 sm:px-6">
        <Link href="/admin/support" className="inline-flex min-h-11 items-center gap-1.5 text-[0.875rem] text-ink-3 hover:text-ink">
          <ArrowLeft size={14} aria-hidden /> Support reports
        </Link>
        <PageTitle title={TOPICS.find(([k]) => k === r.topic)?.[1] ?? "Report"} note={`${r.id.toUpperCase()} · filed ${dayMonth(r.createdAt)} by ${reporter?.name ?? "an account"} (${r.reporterRole === "mechanic" ? "mechanic" : "customer"}) · ${CASE_STATUS[r.status]}`} />
        {sp.error ? (
          <p role="alert" className="border-l-4 border-alert bg-sheet px-4 py-3 text-[0.9375rem]">
            {sp.error}
          </p>
        ) : sp.saved ? (
          <p role="status" className="border-l-4 border-brand bg-sheet px-4 py-3 text-[0.9375rem] font-semibold">
            Saved. The reporter sees it on their Help page.
          </p>
        ) : null}

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-6">
            <section className="sheet p-4">
              <p className="field-label">What they reported</p>
              <p className="mt-1 whitespace-pre-line">{r.details}</p>
            </section>
            <SupportThread report={r} viewer="staff" />
            {job ? (
              <section className="space-y-3">
                <h2 className="heading text-[1.25rem]">The job</h2>
                <dl className="border-t border-rule text-[0.9375rem]">
                  {(
                    [
                      ["Repair", `${job.title}${v ? ` · ${vehicleLine(v)}` : ""}`],
                      ["People", `${cust?.displayName ?? "Customer"} (customer) · ${mech?.displayName ?? "Mechanic"} (mechanic)`],
                      ["Status", job.status.replace("_", " ")],
                      ["Appointment", job.scheduledFor],
                      ["Accepted estimate", q ? `${usd(q.acceptedTotalCents ?? quoteTotals(q).total)} total, version ${q.acceptedVersion ?? q.version ?? 1}${q.revisions?.length ? ` (${q.revisions.length} earlier version${q.revisions.length === 1 ? "" : "s"})` : ""}` : "Not found"],
                      ["Approved labor and fees", `${usd(approved)} (estimate plus approved extra work; parts separate)`],
                      ["Final amount (mechanic-entered)", job.finalAmountCents !== undefined ? `${usd(job.finalAmountCents)}${job.finalExceedsApproved ? " · higher than approved" : ""}` : "Not entered"],
                      ["Payment, per mechanic", pay(job.payment?.mechanic)],
                      ["Payment, per customer", pay(job.payment?.customer)],
                    ] as const
                  ).map(([k, val]) => (
                    <div key={k} className="grid gap-1 border-b border-rule-soft py-2 sm:grid-cols-[13rem_minmax(0,1fr)]">
                      <dt className="text-ink-3">{k}</dt>
                      <dd className={k.startsWith("Final") && job.finalExceedsApproved ? "font-semibold text-alert" : ""}>{val}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-[0.8125rem] text-ink-3">Amounts and payment are self-reported. Clutch doesn&apos;t process, hold or refund payments.</p>
                <HistoryList entries={job.history ?? []} names={{}} title="Job history" />
                {q ? <HistoryList entries={q.history ?? []} names={{}} title="Estimate history" /> : null}
              </section>
            ) : null}
            <HistoryList entries={r.history ?? []} names={{}} title="Case history" />
          </div>

          <aside className="lg:sticky lg:top-20 lg:self-start">
            <form action={updateSupportCase.bind(null, r.id)} className="space-y-4 border-2 border-ink bg-sheet p-4">
              <p className="heading text-[1.125rem]">Work this case</p>
              <label className="block">
                <span className="field-label">Status</span>
                <select name="status" defaultValue={r.status === "open" ? "in_review" : r.status} className="input mt-1">
                  {(Object.keys(CASE_STATUS) as (keyof typeof CASE_STATUS)[]).map((k) => (
                    <option key={k} value={k}>
                      {CASE_STATUS[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="field-label">Reply to the reporter (optional)</span>
                <textarea name="reply" rows={5} maxLength={4000} className="input mt-1" placeholder={emailAlertsOn() ? "Shown on their Help page. They get an email alert that there's an update, without your text." : "Shown on their Help page in Clutch. Not emailed or texted."} />
              </label>
              <SubmitButton className="btn btn-ink min-h-11 w-full" pending="Saving…">
                Save
              </SubmitButton>
              <p className="text-[0.8125rem] text-ink-3">Clutch can record what happened and reply here. It can&apos;t move money, cancel a mechanic&apos;s payment or rule on who&apos;s right.</p>
            </form>
          </aside>
        </div>
      </main>
    </>
  );
}
