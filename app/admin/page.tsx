import type { Metadata } from "next";
import Link from "next/link";
import { ready, repo } from "@/lib/data";
import { getSession, isStaff } from "@/lib/session";
import { CATEGORY_LABEL, METHOD_LABEL } from "@/lib/domain/provenance";
import type { VerificationCategory, VerificationStatus } from "@/lib/domain/types";
import { effectiveStatus } from "@/lib/verification/lifecycle";
import { dayMonth, plural, WORK_MODEL_LABEL } from "@/lib/format";
import { ArrowRight, Check, Clock, Hourglass, MessageCircleQuestion, X } from "lucide-react";
import { screeningItems } from "@/lib/domain/eligibility";
import { today } from "@/lib/verification/lifecycle";
import { PhotoPrint } from "@/components/profile/photo";
import { SafetyChips, VerdictChip } from "@/components/admin/verdict";
import { SiteHeader } from "@/components/site/site-header";
import { NeedsPersona, PageTitle } from "@/components/workspace/ui";

export const metadata: Metadata = { title: "Verification review" };

const FILTERS: { key: string; label: string; statuses: VerificationStatus[] }[] = [
  { key: "queue", label: "Needs review", statuses: ["pending"] },
  { key: "waiting", label: "Waiting on mechanic", statuses: ["needs_info"] },
  { key: "expiring", label: "Expiring / expired", statuses: ["verified", "expired", "reverification_required"] },
  { key: "done", label: "Decided", statuses: ["verified", "rejected"] },
];

