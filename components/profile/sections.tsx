
import { StarRating } from "@/components/visual/stars";
import type { PublicMechanicProfile, PublicRepair, PublicReview } from "@/lib/domain/public-profile";
import { credentialEvidence, employmentEvidence, repairEvidence, sourceEvidence } from "@/lib/domain/evidence";
import { REPAIR_LABEL, repairNoun } from "@/lib/domain/provenance";
import type { RepairCategory, VehicleMake } from "@/lib/domain/types";
import { monthYear, plural, rating, usd } from "@/lib/format";
import { ProvenanceMark } from "@/components/trust/provenance-mark";
import { Tick } from "@/components/trust/marks";
import { Avatar } from "@/components/visual/icons";
import { OpeningsList } from "@/components/visual/availability";
import { ServiceAreaMap } from "@/components/visual/area-map";
import { ShieldCheck } from "lucide-react";

export function SectionHead({ id, title, note }: { id?: string; title: string; note?: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-20 border-t-2 border-ink pt-3">
      <h2 id={id ? `${id}-title` : undefined} className="heading text-[1.375rem] text-ink sm:text-[1.5rem]">
        {title}
      </h2>
      {note ? <p className="mt-1 max-w-[62ch] text-[0.9375rem] text-ink-2">{note}</p> : null}
    </div>
  );
}

/** One cell per job. Filled = completed on Clutch; outlined = confirmed by a prior customer. */
function Tally({ platform, customer, max }: { platform: number; customer: number; max: number }) {
  const cells = [...Array(platform).fill("p"), ...Array(customer).fill("c")];
  return (
    <span className="flex flex-wrap gap-[3px]" style={{ maxWidth: Math.max(80, Math.min(max, 30) * 10) }} aria-hidden>
      {cells.map((k, i) => (
        <span
          key={i}
          className={`block size-[7px] ${k === "p" ? "bg-carbon" : "border border-carbon bg-transparent"}`}
        />
      ))}
    </span>
  );
}

