import Link from "next/link";
import { StarRating } from "@/components/visual/stars";
import { MapPin } from "lucide-react";
import type { PublicMechanicProfile } from "@/lib/domain/public-profile";
import { safetyEvidence } from "@/lib/domain/evidence";
import { REPAIR_LABEL, repairNoun } from "@/lib/domain/provenance";
import type { ContextMatch } from "@/lib/domain/reputation";
import { plural, rating, usd, WORK_MODEL_LABEL } from "@/lib/format";
import { ProvenanceMark } from "@/components/trust/provenance-mark";
import { PhotoPrint } from "./photo";
import { AvailabilityPill } from "@/components/visual/availability";
import { Languages, GraduationCap, Wrench } from "lucide-react";

/** The person: where they learned, how long, languages. Self-reported, and labelled so. */
export function PersonFacts({ p }: { p: PublicMechanicProfile }) {
  const facts = [
    p.yearsExperience ? { icon: Wrench, text: `${p.yearsExperience} years in the trade` } : null,
    p.trainedAt ? { icon: GraduationCap, text: p.trainedAt } : null,
    p.languages.length ? { icon: Languages, text: `Speaks ${p.languages.join(", ")}` } : null,
  ].filter(Boolean) as { icon: typeof Wrench; text: string }[];
  if (!facts.length) return null;
  return (
    <div>
      <ul className="grid gap-1.5">
        {facts.map((f) => (
          <li key={f.text} className="flex items-start gap-2.5 text-[0.9375rem] text-ink">
            <f.icon size={16} className="mt-[3px] shrink-0 text-ink-3" aria-hidden />
            {f.text}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[0.75rem] text-pencil">In {p.firstName}&apos;s own words. Verified work history is listed separately below.</p>
    </div>
  );
}

/** "Who" — the record header. */
export function RecordHeader({ p }: { p: PublicMechanicProfile }) {
  const place = p.neighborhood ? `${p.neighborhood}, ${p.city}` : p.city;
  const reach = `Comes to you within ${p.serviceRadiusMi} mi`;
  return (
    <div className="flex items-start gap-4 sm:gap-6">
      <div className="sm:hidden">
        <PhotoPrint photoUrl={p.photoUrl} initials={p.initials} name={p.displayName} size={96} />
      </div>
      <div className="hidden sm:block">
        <PhotoPrint photoUrl={p.photoUrl} initials={p.initials} name={p.displayName} size={148} />
      </div>
      <div className="min-w-0 pt-0.5">
        <h1 className="display text-[2.125rem] text-ink sm:text-[3rem]">{p.displayName}</h1>
        {p.tagline ? <p className="mt-1.5 max-w-[52ch] text-[1rem] leading-snug text-ink-2 sm:text-[1.0625rem]">{p.tagline}</p> : null}
        <p className="mt-2 text-[0.9375rem] font-semibold text-ink">
          {WORK_MODEL_LABEL.mobile}
        </p>
        <p className="mt-0.5 flex items-start gap-1 text-[0.875rem] text-ink-2">
          <MapPin size={14} strokeWidth={1.75} className="mt-[3px] shrink-0 text-ink-3" aria-hidden />
          <span>
            {place} · {reach}
          </span>
        </p>
        <div className="mt-3">
          <AvailabilityPill openings={p.openings} fallback={p.nextAvailable} />
        </div>
        <p className="mt-2 text-[0.75rem] text-ink-3">
          Record <span className="tnum font-semibold text-ink-2">{p.recordNo}</span>
        </p>
      </div>
    </div>
  );
}

/** Identity, background, driving record and insurance: each with its own status, never summed up as "screened". */
export function SafetyBox({ p }: { p: PublicMechanicProfile }) {
  const s = p.safety;
  const items = [
    safetyEvidence("background", s.background, p.firstName),
    ...(s.drivingApplies ? [safetyEvidence("driving_record", s.driving_record, p.firstName)] : []),
    safetyEvidence("insurance", s.insurance, p.firstName),
  ];
  return (
    <div className="sheet grid grid-cols-1 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,2fr)]">
      <div className="border-b border-rule-soft px-3.5 py-3 sm:border-r sm:border-b-0">
        <p className="field-label">Identity</p>
        <ProvenanceMark detail={safetyEvidence("identity", s.identity, p.firstName)} size="md" className="mt-1.5" />
      </div>
      <div className="px-3.5 py-3">
        <p className="field-label">Other checks · each with its own status</p>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
          {items.map((d) => (
            <ProvenanceMark key={d.title} detail={d} size="md" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** "Relevant" — the one highlighter: evidence matching the visitor's car and repair. */
export function ContextMatchBlock({ p, match }: { p: PublicMechanicProfile; match: ContextMatch }) {
  const { repair, make, crossCount, categoryCount, makeCount } = match;
  const lead =
    repair && make
      ? { n: crossCount, text: `${make} ${repairNoun(repair, crossCount)}` }
      : repair
        ? { n: categoryCount, text: repairNoun(repair, categoryCount) }
        : { n: makeCount, text: `${make} ${makeCount === 1 ? "repair" : "repairs"}` };
  const none = lead.n === 0;
  return (
    <section aria-label="Experience with your repair" className="sheet overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-rule-soft px-3.5 py-2">
        <p className="field-label">
          Your job: {make ?? "any make"} · {repair ? REPAIR_LABEL[repair] : "any repair"}
        </p>
        <Link href={`/mechanics/${p.slug}`} scroll={false} className="text-[0.8125rem] text-ink-3 underline decoration-rule underline-offset-2 hover:text-ink">
          Clear
        </Link>
      </div>
      <div className="px-3.5 py-3">
        {none ? (
          <p className="text-[0.9375rem] text-ink-2">
            No verified {repair ? REPAIR_LABEL[repair].toLowerCase() : ""} work on {make ?? "this make"} yet.{" "}
            {repair && categoryCount > 0 ? `${p.firstName} has ${plural(categoryCount, repairNoun(repair, 1), repairNoun(repair, 2))} on other makes.` : null}
            {make && !repair && makeCount === 0 ? null : null}
          </p>
        ) : (
          <>
            <p className="flex items-baseline gap-2.5">
              <span className="highlight highlight-draw -mx-1 px-1 num text-[2.75rem] text-ink">{lead.n}</span>
              <span className="text-[1.0625rem] font-semibold text-ink">verified {lead.text}</span>
            </p>
            {repair && make ? (
              <p className="mt-1.5 text-[0.875rem] text-ink-2">
                of {plural(categoryCount, repairNoun(repair, 1), repairNoun(repair, 2))} and {plural(makeCount, `${make} repair`)} overall
              </p>
            ) : null}
          </>
        )}
        {!none && (
          <a href="#matching-work" className="mt-2 inline-block text-[0.875rem] font-semibold text-ink underline decoration-rule underline-offset-[3px] hover:decoration-ink">
            See the {lead.n === 1 ? "job" : `${lead.n} jobs`}
          </a>
        )}
      </div>
    </section>
  );
}

/** "Proven" — the three counts, as a ruled strip. Each states its base. */
export function CountsStrip({ p }: { p: PublicMechanicProfile }) {
  const r = p.reputation;
  return (
    <div className="grid grid-cols-3 border-y border-rule">
      <a href="#repair-record" className="group border-r border-rule-soft py-3 pr-3 hover:bg-sheet/60">
        <span className="num block text-[2.25rem] text-ink sm:text-[2.75rem]">{r.verifiedRepairs}</span>
        <span className="mt-1.5 block text-[0.8125rem] leading-tight text-ink-2 group-hover:text-ink">verified repairs</span>
      </a>
      <a href="#reviews" className="group border-r border-rule-soft px-3 py-3 hover:bg-sheet/60">
        {r.rating ? (
          <>
            <span className="flex items-baseline gap-1">
              <span className="num text-[2.25rem] text-ink sm:text-[2.75rem]">{rating(r.rating.average)}</span>
              <StarRating value={r.rating.average} size={15} className="-translate-y-0.5" />
            </span>
            <span className="mt-1.5 block text-[0.8125rem] leading-tight text-ink-2 group-hover:text-ink">
              from {plural(r.rating.count, "verified review")}
            </span>
          </>
        ) : (
          <>
            <span className="num block text-[2.25rem] text-rule sm:text-[2.75rem]">—</span>
            <span className="mt-1.5 block text-[0.8125rem] leading-tight text-ink-3">no verified reviews yet</span>
          </>
        )}
      </a>
      <a href="#reviews" className="group py-3 pl-3 hover:bg-sheet/60">
        <span className="num block text-[2.25rem] text-ink sm:text-[2.75rem]">{r.repeatCustomers}</span>
        <span className="mt-1.5 block text-[0.8125rem] leading-tight text-ink-2 group-hover:text-ink">
          {r.repeatCustomers === 1 ? "customer rebooked" : "customers rebooked"}
        </span>
      </a>
    </div>
  );
}

/** "Price" — set by the mechanic, stated plainly, never ranked. */
export function PriceLine({ p }: { p: PublicMechanicProfile }) {
  const pr = p.pricing;
  return (
    <dl className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
      <div className="flex items-baseline gap-1.5">
        <dt className="sr-only">Labor rate</dt>
        <dd className="num text-[1.75rem] text-ink">{usd(pr.hourlyRateCents)}</dd>
        <span className="text-[0.875rem] text-ink-2">/hr labor</span>
      </div>
      <div className="flex items-baseline gap-1.5 text-[0.875rem] text-ink-2">
        <dt>Diagnostic</dt>
        <dd className="tnum font-semibold text-ink">{usd(pr.diagnosticFeeCents)}</dd>
      </div>
      {pr.travelFeeCents ? (
        <div className="flex items-baseline gap-1.5 text-[0.875rem] text-ink-2">
          <dt>Travel</dt>
          <dd className="tnum font-semibold text-ink">{usd(pr.travelFeeCents)}</dd>
        </div>
      ) : null}
    </dl>
  );
}
