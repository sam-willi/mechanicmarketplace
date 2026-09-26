import { CalendarClock, ChevronDown, MapPin, ShieldAlert, ShieldCheck, Star } from "lucide-react";
import type { PublicMechanicProfile } from "@/lib/domain/public-profile";
import type { FitInput } from "@/lib/domain/recommend";
import { dominantReason, isStrongFit } from "@/lib/domain/recommend";
import { eligibility, screeningSummary } from "@/lib/domain/eligibility";
import { openingLabel, soonest } from "@/lib/domain/availability";
import { repairNoun } from "@/lib/domain/provenance";
import type { RepairCategory, VehicleMake } from "@/lib/domain/types";
import { WORK_MODEL_LABEL } from "@/lib/format";
import { ScreeningList } from "@/components/trust/screening-list";
import { EligibilityNotice } from "@/components/trust/eligibility-notice";
import { AvailabilityPill } from "@/components/visual/availability";
import { PhotoPrint } from "./photo";

/**
 * The top of a profile: who they are, one match panel for the visitor's job,
 * and screening as a single line that opens. Each fact appears once.
 */
export function TrustOverview({ p, fit, ctx }: { p: PublicMechanicProfile; fit: FitInput; ctx: { repair?: RepairCategory; make?: VehicleMake } }) {
  const r = p.reputation;
  const dom = ctx.repair || ctx.make ? dominantReason(fit, ctx) : null;
  const e = eligibility(p);
  const s = screeningSummary(p);
  const o = soonest(p.openings);
  const place = p.neighborhood ? `${p.neighborhood}, ${p.city}` : p.city;
  const reach = p.workModel === "shop" ? "at their shop" : `within ${p.serviceRadiusMi} mi`;
  const job = [ctx.make, ctx.repair ? repairNoun(ctx.repair, 1) : "repair"].filter(Boolean).join(" ");
  const strong = dom ? isStrongFit(fit, ctx) : false;
  const rating = r.rating ? `${r.rating.average.toFixed(1)} from ${r.rating.count} verified reviews` : "No verified reviews yet";

  // What the match panel doesn't already say.
  const stats: [string, string][] = dom
    ? [
        [String(r.verifiedRepairs), "verified repairs"],
        [String(r.repeatCustomers), r.repeatCustomers === 1 ? "customer rebooked" : "customers rebooked"],
      ]
    : [
        [String(r.verifiedRepairs), "verified repairs"],
        [r.rating ? r.rating.average.toFixed(1) : "–", r.rating ? `from ${r.rating.count} verified reviews` : "no verified reviews yet"],
        [String(r.repeatCustomers), r.repeatCustomers === 1 ? "customer rebooked" : "customers rebooked"],
      ];

  return (
    <section id="overview" aria-label={`${p.displayName} at a glance`} className="scroll-mt-28 space-y-5">
      <div className="flex items-start gap-4 sm:gap-6">
        <div className="sm:hidden">
          <PhotoPrint photoUrl={p.photoUrl} initials={p.initials} name={p.displayName} size={96} />
        </div>
        <div className="hidden sm:block">
          <PhotoPrint photoUrl={p.photoUrl} initials={p.initials} name={p.displayName} size={152} />
        </div>
        <div className="min-w-0 pt-0.5">
          <h1 className="display text-[2rem] leading-[1.05] sm:text-[3rem]">{p.displayName}</h1>
          {p.tagline ? <p className="mt-1.5 line-clamp-2 max-w-[52ch] text-[1rem] leading-snug text-ink-2">{p.tagline}</p> : null}
          <p className="mt-2 flex items-start gap-1 text-[0.9375rem]">
            <MapPin size={15} className="mt-[3px] shrink-0 text-ink-3" aria-hidden />
            <span>
              <span className="font-semibold">{WORK_MODEL_LABEL[p.workModel]}</span> · {place} · {reach}
            </span>
          </p>
          {!dom ? (
            <div className="mt-3 lg:hidden">
              <AvailabilityPill openings={p.openings} fallback={p.nextAvailable} />
            </div>
          ) : null}
        </div>
      </div>

      {dom ? (
        <section aria-labelledby="match-title" className="border-2 border-brand bg-sheet">
          <h2 id="match-title" className="bg-brand px-4 py-2 text-[0.9375rem] font-bold text-on-brand">
            {strong ? `Strong match for your ${job}` : `Your ${job}`}
          </h2>
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-4 py-4">
            <ul className="space-y-2">
              <li className="flex items-baseline gap-2">
                <span className="num text-[2.25rem] leading-none">{dom.n}</span>
                <span className="text-[1.0625rem] font-bold">{dom.text}</span>
              </li>
              <li className="flex items-center gap-2 text-[0.9375rem]">
                <Star size={15} fill="currentColor" strokeWidth={0} aria-hidden /> {rating}
              </li>
              <li className="flex items-center gap-2 text-[0.9375rem]">
                <CalendarClock size={15} className="text-ink-3" aria-hidden /> {o ? openingLabel(o, { prefix: true }) : `Next opening ${p.nextAvailable}`}
              </li>
            </ul>
            <a href="#matching-work" className="text-[0.9375rem] font-semibold underline decoration-rule underline-offset-[3px] hover:decoration-ink">
              View evidence
            </a>
          </div>
        </section>
      ) : null}

      <dl className="flex flex-wrap gap-x-8 gap-y-2">
        {stats.map(([n, label]) => (
          <div key={label} className="flex items-baseline gap-2">
            <dd className="num text-[1.75rem]">{n}</dd>
            <dt className="text-[0.875rem] text-ink-2">{label}</dt>
          </div>
        ))}
      </dl>

      <details className="group border-y border-rule-soft">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 text-[0.9375rem] [&::-webkit-details-marker]:hidden">
          {s.current ? <ShieldCheck size={18} className="text-carbon" aria-hidden /> : <ShieldAlert size={18} className="text-amber" aria-hidden />}
          <span>
            <span className="font-semibold">Safety screening:</span> {s.ok} of {s.total} current
          </span>
          <ChevronDown size={16} className="ml-auto text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="pb-3">
          <ScreeningList p={p} />
        </div>
      </details>
      {!e.eligible ? <EligibilityNotice e={e} /> : null}
    </section>
  );
}
