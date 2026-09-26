import type { Metadata } from "next";
import Link from "next/link";
import { ready, repo } from "@/lib/data";
import { getSession } from "@/lib/session";
import { dayMonth } from "@/lib/format";
import { SiteHeader } from "@/components/site/site-header";
import { NeedsPersona, PageTitle } from "@/components/workspace/ui";
import { TOPICS } from "@/components/help/help-content";

export const metadata: Metadata = { title: "Support reports" };

export default async function AdminSupport() {
  await ready();
  const s = await getSession();
  if (s.role !== "admin")
    return (
      <>
        <SiteHeader />
        <NeedsPersona role="admin" />
      </>
    );
  const reports = repo.listSupportReports();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1200px] space-y-6 px-4 pt-8 pb-24 sm:px-6">
        <PageTitle title="Support reports" note="Reports from customers and mechanics, with the job attached when it belongs to the reporter." />
        <nav aria-label="Admin" className="flex gap-4 text-[0.9375rem]">
          <Link href="/admin" className="link">Verification review</Link>
          <span className="font-semibold">Support reports</span>
        </nav>
        <ul className="border-t border-rule">
          {reports.map((r) => {
            const u = repo.getUser(r.userId);
            const job = r.jobId ? repo.getJob(r.jobId) : undefined;
            return (
              <li key={r.id} className="grid gap-2 border-b border-rule-soft py-4 sm:grid-cols-[12rem_minmax(0,1fr)_8rem]">
                <div>
                  <p className="font-semibold">{u?.name ?? r.userId}</p>
                  <p className="text-[0.8125rem] text-ink-3">{dayMonth(r.createdAt)} · {r.id.toUpperCase()}</p>
                </div>
                <div className="min-w-0">
                  <p className="font-semibold">{TOPICS.find(([k]) => k === r.topic)?.[1]}</p>
                  <p className="text-[0.9375rem] text-ink-2">{r.details}</p>
                  {job ? <p className="mt-1 text-[0.8125rem] text-ink-3">Job: {job.title} · {repo.getMechanic(job.mechanicId)?.displayName}</p> : null}
                </div>
                <p className="text-[0.75rem] font-bold uppercase">{r.status.replace("_", " ")}</p>
              </li>
            );
          })}
          {!reports.length && <li className="py-6 text-ink-3">No reports.</li>}
        </ul>
      </main>
    </>
  );
}
