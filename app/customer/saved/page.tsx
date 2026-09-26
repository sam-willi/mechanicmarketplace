import type { Metadata } from "next";
import { StarRating } from "@/components/visual/stars";
import Link from "next/link";
import { ready, repo } from "@/lib/data";
import { getSession } from "@/lib/session";
import { monthYear, plural, usd } from "@/lib/format";
import { PhotoPrint } from "@/components/profile/photo";
import { SaveMechanicButton } from "@/components/profile/save-button";

export const metadata: Metadata = { title: "Saved Mechanics" };

export default async function SavedMechanics() {
  await ready();
  const s = await getSession();
  if (s.role !== "customer") return null;
  const saved = repo.listSaved(s.customerId);
  const history = repo.listCustomerHistory(s.customerId);
  const ids = [...new Set([...saved, ...history.map((h) => h.mechanicId)])];

  return (
    <div className="space-y-8">
      <div className="border-b-2 border-ink pb-4">
        <h1 className="display text-[2rem] sm:text-[2.5rem]">Saved Mechanics</h1>
        <p className="mt-1 text-ink-2">The people you trust with your car. Booking them again goes straight to them.</p>
      </div>
      {ids.length === 0 && (
        <p className="border-y border-rule py-6 text-ink-3">
          Save a mechanic from their profile or a quote and they&apos;ll be here.{" "}
          <Link href="/customer/mechanics" className="link text-ink">
            Find a mechanic
          </Link>
        </p>
      )}
      <ul className="grid gap-4 md:grid-cols-2">
        {ids.map((id) => {
          const m = repo.getMechanic(id)!;
          const p = repo.getPublicProfile(m.slug)!;
          const jobs = history.filter((h) => h.mechanicId === id);
          const last = jobs[0];
          const cars = [...new Set(jobs.map((j) => `${j.year} ${j.make} ${j.model}`))];
          return (
            <li key={id} className="sheet flex flex-col p-5">
              <div className="flex items-start gap-4">
                <PhotoPrint photoUrl={p.photoUrl} initials={p.initials} name={p.displayName} size={64} />
                <div className="min-w-0 flex-1">
                  <Link href={`/mechanics/${p.slug}`} className="heading text-[1.25rem] hover:underline">
                    {p.displayName}
                  </Link>
                  <p className="tnum text-[0.875rem] text-ink-2">
                    {usd(p.pricing.hourlyRateCents)}/hr · available {p.nextAvailable}
                  </p>
                  <p className="text-[0.8125rem] text-ink-3">
                    {p.reputation.verifiedRepairs} verified repairs
                    {p.reputation.rating ? (
                      <span className="inline-flex items-center gap-1">
                        <span aria-hidden> ·</span> <StarRating value={p.reputation.rating.average} size={12} /> {p.reputation.rating.average.toFixed(1)}
                      </span>
                    ) : null}
                  </p>
                </div>
              </div>
              <dl className="mt-4 space-y-1 border-t border-rule-soft pt-3 text-[0.875rem]">
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-ink-3">Last repair</dt>
                  <dd>{last ? `${last.title} · ${monthYear(last.performedOn)}` : "Not hired yet"}</dd>
                </div>
                {cars.length ? (
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-ink-3">Your cars</dt>
                    <dd>
                      {cars.join(", ")} · {plural(jobs.length, "job")}
                    </dd>
                  </div>
                ) : null}
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/customer/requests/new?${jobs.length ? "rebook" : "mechanic"}=${p.slug}`} className="btn btn-ink min-h-11">
                  {jobs.length ? `Rebook ${p.firstName}` : `Request estimate`}
                </Link>
                <SaveMechanicButton mechanicId={id} saved={saved.includes(id)} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
