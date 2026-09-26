import type { Metadata } from "next";
import Link from "next/link";
import { ready, repo } from "@/lib/data";
import { getSession } from "@/lib/session";
import { CATEGORY_LABEL, METHOD_LABEL } from "@/lib/domain/provenance";
import type { VerificationCategory, VerificationStatus } from "@/lib/domain/types";
import { effectiveStatus } from "@/lib/verification/lifecycle";
import { dayMonth } from "@/lib/format";
import { SiteHeader } from "@/components/site/site-header";
import { NeedsPersona, PageTitle, StatusPill } from "@/components/workspace/ui";

export const metadata: Metadata = { title: "Verification review" };

const FILTERS: { key: string; label: string; statuses: VerificationStatus[] }[] = [
  { key: "queue", label: "Needs review", statuses: ["pending"] },
  { key: "waiting", label: "Waiting on mechanic", statuses: ["needs_info"] },
  { key: "expiring", label: "Expiring / expired", statuses: ["verified", "expired", "reverification_required"] },
  { key: "done", label: "Decided", statuses: ["verified", "rejected"] },
];

export default async function AdminQueue({ searchParams }: { searchParams: Promise<{ f?: string; cat?: string }> }) {
  await ready();
  const s = await getSession();
  if (s.role !== "admin")
    return (
      <>
        <SiteHeader />
        <NeedsPersona role="admin" />
      </>
    );
  const sp = await searchParams;
  const filter = FILTERS.find((f) => f.key === sp.f) ?? FILTERS[0];
  let rows = repo
    .listVerifications()
    .map((v) => ({ v, status: effectiveStatus(v.status, v.expiresAt) }))
    .filter(({ v, status }) => {
      if (filter.key === "expiring") return status === "expired" || status === "reverification_required";
      if (filter.key === "done") return (status === "verified" || status === "rejected") && v.method !== "platform_job" && v.method !== "customer_confirmation";
      return filter.statuses.includes(status);
    });
  if (sp.cat) rows = rows.filter(({ v }) => v.category === sp.cat);
  const counts = Object.fromEntries(
    FILTERS.map((f) => [
      f.key,
      repo
        .listVerifications()
        .map((v) => ({ v, status: effectiveStatus(v.status, v.expiresAt) }))
        .filter(({ v, status }) =>
          f.key === "expiring"
            ? status === "expired" || status === "reverification_required"
            : f.key === "done"
              ? (status === "verified" || status === "rejected") && v.method !== "platform_job" && v.method !== "customer_confirmation"
              : f.statuses.includes(status),
        ).length,
    ]),
  );
  const cats: VerificationCategory[] = ["identity", "background", "driving_record", "insurance", "credential", "employment", "past_repair"];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1200px] space-y-6 px-4 pt-8 pb-24 sm:px-6">
        <PageTitle title="Verification review" note="Every decision is logged with method, reviewer, time and expiry." />
        <p className="text-[0.9375rem]">
          <Link href="/admin/support" className="link">Support reports ({repo.listSupportReports().filter((r) => r.status !== "resolved").length} open)</Link>
        </p>
        <nav aria-label="Queues" className="flex flex-wrap gap-1 border-b border-rule">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`/admin?f=${f.key}`}
              aria-current={filter.key === f.key ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-[0.9375rem] ${filter.key === f.key ? "border-ink font-semibold text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
            >
              {f.label} <span className="tnum text-ink-3">{counts[f.key]}</span>
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap gap-2 text-[0.8125rem]">
          <Link href={`/admin?f=${filter.key}`} className={`border px-2 py-1 ${!sp.cat ? "border-ink text-ink" : "border-rule text-ink-2"}`}>
            All
          </Link>
          {cats.map((c) => (
            <Link key={c} href={`/admin?f=${filter.key}&cat=${c}`} className={`border px-2 py-1 ${sp.cat === c ? "border-ink text-ink" : "border-rule text-ink-2"}`}>
              {CATEGORY_LABEL[c]}
            </Link>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-[0.9375rem]">
            <thead>
              <tr className="border-b border-ink">
                {["Mechanic", "Category", "Evidence", "Method", "Submitted", "Status"].map((h) => (
                  <th key={h} className="field-label py-2 pr-4 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ v, status }) => {
                const m = repo.getMechanic(v.mechanicId);
                return (
                  <tr key={v.id} className="border-b border-rule-soft hover:bg-sheet">
                    <td className="py-3 pr-4 font-semibold">
                      <Link href={`/admin/reviews/${v.id}`} className="hover:underline">
                        {m?.displayName}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 text-ink-2">{CATEGORY_LABEL[v.category]}</td>
                    <td className="max-w-[22rem] py-3 pr-4 text-ink-2">
                      <Link href={`/admin/reviews/${v.id}`} className="line-clamp-2 hover:text-ink">
                        {v.evidenceSummary ?? "—"}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 text-ink-2">{METHOD_LABEL[v.method]}</td>
                    <td className="tnum py-3 pr-4 text-ink-2">{dayMonth(v.submittedAt)}</td>
                    <td className="py-3">
                      <StatusPill status={status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="py-8 text-ink-3">Nothing here. The queue is clear.</p>}
        </div>
      </main>
    </>
  );
}