export default async function AdminQueue({ searchParams }: { searchParams: Promise<{ f?: string; cat?: string; done?: string }> }) {
  await ready();
  const s = await getSession();
  if (!isStaff(s))
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
  const now = today();
  const waited = (d?: string) => (d ? Math.max(0, Math.round((new Date(now).getTime() - new Date(d.slice(0, 10)).getTime()) / 86_400_000)) : 0);
  const weekAgo = new Date(new Date(now).getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const approvedThisWeek = repo.listVerifications().filter((v) => v.status === "verified" && (v.verifiedAt ?? "") >= weekAgo && v.method !== "platform_job").length;

  // One card per mechanic, longest-waiting first.
  const groups = [...new Set(rows.map((r) => r.v.mechanicId))]
    .map((mid) => {
      const items = rows.filter((r) => r.v.mechanicId === mid).sort((a, b) => (a.v.submittedAt ?? "").localeCompare(b.v.submittedAt ?? ""));
      const m = repo.getMechanic(mid);
      const pub = m ? repo.getPublicProfile(m.slug) : null;
      return { mid, m, pub, items, oldest: items[0]?.v.submittedAt ?? "" };
    })
    .sort((a, b) => a.oldest.localeCompare(b.oldest));

  const tiles = [
    { key: "queue", n: counts.queue, label: "to review", cls: counts.queue ? "border-amber bg-amber-wash text-amber" : "border-rule bg-sheet text-ink-3", icon: Hourglass },
    { key: "waiting", n: counts.waiting, label: "waiting on mechanic", cls: "border-brand-tint bg-brand-wash text-brand-deep", icon: MessageCircleQuestion },
    { key: "expiring", n: counts.expiring, label: "expiring or expired", cls: counts.expiring ? "border-alert bg-alert-wash text-alert" : "border-rule bg-sheet text-ink-3", icon: Clock },
    { key: "done", n: approvedThisWeek, label: "approved this week", cls: "border-go bg-go-wash text-go", icon: Check },
  ];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1200px] space-y-6 px-4 pt-8 pb-24 sm:px-6">
        <PageTitle
          title="Verification review"
          action={
            <Link href="/admin/support" className="btn btn-quiet min-h-11">
              Support reports ({repo.listSupportReports().filter((r) => r.status !== "resolved").length} open)
            </Link>
          }
        />

        {sp.done ? (
          <p role="status" className={`flex items-center gap-2 border-2 px-4 py-3 font-bold ${sp.done === "rejected" ? "border-alert bg-alert-wash text-alert" : sp.done === "verified" ? "border-go bg-go-wash text-go" : "border-brand-tint bg-brand-wash text-brand-deep"}`}>
            {sp.done === "rejected" ? <X size={20} strokeWidth={3} aria-hidden /> : <Check size={20} strokeWidth={3} aria-hidden />}
            {sp.done === "rejected" ? "Rejected." : sp.done === "verified" ? "Approved." : "Sent back to the mechanic."} That was the last item waiting.
          </p>
        ) : null}
        {/* The queue at a glance; each tile opens its list. */}
        <nav aria-label="Queues" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((t) => (
            <Link
              key={t.key}
              href={`/admin?f=${t.key}`}
              aria-current={filter.key === t.key ? "page" : undefined}
              className={`flex items-center gap-3 border-2 p-4 transition-shadow ${t.cls} ${filter.key === t.key ? "shadow-[inset_0_0_0_2px_currentColor]" : "hover:brightness-95"}`}
            >
              <t.icon size={26} strokeWidth={2.25} aria-hidden />
              <span>
                <span className="num block text-[2rem] leading-none">{t.n}</span>
                <span className="text-[0.875rem] font-semibold">{t.label}</span>
              </span>
            </Link>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
          <span className="font-semibold text-ink-2">Show:</span>
          <Link href={`/admin?f=${filter.key}`} className={`min-h-9 content-center border px-2.5 ${!sp.cat ? "border-brand bg-brand text-on-brand" : "border-rule bg-sheet text-ink-2 hover:border-ink-3"}`}>
            All
          </Link>
          {cats.map((c) => (
            <Link key={c} href={`/admin?f=${filter.key}&cat=${c}`} className={`min-h-9 content-center border px-2.5 ${sp.cat === c ? "border-brand bg-brand text-on-brand" : "border-rule bg-sheet text-ink-2 hover:border-ink-3"}`}>
              {CATEGORY_LABEL[c]}
            </Link>
          ))}
        </div>

        <h2 className="heading text-[1.25rem]">
          {filter.label} · {plural(rows.length, "item")} from {plural(groups.length, "mechanic")}
        </h2>

        {groups.length ? (
          <ul className="space-y-5">
            {groups.map(({ mid, m, pub, items }) => (
              <li key={mid} className="border-2 border-rule bg-sheet">
                {/* The person */}
                <div className="flex flex-wrap items-center gap-4 border-b border-rule bg-paper px-4 py-3 sm:px-5">
                  {pub ? <PhotoPrint photoUrl={pub.photoUrl} initials={pub.initials} name={pub.displayName} size={52} /> : null}
                  <div className="min-w-0 flex-1">
                    <p className="heading text-[1.25rem]">{m?.displayName ?? "Unknown mechanic"}</p>
                    <p className="text-[0.8125rem] text-ink-2">
                      {pub ? `${pub.neighborhood ?? pub.city} · ${WORK_MODEL_LABEL[pub.workModel]} · ` : ""}
                      {plural(items.length, "item")} here
                    </p>
                  </div>
                  {pub ? (
                    <div className="w-full sm:w-auto">
                      <SafetyChips items={screeningItems(pub)} />
                    </div>
                  ) : null}
                </div>
                {/* Their items */}
                <ul className="divide-y divide-rule-soft">
                  {items.map(({ v, status }) => {
                    const days = waited(v.submittedAt);
                    const late = status === "pending" && days > 3;
                    return (
                      <li key={v.id} className={`grid gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5 ${late ? "border-l-4 border-l-alert" : ""}`}>
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-bold">{CATEGORY_LABEL[v.category]}</span>
                            <VerdictChip status={status} />
                            {late ? <span className="text-[0.8125rem] font-bold text-alert">Waiting {days} days</span> : null}
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-[0.9375rem] text-ink-2">{v.evidenceSummary ?? "No summary"}</p>
                          <p className="mt-0.5 text-[0.8125rem] text-ink-3">
                            {METHOD_LABEL[v.method]} · submitted {dayMonth(v.submittedAt)}
                            {!late && status === "pending" ? ` · ${days === 0 ? "today" : `${plural(days, "day")} ago`}` : ""}
                          </p>
                        </div>
                        <Link href={`/admin/reviews/${v.id}`} className={`btn min-h-11 ${status === "pending" ? "btn-ink" : "btn-line"}`}>
                          {status === "pending" ? "Review" : "Open"} <ArrowRight size={15} aria-hidden />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 border-2 border-go bg-go-wash px-4 py-5 font-semibold text-go">
            <Check size={20} strokeWidth={3} aria-hidden /> Nothing here. The queue is clear.
          </p>
        )}
      </main>
    </>
  );
}
