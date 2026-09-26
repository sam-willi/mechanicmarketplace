import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ready, repo } from "@/lib/data";
import { getSession } from "@/lib/session";
import { primarySymptom, vehicleLine } from "@/lib/domain/intake";
import { customerRepairStatus } from "@/lib/domain/status";
import { dayMonth, plural } from "@/lib/format";
import { StatusChip } from "@/components/app/status-chip";

export const metadata: Metadata = { title: "Requests" };

export default async function CustomerRequests() {
  await ready();
  const s = await getSession();
  if (s.role !== "customer") return null;
  const requests = repo.listRequestsForCustomer(s.customerId);
  const draft = repo.getDraft(s.customerId);
  const active = requests.filter((r) => r.status === "open" || r.status === "quoted");
  const past = requests.filter((r) => !active.includes(r));

  const Row = ({ r }: { r: (typeof requests)[number] }) => {
    const v = repo.getVehicle(r.vehicleId)!;
    const quotes = repo.listQuotesForRequest(r.id).filter((q) => q.status !== "draft");
    const job = repo.listJobsForCustomer(s.customerId).find((j) => j.requestId === r.id);
    const unanswered = r.questions.filter((q) => !q.response && !q.attachments.length).length;
    const fresh = quotes.filter((q) => q.status === "submitted").length;
    const interestedOnly = r.interested.filter((i) => !quotes.some((q) => q.mechanicId === i.mechanicId)).length;
    return (
      <li className="border-b border-rule-soft">
        <Link href={job ? `/customer/jobs/${job.id}` : `/customer/requests/${r.id}`} className="block py-4 hover:bg-sheet sm:px-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold">{vehicleLine(v)}</p>
              <p className="line-clamp-1 text-[0.9375rem] text-ink-2">{primarySymptom(r)}</p>
            </div>
            <StatusChip label={customerRepairStatus(r, quotes, job)} />
          </div>
          {/* One line: the thing that matters next. */}
          <p className={`mt-2 text-[0.9375rem] ${unanswered || fresh ? "font-bold" : "text-ink-2"}`}>
            {job
              ? `Booked · posted ${dayMonth(r.createdAt)}`
              : unanswered
                ? `${plural(unanswered, "question")} waiting for you`
                : fresh
                  ? `${plural(fresh, "estimate")} to compare`
                  : interestedOnly
                    ? `${plural(interestedOnly, "mechanic")} interested`
                    : r.status === "open" || r.status === "quoted"
                      ? `Waiting for replies · posted ${dayMonth(r.createdAt)}`
                      : `Posted ${dayMonth(r.createdAt)}`}
          </p>
        </Link>
      </li>
    );
  };

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-ink pb-4">
        <div>
          <h1 className="display text-[2rem] sm:text-[2.5rem]">Requests</h1>
        </div>
        <Link href="/customer/requests/new" className="btn btn-ink">
          <Plus size={16} aria-hidden /> New repair request
        </Link>
      </div>
      {draft ? (
        <Link href="/customer/requests/new" className="flex items-center justify-between gap-3 border border-dashed border-ink px-4 py-3 hover:bg-sheet">
          <span>
            <span className="font-semibold">Unfinished request</span>
            {draft.symptomDescription ? <span className="block text-[0.875rem] text-ink-2">&ldquo;{draft.symptomDescription.slice(0, 80)}&rdquo;</span> : null}
          </span>
          <span className="text-[0.875rem] font-semibold underline">Continue</span>
        </Link>
      ) : null}
      <section>
        <h2 className="heading text-[1.25rem]">Active</h2>
        <ul className="mt-3 border-t border-rule">
          {active.map((r) => (
            <Row key={r.id} r={r} />
          ))}
          {active.length === 0 && <li className="border-b border-rule-soft py-5 text-ink-3">No active requests.</li>}
        </ul>
      </section>
      {past.length > 0 && (
        <section>
          <h2 className="heading text-[1.25rem]">Booked and past</h2>
          <ul className="mt-3 border-t border-rule">
            {past.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
