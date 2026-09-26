import Link from "next/link";
import { StarRating } from "@/components/visual/stars";
import { CalendarClock, ChevronDown, ShieldAlert, ShieldCheck } from "lucide-react";
import type { PublicMechanicProfile } from "@/lib/domain/public-profile";
import type { RepairCategory, VehicleMake } from "@/lib/domain/types";
import { eligibility, notBookableStatus, screeningItems, screeningSummary, STATUS_WORD } from "@/lib/domain/eligibility";
import { openingLabel, soonest } from "@/lib/domain/availability";
import type { FitInput, PickKind } from "@/lib/domain/recommend";
import { dominantReason, rankingFactors } from "@/lib/domain/recommend";
import { usd, WORK_MODEL_LABEL } from "@/lib/format";
import { PhotoPrint } from "@/components/profile/photo";

type Ctx = { repair?: RepairCategory; make?: VehicleMake; model?: string };
type Common = {
  fit: FitInput;
  ctx: Ctx;
  profileHref: string;
  quoteHref: string;
};

/** The relevant starting price: a fixed price for this repair, else the hourly labor rate. */
export function startingPrice(p: PublicMechanicProfile, repair?: RepairCategory) {
  const fixed = repair ? p.pricing.fixed.find((f) => f.repairCategory === repair) : undefined;
  return fixed ? { amount: usd(fixed.laborCents), unit: "fixed labor" } : { amount: usd(p.pricing.hourlyRateCents), unit: "/hr labor" };
}

/** Each check with its own status (never one vague badge). */
function Checks({ p }: { p: PublicMechanicProfile }) {
  const items = screeningItems(p);
  const insurance = items.find((i) => i.key === "insurance");
  return (
    <div className="text-[0.8125rem]">
      <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Clutch verification checks">
        {items.map((i) => (
          <li key={i.key} className={i.verified ? "text-ink-2" : "font-semibold text-amber"}>
            {i.name}: {i.state === "expiring" ? "Verified" : STATUS_WORD[i.state]}
          </li>
        ))}
      </ul>
      {insurance && !insurance.verified ? <p className="mt-0.5 text-ink-3">Clutch has not verified active insurance coverage.</p> : null}
    </div>
  );
}

function Facts({ p, extra }: { p: PublicMechanicProfile; extra?: React.ReactNode }) {
  const o = soonest(p.openings);
  const s = screeningSummary(p);
  const r = p.reputation.rating;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[0.875rem]">
      <li className="inline-flex items-center gap-1.5">
        {r ? <StarRating value={r.average} size={14} /> : null}
        {r ? (
          <span>
            <span className="font-semibold">{r.average.toFixed(1)}</span> <span className="text-ink-2">({r.count})</span>
          </span>
        ) : (
          <span className="text-ink-2">No reviews yet</span>
        )}
      </li>
      <li className={`inline-flex items-center gap-1.5 ${s.current ? "" : "font-semibold text-amber"}`}>
        {s.current ? <ShieldCheck size={15} className="text-carbon" aria-hidden /> : <ShieldAlert size={15} className="text-amber" aria-hidden />}
        {s.label}
      </li>
      <li className="inline-flex items-center gap-1.5">
        <CalendarClock size={15} className="text-ink-3" aria-hidden />
        {o ? openingLabel(o) : p.nextAvailable}
      </li>
      {extra}
    </ul>
  );
}

function Price({ p, repair, big }: { p: PublicMechanicProfile; repair?: RepairCategory; big?: boolean }) {
  const s = startingPrice(p, repair);
  return (
    <p className="whitespace-nowrap">
      <span className="text-[0.75rem] text-ink-3">From </span>
      <span className={`num ${big ? "text-[1.625rem]" : "text-[1.25rem]"}`}>{s.amount}</span>
      <span className="text-[0.8125rem] text-ink-2"> {s.unit}</span>
    </p>
  );
}

function Reason({ fit, ctx, big }: { fit: FitInput; ctx: Ctx; big?: boolean }) {
  const dom = dominantReason(fit, ctx);
  if (!dom) return <p className="text-[0.9375rem] text-ink-3">No verified repairs yet</p>;
  return (
    <p className="flex items-baseline gap-2">
      <span className={`num leading-none ${big ? "text-[2.25rem]" : "text-[1.5rem]"}`}>{dom.n}</span>
      <span className={`font-bold ${big ? "text-[1.0625rem]" : "text-[0.9375rem]"}`}>{dom.text}</span>
    </p>
  );
}

