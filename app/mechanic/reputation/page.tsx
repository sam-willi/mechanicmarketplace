import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ready, repo } from "@/lib/data";
import { getSession } from "@/lib/session";
import { toPublicProfile } from "@/lib/domain/public-profile";
import { milestones } from "@/lib/mechanic-insights";
import { PageTitle } from "@/components/workspace/ui";
import { EvidenceProvider } from "@/components/trust/evidence-sheet";
import { MakeLedger, RecentWork, RepairLedger } from "@/components/profile/sections";
import { RepairIcon } from "@/components/visual/icons";
import { WorkGallery } from "@/components/visual/gallery";
import { REPAIR_LABEL } from "@/lib/domain/provenance";
import { daysAgo } from "@/lib/domain/availability";
import type { RepairCategory } from "@/lib/domain/types";

export const metadata: Metadata = { title: "Reputation" };

export default async function Reputation() {
  await ready();
  const s = await getSession();
  if (s.role !== "mechanic") return null;
  const p = toPublicProfile(repo.getMechanicSources(s.mechanicId));
  const a = await repo.analyticsSummary(s.mechanicId);
  const r = p.reputation;
  const monthAgo = daysAgo(30);
  const recent = p.verifiedWork.filter((w) => w.performedOn >= monthAgo);
  const byCat = Object.entries(
    recent.reduce<Record<string, number>>((acc, w) => ({ ...acc, [w.category]: (acc[w.category] ?? 0) + 1 }), {}),
  ).sort((x, y) => y[1] - x[1]);
  const byMake = Object.entries(recent.reduce<Record<string, number>>((acc, w) => ({ ...acc, [w.make]: (acc[w.make] ?? 0) + 1 }), {})).sort((x, y) => y[1] - x[1]);
  const newReviews = p.reviews.verified.filter((x) => x.createdAt.slice(0, 10) >= monthAgo).length;
  const stats: [string, string | number, string?][] = [
    ["Verified jobs", r.verifiedRepairs, `${r.platformRepairs} on Clutch · ${r.verifiedRepairs - r.platformRepairs} from before`],
    ["Verified rating", r.rating ? r.rating.average.toFixed(1) : "—", r.rating ? `${r.rating.count} verified reviews` : "after your first Clutch job"],
    ["Repeat customers", r.repeatCustomers, `of ${r.totalCustomers} customers`],
    ["Profile views", a.profile_view],
    ["Profile shares", a.profile_share],
  ];

  return (
    <EvidenceProvider mechanicId={p.id}>
      <div className="space-y-10">
        <PageTitle
          title="Reputation"
          note="Your verified record, by repair and by make."
          action={
            <Link href={`/mechanics/${p.slug}`} className="btn btn-line min-h-11 text-sm">
              See it as customers do <ArrowRight size={15} aria-hidden />
            </Link>
          }
        />
        <dl className="grid grid-cols-2 border border-rule bg-sheet sm:grid-cols-5">
          {stats.map(([k, v, note]) => (
            <div key={k} className="border-r border-b border-rule-soft p-4 sm:border-b-0 sm:last:border-r-0">
              <dt className="field-label">{k}</dt>
              <dd className="num mt-2 text-[2rem]">{v}</dd>
              {note ? <p className="mt-1 text-[0.75rem] text-ink-3">{note}</p> : null}
            </div>
          ))}
        </dl>

        <section aria-labelledby="growth-title" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div>
            <h2 id="growth-title" className="heading text-[1.25rem]">Last 30 days</h2>
            <p className="mt-2">
              <span className="num text-[2.75rem]">+{recent.length}</span>
              <span className="ml-2 text-ink-2">verified {recent.length === 1 ? "repair" : "repairs"}</span>
            </p>
            {newReviews ? <p className="text-[0.9375rem] text-ink-2">+{newReviews} verified {newReviews === 1 ? "review" : "reviews"}</p> : null}
            {byCat.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {byCat.map(([c, n]) => (
                  <li key={c} className="inline-flex items-center gap-1.5 border border-rule bg-sheet px-2 py-1 text-[0.8125rem] font-semibold">
                    <RepairIcon category={c as RepairCategory} size={14} /> +{n} {REPAIR_LABEL[c as RepairCategory]}
                  </li>
                ))}
                {byMake.map(([m, n]) => (
                  <li key={m} className="border border-rule-soft px-2 py-1 text-[0.8125rem] text-ink-2">
                    +{n} {m}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[0.8125rem] text-ink-3">Each one makes you a stronger match for the next {byCat[0] ? REPAIR_LABEL[byCat[0][0] as RepairCategory].toLowerCase() : ""} request nearby.</p>
          </div>
          <div>
            <p className="font-semibold">Recent work customers see</p>
            <div className="mt-2">
              <WorkGallery repairs={p.verifiedWork} limit={3} />
            </div>
            <Link href="/mechanic/repairs" className="link mt-2 inline-block text-[0.875rem]">
              Add photos to your repair records
            </Link>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="heading text-[1.25rem]">Next milestones</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {milestones(p).map((ms) => (
              <li key={ms.label} className="sheet p-4">
                <p className="flex items-baseline justify-between">
                  <span className="font-semibold">{ms.label}</span>
                  <span className="num text-[1.5rem]">{ms.count}</span>
                </p>
                <div className="mt-2 h-1.5 bg-rule-soft">
                  <div className="h-full bg-brand" style={{ width: `${Math.min(100, (ms.count / ms.target) * 100)}%` }} />
                </div>
                <p className="mt-1.5 text-[0.8125rem] text-ink-2">
                  {ms.target - ms.count} more to reach {ms.target} verified
                </p>
              </li>
            ))}
          </ul>
        </section>

        <div className="grid gap-12 xl:grid-cols-2">
          <RepairLedger p={p} />
          <div className="space-y-12">
            <MakeLedger p={p} />
            <div className="sheet p-4">
              <p className="font-semibold">Add proof of work from before Clutch</p>
              <p className="mt-1 text-[0.9375rem] text-ink-2">
                List earlier repairs and ask those customers to confirm. Confirmed jobs count toward your record as confirmed by a past customer.
              </p>
              <Link href="/mechanic/repairs" className="btn btn-line mt-3 min-h-11 text-sm">
                Manage repair record
              </Link>
            </div>
          </div>
        </div>
        <RecentWork p={p} />
      </div>
    </EvidenceProvider>
  );
}
