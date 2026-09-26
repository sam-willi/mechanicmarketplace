import type { Metadata } from "next";
import Link from "next/link";
import { ready, repo } from "@/lib/data";
import { getSession } from "@/lib/session";
import { primarySymptom, vehicleLine } from "@/lib/domain/intake";
import { customerRepairStatus } from "@/lib/domain/status";
import { dayMonth, monthYear, usd } from "@/lib/format";
import { StatusChip } from "@/components/app/status-chip";
import { PhotoPrint } from "@/components/profile/photo";

export const metadata: Metadata = { title: "My Repairs" };

const ORDER = ["Confirm Completion", "In Progress", "Scheduled", "Mechanic Selected", "Responses In", "Requested", "Completed", "Cancelled"];

export default async function MyRepairs() {
  await ready();
  const s = await getSession();
  if (s.role !== "customer") return null;
  const jobs = repo.listJobsForCustomer(s.customerId);
  const requests = repo.listRequestsForCustomer(s.customerId);
  const rows = requests
    .map((r) => {
      const job = jobs.find((j) => j.requestId === r.id);
      const quotes = repo.listQuotesForRequest(r.id).filter((q) => q.status !== "draft");
      return { r, job, status: customerRepairStatus(r, quotes, job), v: repo.getVehicle(r.vehicleId)! };
    })
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  // Earlier Clutch repairs (before this demo's requests) from the verified record.
  const jobRepairIds = new Set(jobs.map((j) => j.id));
  const history = repo.listCustomerHistory(s.customerId).filter((h) => !h.jobId || !jobRepairIds.has(h.jobId));

  return (
    <div className="space-y-10">
      <div className="border-b-2 border-ink pb-4">
        <h1 className="display text-[2rem] sm:text-[2.5rem]">My Repairs</h1>
        <p className="mt-1 text-ink-2">Every repair, from request to completed, with the paperwork kept together.</p>
      </div>
      <ul className="grid gap-3">
        {rows.map(({ r, job, status, v }) => {
          const m = job ? repo.getPublicProfile(repo.getMechanic(job.mechanicId)!.slug)! : null;
          const q = job ? repo.getQuote(job.quoteId) : undefined;
          return (
            <li key={r.id}>
              <Link href={job ? `/customer/jobs/${job.id}` : `/customer/requests/${r.id}`} className="sheet flex gap-4 p-4 hover:border-ink sm:p-5">
                {m ? <PhotoPrint photoUrl={m.photoUrl} initials={m.initials} name={m.displayName} size={48} /> : null}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-semibold">{job ? job.title : primarySymptom(r)}</p>
                    <StatusChip label={status} />
                  </div>
                  <p className="text-[0.875rem] text-ink-2">
                    {vehicleLine(v)}
                    {m ? ` · ${m.displayName}` : ""}
                    {job ? ` · ${job.status === "completed" ? dayMonth(job.completedAt) : job.scheduledFor}` : ` · posted ${dayMonth(r.createdAt)}`}
                  </p>
                  {job?.status === "completed" && (job.finalAmountCents || q) ? (
                    <p className="tnum mt-1 text-[0.8125rem] text-ink-3">Final amount {usd(job.finalAmountCents ?? q!.laborCents + q!.diagnosticFeeCents + q!.travelFeeCents)}</p>
                  ) : null}
                  {status === "Confirm Completion" ? <p className="mt-2 text-[0.875rem] font-bold">Please confirm the work is done</p> : null}
                </div>
              </Link>
            </li>
          );
        })}
        {rows.length === 0 && <li className="border-y border-rule py-5 text-ink-3">No repairs yet.</li>}
      </ul>
      {history.length > 0 && (
        <section>
          <h2 className="heading text-[1.25rem]">Earlier Clutch repairs</h2>
          <ul className="mt-3 border-t border-rule">
            {history.map((h) => {
              const m = repo.getMechanic(h.mechanicId)!;
              return (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-rule-soft py-3">
                  <span>
                    <span className="font-semibold">{h.title}</span>
                    <span className="block text-[0.8125rem] text-ink-2">
                      {h.year} {h.make} {h.model} · {m.displayName} · {monthYear(h.performedOn)}
                      {h.valueCents ? ` · ${usd(h.valueCents)}` : ""}
                    </span>
                  </span>
                  <Link href={`/customer/requests/new?rebook=${m.slug}&make=${encodeURIComponent(h.make)}`} className="btn btn-quiet min-h-11 px-3 text-sm">
                    Rebook {m.firstName}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
