import type { Metadata } from "next";
import Link from "next/link";
import { getRepo } from "@/lib/data";
import { getSession, needs } from "@/lib/session";
import { vehicleLine } from "@/lib/domain/intake";
import { jobValueCents } from "@/lib/domain/status";
import { repairChip } from "@/lib/domain/journey";
import { findArea } from "@/lib/domain/areas";
import { dayMonth, usd } from "@/lib/format";
import { PageTitle } from "@/components/workspace/ui";
import { StatusChip } from "@/components/app/status-chip";
import { calendarStatus, JobCalendar, type CalendarItem } from "@/components/mechanic/job-calendar";
import { jobSlot, parseTime } from "@/lib/domain/schedule";
import { today } from "@/lib/verification/lifecycle";

export const metadata: Metadata = { title: "Jobs" };

/** Grouped by the shared stages (lib/domain/journey.ts), soonest action first. */
const GROUPS = ["In progress", "Mechanic selected", "Scheduled", "Completed", "Cancelled"] as const;

export default async function MyJobs({ searchParams }: { searchParams: Promise<{ view?: string; d?: string }> }) {
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "mechanic") return null;
  await (await needs(s)).mechanicJobs();
  const sp = await searchParams;
  const jobs = repo.listJobsForMechanic(s.mechanicId);
  // A booked job carries its own stage; the request is only consulted before booking.
  const chipFor = (j: (typeof jobs)[number]) => repairChip(repo.getRequest(j.requestId) ?? { status: "booked", declinedBy: [], matchedMechanicIds: [] } as never, [], j, "mechanic", s.mechanicId);
  const now = today();
  const view = sp.view === "month" ? "month" : "week";
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(sp.d ?? "") ? sp.d! : now;
  const items: CalendarItem[] = jobs.flatMap((j) => {
    const status = calendarStatus(j);
    const slot = jobSlot(j, repo.getQuote(j.quoteId), now);
    if (!status || !slot) return [];
    const v = repo.getVehicle(j.vehicleId)!;
    return [
      {
        id: j.id,
        href: `/mechanic/jobs/${j.id}`,
        slot,
        title: `${v.year} ${v.make} ${v.model}`,
        sub: `${j.title} · ${repo.getCustomer(j.customerId)?.displayName ?? ""}`,
        status,
      },
    ];
  });
  const openings = (repo.getPublicProfile(s.slug)?.openings ?? []).map((o) => ({ date: o.on, time: parseTime(o.time) ?? "09:00" }));

  return (
    <div className="space-y-8">
      <PageTitle title="Jobs" />
      {jobs.length === 0 ? (
        <p className="border-y border-rule py-6 text-ink-2">
          No jobs yet. When a customer approves one of your estimates, the job and its calendar slot appear here.
        </p>
      ) : (
        <JobCalendar items={items} openings={openings} view={view} anchor={anchor} today={now} basePath="/mechanic/jobs" />
      )}
      {jobs.length ? <h2 className="heading border-t-2 border-ink pt-3 text-[1.375rem]">All jobs</h2> : null}
      {jobs.length === 0
        ? null
        : GROUPS.map((g) => {
            const list = jobs.filter((j) => chipFor(j).label === g);
            if (!list.length && g !== "Scheduled" && g !== "Completed") return null;
            return (
              <section key={g} className="space-y-3">
                <h2 className="heading text-[1.0625rem]">
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
                        <Link
                          href={`/mechanic/jobs/${j.id}`}
                          className="grid gap-1 py-3.5 hover:bg-sheet sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6 sm:px-2"
                        >
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
                            <StatusChip {...chipFor(j)} />
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
