import type { Metadata } from "next";
import Link from "next/link";
import { ready, repo } from "@/lib/data";
import { getSession } from "@/lib/session";
import { vehicleLine } from "@/lib/domain/intake";
import { jobValueCents, mechanicJobStatus, type MechanicJobStatus } from "@/lib/domain/status";
import { findArea } from "@/lib/domain/areas";
import { dayMonth, usd } from "@/lib/format";
import { PageTitle } from "@/components/workspace/ui";
import { StatusChip } from "@/components/app/status-chip";
import { calendarStatus, JobCalendar, type CalendarItem } from "@/components/mechanic/job-calendar";
import { jobSlot, parseTime } from "@/lib/domain/schedule";
import { today } from "@/lib/verification/lifecycle";

export const metadata: Metadata = { title: "Jobs" };

const GROUPS: MechanicJobStatus[] = ["In Progress", "Upcoming", "Awaiting Customer", "Completed", "Cancelled"];

export default async function MyJobs({ searchParams }: { searchParams: Promise<{ view?: string; d?: string }> }) {
  await ready();
  const s = await getSession();
  if (s.role !== "mechanic") return null;
  const sp = await searchParams;
  const jobs = repo.listJobsForMechanic(s.mechanicId);
  const now = today();
  const view = sp.view === "month" ? "month" : "week";
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(sp.d ?? "") ? sp.d! : now;
  const items: CalendarItem[] = jobs.flatMap((j) => {
    const status = calendarStatus(j);
    const slot = jobSlot(j, repo.getQuote(j.quoteId), now);
    if (!status || !slot) return [];
    const v = repo.getVehicle(j.vehicleId)!;
    return [{ id: j.id, href: `/mechanic/jobs/${j.id}`, slot, title: `${v.year} ${v.make} ${v.model}`, sub: `${j.title} · ${repo.getCustomer(j.customerId)?.displayName ?? ""}`, status }];
  });
  const openings = (repo.getPublicProfile(s.slug)?.openings ?? []).map((o) => ({ date: o.on, time: parseTime(o.time) ?? "09:00" }));

  return (
    <div className="space-y-8">
      <PageTitle title="Jobs" />
      <JobCalendar items={items} openings={openings} view={view} anchor={anchor} today={now} basePath="/mechanic/jobs" />
      <h2 className="heading border-t-2 border-ink pt-3 text-[1.375rem]">All jobs</h2>
      {GROUPS.map((g) => {
        const list = jobs.filter((j) => mechanicJobStatus(j) === g);
        if (!list.length && (g === "Cancelled" || g === "Awaiting Customer" || g === "In Progress")) return null;
        return (
          <section key={g} className="space-y-3">
            <h2 className="heading text-[1.125rem]">
              {g} <span className="tnum text-ink-3">{list.length}</span>
            </h2>
            <ul className="border-t border-rule">
              {list.map((j) => {
                const v = repo.getVehicle(j.vehicleId)!;
                const c = repo.getCustomer(j.customerId);
                const r = repo.getRequest(j.requestId);
                const q = repo.getQuote(j.quoteId);
                return (
                  <li key={j.id} className="border-b border-rule-soft">
                    <Link href={`/mechanic/jobs/${j.id}`} className="grid gap-1 py-3.5 hover:bg-sheet sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6 sm:px-2">
                      <div className="min-w-0">
                        <p className="font-semibold">
                          {j.status === "completed" ? dayMonth(j.completedAt) : j.scheduledFor} · {vehicleLine(v)}
                        </p>
                        <p className="text-[0.875rem] text-ink-2">
                          {j.title} · {c?.displayName} · {r ? findArea(r.location.area)?.label : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="tnum text-[0.9375rem] font-semibold">{usd(jobValueCents(j, q))}</span>
                        <StatusChip label={g} />
                      </div>
                    </Link>
                  </li>
                );
              })}
              {list.length === 0 && <li className="border-b border-rule-soft py-4 text-ink-3">None.</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