/** Best Fit / Soonest Strong Fit: one headline, three facts, a price, one action. The rest is behind "Why this match?". */
export function RecommendationCard({ fit, ctx, profileHref, quoteHref, kind, title, definition }: Common & { kind: PickKind; title: string; definition: string }) {
  const p = fit.p;
  const factors = rankingFactors(fit, ctx).filter((f) => f.label !== "Verified rating");
  return (
    <li className="flex min-w-0 flex-col border-2 border-brand-deep bg-sheet shadow-[0_10px_30px_-18px_rgba(15,28,48,0.55)]">
      <p className="border-b-4 border-brass bg-brand-deep px-4 py-2 text-[0.9375rem] font-extrabold text-brass-wash sm:px-5">{title}</p>
      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-5">
        <div className="flex items-center gap-4">
          <PhotoPrint photoUrl={p.photoUrl} initials={p.initials} name={p.displayName} size={72} />
          <div className="min-w-0">
            <h3 className="heading text-[1.3125rem] leading-tight">
              <Link href={profileHref} className="hover:underline">
                {p.displayName}
              </Link>
            </h3>
            <p className="mt-0.5 text-[0.875rem] text-ink-2">{WORK_MODEL_LABEL[p.workModel]}</p>
          </div>
        </div>
        <Reason fit={fit} ctx={ctx} big />
        <Facts p={p} />
        <Checks p={p} />
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-rule-soft pt-4">
          <Price p={p} repair={ctx.repair} big />
          <div className="flex flex-wrap items-center gap-2">
            <Link href={profileHref} className="btn btn-quiet min-h-11">
              View profile
            </Link>
            <Link href={quoteHref} className="btn btn-ink min-h-11">
              Request estimate
            </Link>
          </div>
        </div>
        <details className="group -mb-1">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-[0.875rem] font-semibold [&::-webkit-details-marker]:hidden">
            <ChevronDown size={16} className="transition-transform group-open:rotate-180" aria-hidden />
            Why this match?
          </summary>
          <div className="pb-1 text-[0.875rem]">
            <p className="text-ink-2">
              {definition} &ldquo;Verified experience&rdquo; means repairs confirmed on Clutch; it says nothing about the checks listed on the card. Ranked by that experience,
              then full verification; price and payment never affect order.
            </p>
            <dl className="mt-2">
              {factors.map((f) => (
                <div key={f.label} className="flex justify-between gap-3 border-b border-rule-soft py-1.5">
                  <dt className="text-ink-2">{f.label}</dt>
                  <dd className="tnum font-semibold">{f.value}</dd>
                </div>
              ))}
            </dl>
            {kind === "soonest" ? <p className="mt-2 text-[0.8125rem] text-ink-3">Earliest opening among mechanics who clear the evidence bar.</p> : null}
          </div>
        </details>
      </div>
    </li>
  );
}

/** Everyone else who can be booked: the same facts, one line each. */
export function MechanicCard({ fit, ctx, profileHref, quoteHref }: Common) {
  const p = fit.p;
  return (
    <li className="grid min-w-0 grid-cols-1 gap-4 border border-rule bg-sheet p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="flex min-w-0 gap-3.5">
        <PhotoPrint photoUrl={p.photoUrl} initials={p.initials} name={p.displayName} size={60} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div>
            <h3 className="heading text-[1.125rem] leading-tight">
              <Link href={profileHref} className="hover:underline">
                {p.displayName}
              </Link>
            </h3>
            {p.tagline ? <p className="line-clamp-1 text-[0.875rem] text-ink-2">{p.tagline}</p> : null}
          </div>
          <Reason fit={fit} ctx={ctx} />
          <Facts p={p} extra={fit.miles !== undefined ? <li className="text-ink-2">{fit.miles < 1 ? "Under a mile" : `${fit.miles.toFixed(1)} mi`}</li> : null} />
          <Checks p={p} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-rule-soft pt-3 sm:flex-col sm:flex-nowrap sm:items-end sm:border-t-0 sm:pt-0">
        <Price p={p} repair={ctx.repair} />
        <Link href={quoteHref} className="btn btn-line min-h-11">
          Request estimate
        </Link>
      </div>
    </li>
  );
}

/** Can't be booked (profile incomplete), or outside the chosen availability: the reason as one status. */
export function UnbookableCard({ fit, ctx, profileHref, status }: Omit<Common, "quoteHref"> & { status?: string }) {
  const p = fit.p;
  const why = status ?? notBookableStatus(eligibility(p));
  return (
    <li className="flex min-w-0 items-center gap-3.5 border border-rule-soft bg-sheet/60 p-3.5">
      <PhotoPrint photoUrl={p.photoUrl} initials={p.initials} name={p.displayName} size={48} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{p.displayName}</p>
        <div className="mt-0.5 text-ink-2 [&_p]:text-[0.875rem]">
          <Reason fit={fit} ctx={ctx} />
        </div>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1.5 border border-amber/40 bg-amber-wash px-2 py-1 text-[0.8125rem] font-semibold text-amber">
        <ShieldAlert size={14} aria-hidden /> {why}
      </span>
      <Link href={profileHref} className="hidden shrink-0 text-[0.875rem] font-semibold underline decoration-rule underline-offset-[3px] sm:inline">
        Profile
      </Link>
    </li>
  );
}