export function RepairLedger({
  p,
  highlight,
  highlightMake,
}: {
  p: PublicMechanicProfile;
  highlight?: RepairCategory;
  highlightMake?: VehicleMake;
}) {
  const cats = p.reputation.byCategory;
  const max = cats[0]?.count ?? 1;
  return (
    <section aria-labelledby="repair-record-title" className="space-y-4">
      <SectionHead
        id="repair-record"
        title="Repair record"
        note={
          <>
            Counted from repairs completed on Clutch, confirmed by the customer, or backed by an invoice Clutch reviewed. Nothing here is self-reported.
          </>
        }
      />
      {cats.length === 0 ? (
        <p className="sheet px-4 py-5 text-[0.9375rem] text-ink-2">
          No verified repairs yet. When {p.firstName} completes a job on Clutch, or a past customer confirms one, it appears here.
        </p>
      ) : (
        <ul className="border-b border-rule">
          {cats.map((c) => {
            const hl = highlight === c.category;
            return (
              <li key={c.category} className="border-t border-rule-soft first:border-rule">
                <details className="group">
                  <summary className="grid cursor-pointer list-none grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-x-3 py-3 [&::-webkit-details-marker]:hidden">
                    <span className={`num text-right text-[2rem] ${hl ? "highlight highlight-draw px-1" : ""} text-ink`}>{c.count}</span>
                    <span className="min-w-0">
                      <span className="block text-[1rem] font-semibold text-ink">{REPAIR_LABEL[c.category]}</span>
                      <span className="mt-1.5 block">
                        <Tally platform={c.platform} customer={c.customer} max={max} />
                      </span>
                    </span>
                    <span className="text-[0.8125rem] text-ink-3 group-open:text-ink">
                      <span className="group-open:hidden">Details</span>
                      <span className="hidden group-open:inline">Hide</span>
                    </span>
                  </summary>
                  <div className="pb-4 pl-[4rem]">
                    <p className="field-label">By make</p>
                    <p className="mt-1 text-[0.9375rem] text-ink-2">
                      {c.makes.map((m, i) => (
                        <span key={m.make}>
                          {i > 0 && <span className="text-rule"> · </span>}
                          <span className={highlightMake === m.make && hl ? "highlight px-0.5 font-semibold text-ink" : ""}>
                            {m.make} <span className="tnum font-semibold text-ink">{m.count}</span>
                          </span>
                        </span>
                      ))}
                    </p>
                    <p className="mt-3 text-[0.8125rem] text-ink-3">
                      {c.platform} completed on Clutch · {c.customer} verified from before Clutch
                    </p>
                    <WorkList items={p.verifiedWork.filter((w) => w.category === c.category).slice(0, 5)} compact />
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="block size-[7px] bg-carbon" /> Completed on Clutch
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="block size-[7px] border border-carbon" /> Verified from before Clutch
        </span>
      </p>
    </section>
  );
}

export function MakeLedger({ p, highlightMake }: { p: PublicMechanicProfile; highlightMake?: VehicleMake }) {
  const makes = p.reputation.byMake;
  if (!makes.length) return null;
  return (
    <section aria-labelledby="vehicles-title" className="space-y-4">
      <SectionHead id="vehicles" title="Vehicles worked on" />
      <ul className="grid grid-cols-2 border-t border-rule sm:grid-cols-4">
        {makes.map((m) => (
          <li
            key={m.make}
            className="flex items-baseline justify-between gap-2 border-b border-rule-soft py-2.5 pr-3"
          >
            <span className={`truncate text-[0.9375rem] text-ink ${highlightMake === m.make ? "highlight font-semibold" : ""}`}>{m.make}</span>
            <span className="num text-[1.5rem] text-ink">{m.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Verified work as numbered tickets. */
export function WorkList({
  items,
  compact = false,
  highlight = false,
}: {
  items: PublicRepair[];
  compact?: boolean;
  highlight?: boolean;
}) {
  return (
    <ol className={`${compact ? "mt-3" : ""} border-t border-rule`}>
      {items.map((w) => (
        <li key={w.id} className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 border-b border-rule-soft py-3 sm:grid-cols-[2.75rem_minmax(0,1fr)_auto]">
          <span className="tnum pt-0.5 text-[0.75rem] leading-5 text-ink-3" aria-label={w.ticket ? `Job number ${w.ticket}` : undefined}>
            {w.ticket ? `No.${String(w.ticket).padStart(3, "0")}` : "—"}
          </span>
          <div className="min-w-0">
            <p className={`${compact ? "text-[0.9375rem]" : "text-[1rem]"} font-semibold text-ink`}>
              <span className={highlight ? "highlight highlight-draw" : ""}>
                {w.year} {w.make} {w.model}
              </span>
            </p>
            <p className="text-[0.9375rem] text-ink-2">
              {w.title} <span className="tnum whitespace-nowrap text-ink-3">· {monthYear(w.performedOn)}</span>
            </p>
          </div>
          <ProvenanceMark detail={repairEvidence(w)} className="col-start-2 mt-0.5 sm:col-start-3" />
        </li>
      ))}
      {items.length === 0 && <li className="py-3 text-[0.9375rem] text-ink-3">None yet.</li>}
    </ol>
  );
}

export function RecentWork({ p, exclude }: { p: PublicMechanicProfile; exclude?: { category?: RepairCategory; make?: VehicleMake } }) {
  const all =
    exclude && (exclude.category || exclude.make)
      ? p.verifiedWork.filter((w) => !((!exclude.category || w.category === exclude.category) && (!exclude.make || w.make === exclude.make)))
      : p.verifiedWork;
  if (!all.length) return null;
  const first = all.slice(0, 6);
  const rest = all.slice(6);
  return (
    <section aria-labelledby="recent-title" className="space-y-4">
      <SectionHead id="recent" title={exclude && (exclude.category || exclude.make) ? "Other recent verified work" : "Recent verified work"} />
      <WorkList items={first} />
      {rest.length > 0 && (
        <details className="group">
          <summary className="btn btn-quiet cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Show all {all.length}</span>
            <span className="hidden group-open:inline">Show fewer</span>
          </summary>
          <div className="mt-3">
            <WorkList items={rest} />
          </div>
        </details>
      )}
    </section>
  );
}

export function Credentials({ p }: { p: PublicMechanicProfile }) {
  const creds = p.credentials;
  const jobs = p.employment;
  return (
    <section aria-labelledby="credentials-title" className="space-y-4">
      <SectionHead id="credentials" title="Certifications & work history" />
      <div className="grid gap-6 sm:grid-cols-2 sm:gap-8">
        <div>
          <p className="field-label">Certifications</p>
          <ul className="mt-2 border-t border-rule">
            {creds.map((c) => (
              <li key={c.id} className="border-b border-rule-soft py-3">
                <p className="text-[0.9375rem] font-semibold text-ink">
                  {c.issuer} {c.code ? <span className="tnum">{c.code}</span> : null}
                  <span className="font-normal text-ink-2"> · {c.name}</span>
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <ProvenanceMark detail={credentialEvidence(c)} />
                  {c.expiresAt && c.provenance !== "self" ? (
                    <span className="tnum text-[0.8125rem] text-ink-3">valid to {monthYear(c.expiresAt)}</span>
                  ) : null}
                </div>
              </li>
            ))}
            {creds.length === 0 && <li className="border-b border-rule-soft py-3 text-[0.9375rem] text-ink-3">None provided yet.</li>}
          </ul>
        </div>
        <div>
          <p className="field-label">Where {p.firstName} has worked</p>
          <ul className="mt-2 border-t border-rule">
            {jobs.map((e) => (
              <li key={e.id} className="border-b border-rule-soft py-3">
                <p className="text-[0.9375rem] font-semibold text-ink">{e.position}</p>
                <p className="text-[0.9375rem] text-ink-2">
                  {e.employer.replace(" (demo)", "")}{" "}
                  <span className="tnum text-ink-3">
                    · {monthYear(e.startedOn).split(" ")[1]}–{e.endedOn ? monthYear(e.endedOn).split(" ")[1] : "now"}
                  </span>
                </p>
                <ProvenanceMark detail={employmentEvidence(e)} className="mt-1" />
              </li>
            ))}
            {jobs.length === 0 && <li className="border-b border-rule-soft py-3 text-[0.9375rem] text-ink-3">None provided yet.</li>}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <StarRating value={n} size={14} labelled />
  );
}

function ReviewItem({ r, mark, match }: { r: PublicReview; mark?: React.ReactNode; match?: boolean }) {
  return (
    <li className="flex gap-3 border-b border-rule-soft py-4">
      <Avatar name={r.authorName} size={38} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-[0.875rem] font-semibold">
            {r.authorName}
            <span className="tnum font-normal text-ink-3"> · {monthYear(r.createdAt)}</span>
          </p>
          {mark}
        </div>
        {(r.vehicleLabel || r.repairLabel) && (
          <p className="mt-0.5 text-[0.8125rem] text-ink-2">
            <span className={match ? "highlight px-0.5 font-semibold text-ink" : ""}>
              {[r.repairLabel, r.vehicleLabel].filter(Boolean).join(" on a ")}
            </span>
          </p>
        )}
        <div className="mt-1.5">
          <Stars n={r.overall} />
        </div>
        {r.comment ? <p className="mt-1.5 max-w-[65ch] text-[0.9375rem] leading-relaxed text-ink">{r.comment}</p> : <p className="mt-1.5 text-[0.9375rem] text-ink-3">Rating only, no comment.</p>}
        {r.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.photoUrl} alt={`Photo from ${r.authorName}'s repair`} className="mt-2 h-24 w-32 border border-rule object-cover" />
        ) : null}
      </div>
    </li>
  );
}

export function Reviews({ p, prefer }: { p: PublicMechanicProfile; prefer?: { repair?: RepairCategory; make?: VehicleMake } }) {
  const r = p.reputation.rating;
  const { verified: all, customerConfirmed, testimonials } = p.reviews;
  const isMatch = (x: PublicReview) =>
    Boolean(prefer && (prefer.repair || prefer.make)) &&
    (!prefer?.make || Boolean(x.vehicleLabel?.includes(prefer.make))) &&
    (!prefer?.repair || Boolean(x.repairLabel?.toLowerCase().includes(REPAIR_LABEL[prefer.repair].toLowerCase().split(" ")[0].replace(/s$/, ""))));
  const verified = [...all].sort((a, b) => Number(isMatch(b)) - Number(isMatch(a)));
  const withComments = verified.filter((x) => x.comment);
  const shown = withComments.slice(0, 3);
  const more = [...withComments.slice(3), ...verified.filter((x) => !x.comment)];
  const verifiedMark = <ProvenanceMark detail={sourceEvidence("platform", "Verified repair review")} />;
  return (
    <section aria-labelledby="reviews-title" className="space-y-4">
      <SectionHead id="reviews" title="Reviews" />
      {r ? (
        <div className="grid gap-y-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-end sm:gap-x-10">
          <div>
            <p className="num text-[3.5rem] text-ink">{rating(r.average)}</p>
            <StarRating value={r.average} size={22} className="mt-1" />
            <p className="mt-2 text-[0.8125rem] text-ink-2">from {plural(r.count, "completed Clutch repair")}</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 border-t border-rule">
            {(
              [
                ["Workmanship", r.workmanship],
                ["Communication", r.communication],
                ["Timeliness", r.timeliness],
                ["Price accuracy", r.priceAccuracy],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between border-b border-rule-soft py-2">
                <dt className="text-[0.8125rem] text-ink-2">{k}</dt>
                <dd className="tnum text-[0.9375rem] font-semibold text-ink">{rating(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <p className="sheet px-4 py-4 text-[0.9375rem] text-ink-2">No verified reviews yet. Ratings appear after {p.firstName}&apos;s first completed Clutch job.</p>
      )}

      {shown.length > 0 && (
        <ul className="border-t border-rule">
          {shown.map((x) => (
            <ReviewItem key={x.id} r={x} mark={verifiedMark} match={isMatch(x)} />
          ))}
        </ul>
      )}
      {more.length > 0 && (
        <details className="group">
          <summary className="btn btn-quiet cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Show {more.length} more verified reviews</span>
            <span className="hidden group-open:inline">Show fewer</span>
          </summary>
          <ul className="mt-3 border-t border-rule">
            {more.map((x) => (
              <ReviewItem key={x.id} r={x} mark={verifiedMark} />
            ))}
          </ul>
        </details>
      )}

      {customerConfirmed.length + testimonials.length > 0 && (
        <details className="group">
          <summary className="btn btn-quiet h-auto cursor-pointer list-none py-2 text-left whitespace-normal [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Earlier customers and testimonials ({customerConfirmed.length + testimonials.length})</span>
            <span className="hidden group-open:inline">Hide earlier customers and testimonials</span>
          </summary>
          <div className="mt-2">
      {customerConfirmed.length > 0 && (
        <div className="pt-4">
          <p className="field-label">From customers of earlier work · not counted in the rating</p>
          <ul className="mt-2 border-t border-rule">
            {customerConfirmed.map((x) => (
              <ReviewItem key={x.id} r={x} mark={<ProvenanceMark detail={sourceEvidence("customer", "Customer-verified prior repair")} />} />
            ))}
          </ul>
        </div>
      )}

      {testimonials.length > 0 && (
        <div className="pt-4">
          <p className="field-label">Unverified testimonials · not counted in the rating</p>
          <ul className="mt-2 border-t border-dashed border-pencil/50">
            {testimonials.map((x) => (
              <li key={x.id} className="border-b border-dashed border-pencil/30 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[0.8125rem] text-ink-3">{x.authorName}</p>
                  <ProvenanceMark detail={sourceEvidence("self", "Unverified testimonial")} />
                </div>
                <p className="mt-2 max-w-[65ch] text-[0.9375rem] leading-relaxed text-pencil">“{x.comment}”</p>
              </li>
            ))}
          </ul>
        </div>
      )}
          </div>
        </details>
      )}
    </section>
  );
}

export function PricingSection({ p }: { p: PublicMechanicProfile }) {
  const pr = p.pricing;
  return (
    <section aria-labelledby="pricing-title" className="space-y-4">
      <SectionHead id="pricing" title="Pricing & availability" />
      <dl className="grid grid-cols-2 border-t border-rule sm:grid-cols-4">
        {(
          [
            ["Labor rate", `${usd(pr.hourlyRateCents)}/hr`],
            ["Diagnostic fee", usd(pr.diagnosticFeeCents)],
            ["Travel fee", pr.travelFeeCents ? usd(pr.travelFeeCents) : "None"],
            ["Service area", `${p.serviceRadiusMi} mi of ${p.neighborhood ?? p.city}`],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="border-b border-rule-soft py-2.5 pr-3">
            <dt className="field-label">{k}</dt>
            <dd className="tnum mt-0.5 text-[1rem] font-semibold text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      {p.priceRanges.length > 0 && (
        <div>
          <p className="field-label">What {p.firstName}&apos;s Clutch jobs have come to</p>
          <ul className="mt-2 border-t border-rule">
            {p.priceRanges.slice(0, 5).map((r) => (
              <li key={r.category} className="flex items-baseline justify-between gap-4 border-b border-rule-soft py-2.5">
                <span className="text-[0.9375rem] text-ink">
                  {REPAIR_LABEL[r.category]} <span className="text-[0.8125rem] text-ink-3">· {r.jobs} jobs</span>
                </span>
                <span className="tnum text-[0.9375rem] font-semibold text-ink">
                  {usd(r.lowCents)} to {usd(r.highCents)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[0.8125rem] text-ink-3">Past jobs, not a quote. Parts not included.</p>
        </div>
      )}
      {pr.fixed.length > 0 && (
        <div>
          <p className="field-label">Fixed labor prices</p>
          <ul className="mt-2 border-t border-rule">
            {pr.fixed.map((f) => (
              <li key={f.id} className="flex items-baseline justify-between gap-4 border-b border-rule-soft py-2.5">
                <span className="text-[0.9375rem] text-ink">{f.label}</span>
                <span className="tnum text-[0.9375rem] font-semibold text-ink">{usd(f.laborCents)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[0.8125rem] text-ink-3">Labor only.</p>
        </div>
      )}
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <p className="field-label">Next openings</p>
          <div className="mt-2">
            <OpeningsList openings={p.openings} />
          </div>
          <p className="mt-3 text-[0.875rem] text-ink-2">
            <span className="font-semibold text-ink">Usual hours:</span> {p.availabilityNote}.
          </p>
        </div>
        <ServiceAreaMap lat={p.lat} lng={p.lng} radiusMi={p.serviceRadiusMi} label={p.neighborhood ?? p.city} />
      </div>
      {p.guarantee ? (
        <div className="sheet px-4 py-3.5">
          <p className="flex items-center gap-2 text-[0.9375rem] font-bold">
            <ShieldCheck size={17} aria-hidden /> Mechanic-provided guarantee
          </p>
          <p className="mt-1 max-w-[62ch] text-[0.9375rem] text-ink">{p.guarantee}</p>
          <p className="mt-1.5 text-[0.8125rem] text-ink-3">Offered by {p.firstName}, not by Clutch.</p>
        </div>
      ) : null}
    </section>
  );
}

export function SelfReported({ p }: { p: PublicMechanicProfile }) {
  const s = p.selfReported;
  return (
    <section aria-labelledby="self-title" className="space-y-4">
      <div className="border-t-2 border-dashed border-pencil pt-3">
        <h2 id="self-title" className="heading text-[1.375rem] text-ink sm:text-[1.5rem]">
          In {p.firstName}&apos;s own words
        </h2>
        <p className="mt-1 flex items-center gap-1.5 text-[0.9375rem] text-pencil">
          <Tick state="self" size={14} /> Entered by {p.firstName}. Not independently verified.
        </p>
      </div>
      <p className="max-w-[65ch] text-[1rem] leading-relaxed text-ink-2">{p.bio}</p>
      {(s.claims.length > 0 || s.yearsExperienceClaim) && (
        <ul className="space-y-1.5">
          {s.yearsExperienceClaim ? (
            <li className="flex items-center gap-2 text-[0.9375rem] text-pencil">
              <Tick state="self" size={14} /> {s.yearsExperienceClaim} years as a mechanic
            </li>
          ) : null}
          {s.claims.map((c) => (
            <li key={c} className="flex items-center gap-2 text-[0.9375rem] text-pencil">
              <Tick state="self" size={14} /> {c}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[0.9375rem] text-ink-2">
        <span className="text-pencil">Says they focus on</span>{" "}
        {s.declaredCategories.map((c) => REPAIR_LABEL[c].toLowerCase()).join(", ")}
        {s.declaredMakes.length ? (
          <>
            {" "}
            <span className="text-pencil">for</span> {s.declaredMakes.join(", ")}
          </>
        ) : null}
        .
      </p>
      {s.repairs.length > 0 && (
        <div>
          <p className="field-label">Past repairs {p.firstName} listed · not yet confirmed</p>
          <ul className="mt-2 border-t border-dashed border-pencil/50">
            {s.repairs.map((w) => (
              <li key={w.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-dashed border-pencil/30 py-2.5">
                <p className="text-[0.9375rem] text-pencil">
                  {w.year} {w.make} {w.model} · {w.title}
                </p>
                <ProvenanceMark detail={repairEvidence(w)} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function MatchingWork({ p, category, make }: { p: PublicMechanicProfile; category?: RepairCategory; make?: VehicleMake }) {
  const items = p.verifiedWork.filter((w) => (!category || w.category === category) && (!make || w.make === make));
  if (!items.length) return null;
  const label = [make, category ? repairNoun(category, 2) : "repairs"].filter(Boolean).join(" ");
  return (
    <section aria-labelledby="matching-work-title" className="space-y-4">
      <SectionHead id="matching-work" title={`Matching work: ${label}`} />
      <WorkList items={items.slice(0, 3)} highlight />
      {items.length > 3 ? (
        <details className="group">
          <summary className="btn btn-quiet cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Show all {items.length}</span>
            <span className="hidden group-open:inline">Show fewer</span>
          </summary>
          <div className="mt-3">
            <WorkList items={items.slice(3)} highlight />
          </div>
        </details>
      ) : null}
    </section>
  );
}
