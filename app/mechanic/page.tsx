import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Briefcase, CalendarClock, CircleCheck, MessageCircleQuestion, Hourglass } from "lucide-react";
import { ready, repo } from "@/lib/data";
import { getSession } from "@/lib/session";
import { toPublicProfile } from "@/lib/domain/public-profile";
import { profileSteps } from "@/lib/domain/completeness";
import { eligibility } from "@/lib/domain/eligibility";
import { vehicleLine } from "@/lib/domain/intake";
import { repairNoun } from "@/lib/domain/provenance";
import { earnings, opportunities } from "@/lib/mechanic-insights";
import { plural, usd } from "@/lib/format";
import { RequestCard } from "@/components/request/request-card";

export const metadata: Metadata = { title: "Mechanic home" };

function greeting() {
  const h = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Los_Angeles" }));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

type Action = { icon: typeof Briefcase; title: string; detail?: string; href: string; cta: string; urgent?: boolean };

/**
 * "What needs your attention?" first: at most three actions. Then a small
 * business snapshot. Account status takes one line unless something is wrong.
 */
export default async function MechanicHome({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  await ready();
  const s = await getSession();
  if (s.role !== "mechanic") return null;
  const sp = await searchParams;
  const m = repo.getMechanic(s.mechanicId)!;
  const p = toPublicProfile(repo.getMechanicSources(s.mechanicId));
  const a = await repo.analyticsSummary(s.mechanicId);
  const opps = opportunities(m, p);
  const fresh = opps.filter((o) => o.state === "new");
  const e = earnings(s.mechanicId);
  const quotes = repo.listQuotesForMechanic(s.mechanicId);
  const deciding = quotes.filter((q) => q.status === "submitted").length;
  const openQs = quotes.flatMap((q) => q.customerQuestions.filter((x) => !x.answer).map(() => q));
  const jobs = repo.listJobsForMechanic(s.mechanicId);
  const upcoming = jobs.filter((j) => j.status === "scheduled" || j.status === "in_progress" || j.status === "awaiting_customer");
  const unconfirmed = upcoming.find((j) => j.status === "scheduled" && !j.confirmedAt);
  const nextJob = upcoming.find((j) => j.status === "scheduled");
  const elig = eligibility(p);
  const steps = profileSteps(p, { hasPhoto: Boolean(m.photoUrl), hasPricing: m.hourlyRateCents > 0, shared: a.profile_share > 0 });
  const missing = steps.filter((x) => !x.done && !x.requiredForWork && ["Basic information and bio", "Profile photo", "Service area", "Services you offer", "Pricing"].includes(x.label));

  // In priority order; the first three are shown.
  const actions: Action[] = [
    ...(unconfirmed
      ? [{ icon: CalendarClock, title: `Confirm ${unconfirmed.scheduledFor}`, detail: `${vehicleLine(repo.getVehicle(unconfirmed.vehicleId)!)} · ${unconfirmed.title}`, href: `/mechanic/jobs/${unconfirmed.id}`, cta: "Confirm appointment", urgent: true }]
      : []),
    ...(openQs.length ? [{ icon: MessageCircleQuestion, title: `${plural(openQs.length, "customer question")} to answer`, href: "/mechanic/quotes", cta: "Answer" }] : []),
    ...(fresh.length ? [{ icon: Briefcase, title: plural(fresh.length, "new repair request"), detail: fresh[0] ? `Newest: ${vehicleLine(repo.getVehicle(fresh[0].r.vehicleId)!)}` : undefined, href: "/mechanic/requests", cta: "Review requests" }] : []),
    ...(nextJob && nextJob !== unconfirmed
      ? [{ icon: CalendarClock, title: `Upcoming job ${nextJob.scheduledFor}`, detail: `${vehicleLine(repo.getVehicle(nextJob.vehicleId)!)} · ${nextJob.title}`, href: `/mechanic/jobs/${nextJob.id}`, cta: "Open job" }]
      : []),
    ...(deciding ? [{ icon: Hourglass, title: `${plural(deciding, "estimate")}: customer deciding`, href: "/mechanic/quotes", cta: "View estimates" }] : []),
  ].slice(0, 3);

  const snapshot: [string, string][] = [
    [usd(e.thisMonth), "estimated this month"],
    [String(p.reputation.verifiedRepairs), "verified repairs"],
    [p.reputation.rating ? p.reputation.rating.average.toFixed(1) : "–", p.reputation.rating ? `rating (${p.reputation.rating.count})` : "no rating yet"],
    [String(a.profile_view), "profile views"],
  ];

  return (
    <div className="space-y-10">
      <div>
        {sp.welcome ? <p className="mb-2 text-[0.9375rem] font-semibold">Your profile is live at /mechanics/{m.slug}.</p> : null}
        <h1 className="display text-[2rem] sm:text-[2.5rem]">
          {greeting()}, {m.firstName}
        </h1>
        {/* Account status: one line when healthy, specific problems when not. */}
        {elig.eligible && elig.tone === "ok" && !missing.length ? (
          <p className="mt-2 inline-flex items-center gap-2 text-[0.9375rem] text-ink-2">
            <CircleCheck size={17} className="text-brand" aria-hidden /> You&apos;re ready to receive jobs
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {elig.tone !== "ok" ? (
              <li className={`flex flex-wrap items-center gap-x-3 gap-y-1 border px-4 py-2.5 text-[0.9375rem] ${elig.eligible ? "border-amber bg-amber-wash" : "border-alert bg-alert-wash"}`}>
                <AlertTriangle size={17} className={elig.eligible ? "text-amber" : "text-alert"} aria-hidden />
                <span className="flex-1 font-semibold">{elig.mechanicLine}</span>
                <Link href="/mechanic/verification" className="font-semibold underline underline-offset-2">
                  Fix in Verification
                </Link>
              </li>
            ) : null}
            {missing[0] ? (
              <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-rule bg-sheet px-4 py-2.5 text-[0.9375rem]">
                <span className="flex-1">
                  Profile: add your <span className="font-semibold">{missing[0].label.toLowerCase()}</span>
                </span>
                <Link href={missing[0].href} className="font-semibold underline decoration-rule underline-offset-2">
                  Add it
                </Link>
              </li>
            ) : null}
          </ul>
        )}
      </div>

      <section aria-labelledby="attention-title">
        <h2 id="attention-title" className="heading text-[1.25rem]">
          What needs your attention?
        </h2>
        {actions.length ? (
          <ul className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            {actions.map((x) => (
              <li key={x.title}>
                <Link href={x.href} className={`group flex h-full flex-col gap-2 border p-4 transition-colors ${x.urgent ? "border-brand bg-brand text-on-brand" : "border-rule bg-sheet hover:border-ink-3"}`}>
                  <x.icon size={22} className={x.urgent ? "text-brass" : "text-brand"} aria-hidden />
                  <span className="font-bold">{x.title}</span>
                  {x.detail ? <span className={`line-clamp-2 text-[0.875rem] ${x.urgent ? "text-on-brand-2" : "text-ink-2"}`}>{x.detail}</span> : null}
                  <span className="mt-auto inline-flex items-center gap-1.5 pt-1 text-[0.875rem] font-semibold">
                    {x.cta} <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 inline-flex items-center gap-2 text-ink-2">
            <CircleCheck size={17} className="text-brand" aria-hidden /> Nothing needs you right now.
          </p>
        )}
      </section>

      <dl className="grid grid-cols-2 gap-px border border-rule bg-rule-soft sm:grid-cols-4">
        {snapshot.map(([v, k]) => (
          <div key={k} className="bg-sheet px-4 py-3">
            <dd className="num text-[1.75rem]">{v}</dd>
            <dt className="text-[0.8125rem] text-ink-2">{k}</dt>
          </div>
        ))}
      </dl>

      {fresh.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="heading text-[1.25rem]">Newest requests</h2>
            <Link href="/mechanic/requests" className="text-[0.875rem] font-semibold underline decoration-rule underline-offset-2">
              All requests
            </Link>
          </div>
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {fresh.slice(0, 2).map((o) => {
              const v = repo.getVehicle(o.r.vehicleId)!;
              return (
                <li key={o.r.id}>
                  <RequestCard
                    r={o.r}
                    v={v}
                    distanceMi={o.distanceMi}
                    state={o.state}
                    reason={o.reason}
                    experience={[o.categoryCount ? `${o.categoryCount} verified ${repairNoun(o.r.repairCategory, o.categoryCount)}` : "", ...o.vehicleReasons].filter(Boolean)}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
