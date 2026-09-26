import type { Metadata } from "next";
import { ready, repo } from "@/lib/data";
import { getSession } from "@/lib/session";
import { vehicleLine } from "@/lib/domain/intake";
import { dayMonth } from "@/lib/format";
import { CommonAnswers, ContactSupport } from "@/components/help/help-content";
import { ReportForm } from "@/components/help/report-form";
import { SupportReports } from "@/components/help/support-reports";

export const metadata: Metadata = { title: "Help" };

export default async function MechanicHelp({ searchParams }: { searchParams: Promise<{ job?: string; sent?: string }> }) {
  await ready();
  const s = await getSession();
  if (s.role !== "mechanic") return null;
  const sp = await searchParams;
  const jobs = repo.listJobsForMechanic(s.mechanicId).map((j) => ({
    id: j.id,
    label: `${j.title} · ${vehicleLine(repo.getVehicle(j.vehicleId)!)}`,
  }));
  const mine = repo.listSupportReports().filter((r) => r.userId === s.userId);
  return (
    <div className="max-w-[920px] space-y-10">
      <div>
        <h1 className="display text-[2rem] sm:text-[2.5rem]">Help</h1>
        <p className="mt-2 max-w-[62ch] text-ink-2">Report a problem with a job or a customer, or get help with verification.</p>
      </div>
      {sp.sent ? (
        <p className="border-2 border-ink bg-sheet px-4 py-3 text-[0.9375rem]" role="status">
          Report sent. The trust team will reply by email, usually within one business day. Reference {sp.sent.toUpperCase()}.
        </p>
      ) : null}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <ReportForm jobs={jobs} jobId={sp.job} />
        <div className="space-y-6">
          <ContactSupport />
          <SupportReports reports={mine} label={(r) => (r.jobId ? jobs.find((j) => j.id === r.jobId)?.label : undefined) ?? `Sent ${dayMonth(r.createdAt)}`} />
        </div>
      </div>
      <CommonAnswers area="mechanic" />
    </div>
  );
}
