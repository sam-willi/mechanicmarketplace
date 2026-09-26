import type { Metadata } from "next";
import Link from "next/link";
import { getRepo } from "@/lib/data";
import { getSession, needs } from "@/lib/session";
import { paginate, parseCursor } from "@/lib/data/page";
import { Pager } from "@/components/app/pager";
import { vehicleLine } from "@/lib/domain/intake";
import type { Quote } from "@/lib/domain/types";
import { dayMonth, usd } from "@/lib/format";
import { answerQuoteQuestion } from "@/app/actions/mechanic";
import { Notice, PageTitle } from "@/components/workspace/ui";
import { StatusChip } from "@/components/app/status-chip";

export const metadata: Metadata = { title: "Estimates" };

const TABS: { key: string; label: string; statuses: Quote["status"][] }[] = [
  { key: "sent", label: "Customer deciding", statuses: ["submitted"] },
  { key: "draft", label: "Drafts", statuses: ["draft"] },
  { key: "accepted", label: "Accepted", statuses: ["accepted"] },
  { key: "closed", label: "Declined / expired", statuses: ["declined", "expired", "withdrawn"] },
];
const PAGE = 25;

export default async function MechanicQuotes({ searchParams }: { searchParams: Promise<{ tab?: string; sent?: string; saved?: string; before?: string }> }) {
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "mechanic") return null;
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === (sp.tab ?? (sp.saved ? "draft" : "sent"))) ?? TABS[0];
  const before = parseCursor(sp.before);
  // One tab, one page at a time; the tab counts are counted, not loaded.
  await (await needs(s)).mechanicQuotes(tab.statuses, before, PAGE);
  const counts = await repo.quoteStatusCounts(s.mechanicId);
  const { items: list, next } = paginate(
    repo.listQuotesForMechanic(s.mechanicId).filter((q) => tab.statuses.includes(q.status)),
    (q) => q.createdAt,
    PAGE,
    before,
  );

  return (
    <div className="space-y-6">
      <PageTitle title="Estimates" note="Nobody else sees your prices, and you never see theirs." />
      {sp.sent ? <Notice tone="ok">Estimate sent. The customer sees it next to your verified experience for their car and repair.</Notice> : null}
      {sp.saved ? <Notice>Draft saved. Only you can see it.</Notice> : null}
      <nav aria-label="Estimate status" className="flex gap-1 overflow-x-auto border-b border-rule">
        {TABS.map((t) => {
          const n = t.statuses.reduce((sum, st) => sum + (counts[st] ?? 0), 0);
          return (
            <Link
              key={t.key}
              href={`/mechanic/quotes?tab=${t.key}`}
              aria-current={t.key === tab.key ? "page" : undefined}
              className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-[0.9375rem] ${t.key === tab.key ? "border-ink font-bold" : "border-transparent text-ink-2 hover:text-ink"}`}
            >
              {t.label} <span className="tnum text-ink-3">{n}</span>
            </Link>
          );
        })}
      </nav>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-[0.9375rem]">
          <thead>
            <tr className="border-b border-ink">
              {["Vehicle & customer", "Labor", "Fees", "Parts", "Time", "Available", "Status"].map((h) => (
                <th key={h} className="field-label py-2 pr-4 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tnum">
            {list.map((q) => {
              const r = repo.getRequest(q.requestId)!;
              const v = repo.getVehicle(r.vehicleId)!;
              const c = repo.getCustomer(r.customerId);
              const job = repo.listJobsForMechanic(s.mechanicId).find((j) => j.quoteId === q.id);
              return (
                <tr key={q.id} className="border-b border-rule-soft align-top">
                  <td className="py-3 pr-4">
                    <Link href={job ? `/mechanic/jobs/${job.id}` : `/mechanic/requests/${r.id}${q.status === "draft" ? "#estimate" : ""}`} className="font-semibold hover:underline">
                      {vehicleLine(v)}
                    </Link>
                    <span className="block text-[0.8125rem] text-ink-2">
                      {c?.displayName} · {dayMonth(q.createdAt)}
                    </span>
                    {q.customerQuestions.map((cq, i) => (
                      <div key={i} className="mt-2 max-w-[28rem] border-l-0 bg-paper px-2.5 py-2 text-[0.875rem] font-normal">
                        <p>
                          <span className="font-semibold">{c?.displayName.split(" ")[0]}:</span> {cq.question}
                        </p>
                        {cq.answer ? (
                          <p className="text-ink-2">
                            <span className="font-semibold text-ink">You:</span> {cq.answer}
                          </p>
                        ) : (
                          <form action={answerQuoteQuestion.bind(null, q.id, i)} className="mt-1.5 flex gap-2">
                            <input name="answer" required className="input min-h-11 min-w-0 flex-1 py-1 text-sm" placeholder="Your answer" aria-label="Your answer" />
                            <button className="btn btn-ink min-h-11 px-3 text-sm">Reply</button>
                          </form>
                        )}
                      </div>
                    ))}
                  </td>
                  <td className="py-3 pr-4 font-bold">{usd(q.laborCents)}</td>
                  <td className="py-3 pr-4 text-ink-2">
                    {usd(q.diagnosticFeeCents)} diag
                    <br />
                    {usd(q.travelFeeCents)} travel
                  </td>
                  <td className="py-3 pr-4 text-ink-2">{q.partsIncluded ? `Included (${usd(q.partsEstimateCents)})` : "Excluded"}</td>
                  <td className="py-3 pr-4 text-ink-2">{q.durationHours} hrs</td>
                  <td className="py-3 pr-4 text-ink-2">{q.availableOn}</td>
                  <td className="py-3">
                    <StatusChip label={q.status === "submitted" ? "Customer deciding" : q.status === "draft" ? "Draft" : q.status === "accepted" ? "Accepted" : q.status === "declined" ? "Not chosen" : "Expired"} />
                    {q.status === "submitted" ? (
                      <span className="mt-1 block text-[0.75rem] text-ink-3">{q.viewedAt ? "Viewed by customer" : "Not viewed yet"}</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.length === 0 && <p className="py-6 text-ink-3">No estimates here yet. Estimates you send from a repair request are listed here.</p>}
      </div>
      <Pager href={`/mechanic/quotes?tab=${tab.key}`} next={next} paged={Boolean(before)} />
    </div>
  );
}
