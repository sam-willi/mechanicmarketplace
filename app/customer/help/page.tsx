import type { Metadata } from "next";
import { getRepo } from "@/lib/data";
import { getSession, needs } from "@/lib/session";
import { vehicleLine } from "@/lib/domain/intake";
import { dayMonth } from "@/lib/format";
import { CommonAnswers, ContactSupport, Protections } from "@/components/help/help-content";
import { ReportForm } from "@/components/help/report-form";
import { SupportReports } from "@/components/help/support-reports";

export const metadata: Metadata = { title: "Help" };

export default async function CustomerHelp({ searchParams }: { searchParams: Promise<{ job?: string; request?: string; sent?: string }> }) {
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "customer") return null;
  await (await needs(s)).customerHelp();
  const sp = await searchParams;
  const jobs = repo.listJobsForCustomer(s.customerId).map((j) => ({
    id: j.id,
    label: `${j.title} · ${vehicleLine(repo.getVehicle(j.vehicleId)!)} · ${repo.getMechanic(j.mechanicId)?.displayName}`,
  }));
  const mine = repo.listSupportReports({ userId: s.userId });
  return (
    <div className="mx-auto max-w-[920px] space-y-12">
      <div>
        <h1 className="display text-[2rem] sm:text-[2.75rem]">Help</h1>
        <p className="mt-2 max-w-[62ch] text-ink-2">Report a problem with a repair, or read how Clutch protects you.</p>
      </div>
      {sp.sent ? (
        <p className="border-2 border-ink bg-sheet px-4 py-3 text-[0.9375rem]" role="status">
          Report saved. Clutch staff review reports in the order they arrive, and its status shows on this page. Reference {sp.sent.toUpperCase()}.
        </p>
      ) : null}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <ReportForm jobs={jobs} jobId={sp.job} requestId={sp.request} />
        <div className="space-y-6">
          <ContactSupport />
          <SupportReports reports={mine} label={(r) => (r.jobId ? jobs.find((j) => j.id === r.jobId)?.label : undefined) ?? `Sent ${dayMonth(r.createdAt)}`} />
        </div>
      </div>
      <Protections />
      <CommonAnswers area="customer" />
    </div>
  );
}
