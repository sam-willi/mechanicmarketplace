import type { Metadata } from "next";
import Link from "next/link";
import { getRepo } from "@/lib/data";
import { getSession, isStaff, needs } from "@/lib/session";
import { paginate, parseCursor } from "@/lib/data/page";
import { Pager } from "@/components/app/pager";
import { dayMonth, plural } from "@/lib/format";
import { SiteHeader } from "@/components/site/site-header";
import { NeedsPersona, PageTitle } from "@/components/workspace/ui";
import { TOPICS } from "@/components/help/help-content";
import type { SupportReport } from "@/lib/domain/types";
import { CASE_STATUS } from "@/lib/domain/support";
import { emailAlertsOn } from "@/lib/notify/config";

export const metadata: Metadata = { title: "Support reports" };

/** The staff case queue: every report in this marketplace, newest first, by status. */
const PAGE = 50;

export default async function AdminSupport({ searchParams }: { searchParams: Promise<{ status?: string; before?: string }> }) {
  const repo = await getRepo();
  const s = await getSession();
  if (!isStaff(s))
    return (
      <>
        <SiteHeader />
        <NeedsPersona role="admin" />
      </>
    );
  const sp = await searchParams;
  const filter = (Object.keys(CASE_STATUS) as SupportReport["status"][]).find((k) => k === sp.status);
  const statuses: SupportReport["status"][] = filter ? [filter] : ["open", "in_review"];
  const before = parseCursor(sp.before);
  // One page of this tab, newest first, with the reporters' names; the tab counts are counted, not loaded.
  await (await needs(s)).supportCases(statuses, before, PAGE);
  const counts = await repo.supportStatusCounts();
  const { items: reports, next } = paginate(
    repo.listSupportReports().filter((r) => statuses.includes(r.status)),
    (r) => r.createdAt,
    PAGE,
    before,
  );
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1200px] space-y-6 px-4 pt-8 pb-24 sm:px-6">
        <PageTitle
          title="Support reports"
          note={`Reports from customers and mechanics in the ${repo.scope === "demo" ? "demo (fictional)" : "real"} marketplace. Replies and status changes show on the reporter's Help page. ${emailAlertsOn() ? "Reporters also get an email alert that there's an update." : "Nothing is emailed or texted."}`}
        />
        <nav aria-label="Admin" className="flex flex-wrap gap-4 text-[0.9375rem]">
          <Link href="/admin" className="link">
            Verification review
          </Link>
          <span className="font-semibold" aria-current="page">
            Support reports
          </span>
          <Link href="/admin/demand" className="link">
            Unmatched demand
          </Link>
          <Link href="/admin/delivery" className="link">
            Alert delivery
          </Link>
        </nav>
        <div className="flex flex-wrap gap-2 text-[0.8125rem]">
          <Link href="/admin/support" className={`min-h-9 content-center border px-2.5 ${!filter ? "border-brand bg-brand text-on-brand" : "border-rule bg-sheet"}`}>
            Needs attention ({(counts.open ?? 0) + (counts.in_review ?? 0)})
          </Link>
          {(Object.keys(CASE_STATUS) as SupportReport["status"][]).map((k) => (
            <Link key={k} href={`/admin/support?status=${k}`} className={`min-h-9 content-center border px-2.5 ${filter === k ? "border-brand bg-brand text-on-brand" : "border-rule bg-sheet"}`}>
              {CASE_STATUS[k]} ({counts[k] ?? 0})
            </Link>
          ))}
        </div>
        <ul className="border-t border-rule">
          {reports.map((r) => {
            const u = repo.getUser(r.userId);
            const job = r.jobId ? repo.getJob(r.jobId) : undefined;
            const last = r.messages?.at(-1);
            return (
              <li key={r.id} className="border-b border-rule-soft">
                <Link href={`/admin/support/${r.id}`} className="grid gap-2 py-4 hover:bg-sheet sm:grid-cols-[12rem_minmax(0,1fr)_8rem] sm:px-2">
                  <div>
                    <p className="font-semibold">{u?.name ?? "Unknown account"}</p>
                    <p className="text-[0.8125rem] text-ink-3">
                      {r.reporterRole === "mechanic" ? "Mechanic" : "Customer"} · {dayMonth(r.createdAt)} · {r.id.toUpperCase()}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold">{TOPICS.find(([k]) => k === r.topic)?.[1]}</p>
                    <p className="line-clamp-2 text-[0.9375rem] text-ink-2">{r.details}</p>
                    <p className="mt-1 text-[0.8125rem] text-ink-3">
                      {job ? `Job: ${job.title} · ${job.status.replace("_", " ")}` : "Not about a specific job"}
                      {r.messages?.length ? ` · ${plural(r.messages.length, "message")}${last?.from === "reporter" ? ", reporter wrote last" : ""}` : ""}
                    </p>
                  </div>
                  <p className="text-[0.75rem] font-bold uppercase">{CASE_STATUS[r.status]}</p>
                </Link>
              </li>
            );
          })}
          {!reports.length && <li className="py-6 text-ink-3">{filter ? `No ${CASE_STATUS[filter].toLowerCase()} reports.` : "Nothing needs attention."}</li>}
        </ul>
        <Pager href={`/admin/support${filter ? `?status=${filter}` : ""}`} next={next} paged={Boolean(before)} />
      </main>
    </>
  );
}
