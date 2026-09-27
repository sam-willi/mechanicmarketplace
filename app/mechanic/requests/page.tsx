import type { Metadata } from "next";
import { getRepo } from "@/lib/data";
import { getSession, needs } from "@/lib/session";
import { toPublicProfile } from "@/lib/domain/public-profile";
import { repairNoun } from "@/lib/domain/provenance";
import { opportunities } from "@/lib/mechanic-insights";
import { Notice, PageTitle } from "@/components/workspace/ui";
import { RequestCard } from "@/components/request/request-card";
import Link from "next/link";
import { matchReadiness } from "@/lib/matchable";

export const metadata: Metadata = { title: "Repair requests" };

export default async function Opportunities({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "mechanic") return null;
  await (await needs(s)).mechanicRequests();
  const sp = await searchParams;
  const m = repo.getMechanic(s.mechanicId)!;
  const p = toPublicProfile(repo.getMechanicSources(s.mechanicId));
  const opps = opportunities(repo, m, p);
  const ready = matchReadiness(repo, m);

  return (
    <div className="space-y-8">
      <PageTitle
        title="Repair requests"
        note="Ordered by fit: your area, verified experience and timing."
      />
      {sp.sent ? <Notice tone="ok">Estimate sent. The customer sees it next to your verified experience.</Notice> : null}
      {opps.length ? (
        <ul className="grid grid-cols-1 gap-4">
          {opps.map((o) => {
            const v = repo.getVehicle(o.r.vehicleId)!;
            return (
              <li key={o.r.id}>
                <RequestCard
                  r={o.r}
                  v={v}
                  distanceMi={o.distanceMi}
                  state={o.state}
                  isReturning={o.r.rebookOf === m.id || repo.listCustomerHistory(o.r.customerId).some((h) => h.mechanicId === m.id)}
                  reason={o.reason}
                  experience={[
                    o.categoryCount ? `${o.categoryCount} verified ${repairNoun(o.r.repairCategory, o.categoryCount)}` : "",
                    ...o.vehicleReasons,
                    o.makeCount && !o.vehicleReasons.length ? `${o.makeCount} verified ${v.make} ${o.makeCount === 1 ? "repair" : "repairs"}` : "",
                  ]
                    .filter(Boolean)
                    .slice(0, 3)}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="border-y border-rule py-6 text-ink-2">
          {ready.matchable ? (
            <p>No new repair requests. Requests that fit your repairs and area appear here and in Notifications.</p>
          ) : (
            <p>
              No requests yet. Clutch sends you requests once your profile is complete ({ready.done} of {ready.steps.length} steps done).{" "}
              <Link href="/mechanic" className="font-semibold text-ink underline decoration-rule underline-offset-2">
                See what&apos;s left
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
