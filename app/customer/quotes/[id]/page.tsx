import type { Metadata } from "next";
import { StarRating } from "@/components/visual/stars";
import Link from "next/link";
import { ArrowLeft, CalendarClock, Check, MessageCircleQuestion, Minus } from "lucide-react";
import { notFound } from "next/navigation";
import { getRepo } from "@/lib/data";
import { getSession, needs } from "@/lib/session";
import { REPAIR_LABEL, repairNoun } from "@/lib/domain/provenance";
import { dayMonth, plural, rating, usd, WORK_MODEL_LABEL } from "@/lib/format";
import { acceptQuote, askAboutQuote, declineQuote } from "@/app/actions/customer";
import { findArea } from "@/lib/domain/areas";
import { PhotoPrint } from "@/components/profile/photo";
import { EvidenceProvider } from "@/components/trust/evidence-sheet";
import { RepairIcon } from "@/components/visual/icons";
import { VehicleTile } from "@/components/visual/vehicle-glyph";
import { Policies } from "@/components/app/policies";
import { EstimateVersions } from "@/components/app/job-parts";
import { ConfirmButton } from "@/components/app/confirm-button";
import { EligibilityNotice } from "@/components/trust/eligibility-notice";
import { ScreeningList } from "@/components/trust/screening-list";
import { eligibility } from "@/lib/domain/eligibility";
import { inclusions, quoteTotals } from "@/lib/domain/quote";
import { customerSummary } from "@/lib/vehicles/spec";

export const metadata: Metadata = { title: "Written estimate" };

/**
 * A written estimate, laid out as a document: who is doing the work and why
 * they're trusted, what they'll do, when, and every line of the price. Three
 * clear choices at the bottom: approve, ask a question, or decline.
 */
export default async function EstimatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "customer") return null;
  const { id } = await params;
  await (await needs(s)).customerQuote(id);
  const sp = await searchParams;
  const q = repo.getQuote(id);
  if (!q || q.status === "draft") notFound();
  const r = repo.getRequest(q.requestId)!;
  if (r.customerId !== s.customerId) notFound();
  const v = repo.getVehicle(r.vehicleId)!;
  const p = repo.getPublicProfile(repo.getMechanic(q.mechanicId)!.slug)!;
  repo.track("quote_viewed", { actorId: s.customerId, mechanicId: p.id, quoteId: q.id });
  await repo.markQuoteViewed(q.id);
  const others = repo.listQuotesForRequest(r.id).some((x) => x.status === "accepted" && x.id !== q.id);
  const open = q.status === "submitted" && !others && (r.status === "open" || r.status === "quoted");

  const w = p.verifiedWork;
  const cat = w.filter((x) => x.category === r.repairCategory).length;
  const cross = w.filter((x) => x.category === r.repairCategory && x.make === v.make).length;

  const t = quoteTotals(q);
  const inc = inclusions(q);
  const elig = eligibility(p);
  const itemized = q.lineItems?.length ? q.lineItems : null;
  const lines: [string, string, string?][] = [
    ...(itemized
      ? itemized.map((l): [string, string, string?] => [l.label || (l.kind === "labor" ? "Labor" : "Part"), usd(l.cents), l.kind === "part" ? (q.partsIncluded ? "part, fixed price" : "part, estimated, billed at cost") : "labor"])
      : ([
          ["Labor", usd(q.laborCents), `about ${q.durationHours} hrs`],
          ["Parts", q.partsIncluded ? usd(q.partsEstimateCents) : `about ${usd(q.partsEstimateCents)}`, q.partsIncluded ? "included at a fixed price" : "estimate, billed at cost with receipts"],
        ] as [string, string, string?][])),
    ["Diagnostic fee", q.diagnosticFeeCents ? usd(q.diagnosticFeeCents) : "No charge"],
    ["Travel fee", q.travelFeeCents ? usd(q.travelFeeCents) : "No charge"],
  ];
  const where = `At your location${findArea(r.location.area) ? ` in ${findArea(r.location.area)!.label}` : ""}`;

  return (
    <EvidenceProvider mechanicId={p.id} variant="high">
      <div className="mx-auto max-w-[760px]">
        <Link href={`/customer/requests/${r.id}`} className="inline-flex items-center gap-1.5 text-[0.875rem] text-ink-3 hover:text-ink">
          <ArrowLeft size={14} aria-hidden /> Back to your request
        </Link>
        {sp.error ? (
          <p role="alert" className="mt-4 border-l-4 border-alert bg-sheet px-4 py-3 text-[0.9375rem]">
            {sp.error}
          </p>
        ) : null}
        {q.revisions?.length && q.status === "submitted" ? (
          <p className="mt-4 border-l-4 border-brass bg-sheet px-4 py-3 text-[0.9375rem]">
            <span className="font-semibold">
              {p.firstName} revised this estimate (version {q.version ?? 1}
              {q.revisedAt ? `, ${dayMonth(q.revisedAt)}` : ""}).
            </span>{" "}
            You&apos;re reading the current version. Earlier versions are listed at the bottom.
          </p>
        ) : null}
        <article className="sheet perf-top mt-4">
          {/* Document head */}
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-rule px-5 pt-7 pb-5 sm:px-7">
            <div className="flex min-w-0 items-center gap-4">
              <VehicleTile v={v} size="sm" />
              <div className="min-w-0">
                <p className="field-label">Written estimate · {q.id.replace("quote-", "No. ").toUpperCase()}</p>
                <h1 className="display mt-1.5 flex items-center gap-2 text-[1.5rem] sm:text-[1.75rem]">
                  <RepairIcon category={r.repairCategory} size={22} />
                  {REPAIR_LABEL[r.repairCategory]}
                </h1>
                <p className="mt-0.5 text-[0.9375rem] text-ink-2">{customerSummary(v, r.vehicleSpec ?? v.spec)}</p>
              </div>
            </div>
            <p className="text-[0.8125rem] text-ink-3">Issued {dayMonth(q.createdAt)}</p>
          </header>

          {/* Who */}
          <section aria-label="Your mechanic" className="border-b border-rule px-5 py-5 sm:px-7">
            <div className="flex gap-4">
              <PhotoPrint photoUrl={p.photoUrl} initials={p.initials} name={p.displayName} size={72} />
              <div className="min-w-0 flex-1">
                <p className="heading text-[1.1875rem]">{p.displayName}</p>
                <p className="text-[0.875rem] text-ink-2">
                  {WORK_MODEL_LABEL[p.workModel]} · {p.neighborhood ?? p.city}
                </p>
                <div className="mt-2">
                  <ScreeningList p={p} compact />
                </div>
              </div>
            </div>
            <ul className="mt-4 grid gap-x-6 gap-y-1 text-[0.9375rem] sm:grid-cols-2">
              <li>
                <span className={cross ? "highlight px-0.5 font-semibold" : "font-semibold"}>
                  {cross} verified {v.make} {repairNoun(r.repairCategory, cross)}
                </span>
                <span className="text-ink-2"> of {cat} overall</span>
              </li>
              <li className="flex items-center gap-1.5">
                {p.reputation.rating ? (
                  <>
                    <StarRating value={p.reputation.rating.average} size={14} />
                    <span className="font-semibold">{rating(p.reputation.rating.average)}</span>
                    <span className="text-ink-2">from {plural(p.reputation.rating.count, "verified review")}</span>
                  </>
                ) : (
                  <span className="text-ink-3">No verified reviews yet</span>
                )}
              </li>
              <li className="text-ink-2">{plural(p.reputation.verifiedRepairs, "verified repair")} in total</li>
              {p.reputation.repeatCustomers > 0 && <li className="text-ink-2">Rebooked by {plural(p.reputation.repeatCustomers, "customer")}</li>}
            </ul>
            <Link href={`/mechanics/${p.slug}?repair=${r.repairCategory}&make=${encodeURIComponent(v.make)}`} className="link mt-3 inline-block text-[0.875rem] font-semibold">
              See {p.firstName}&apos;s full record
            </Link>
          </section>

          {/* When and where */}
          <section aria-label="Proposed appointment" className="grid gap-4 border-b border-rule px-5 py-4 sm:grid-cols-2 sm:px-7">
            <div>
              <p className="field-label">Proposed time</p>
              <p className="mt-1 flex items-center gap-2 text-[1.0625rem] font-bold">
                <CalendarClock size={18} aria-hidden /> {q.availableOn}
              </p>
            </div>
            <div>
              <p className="field-label">Where</p>
              <p className="mt-1 text-[1.0625rem] font-bold">{where}</p>
              <p className="text-[0.8125rem] text-ink-3">Your exact address is shared only after you book.</p>
            </div>
          </section>

          {/* What */}
          <section className="px-5 py-5 sm:px-7">
            <p className="field-label">Scope of work</p>
            <p className="mt-1 text-[0.9375rem] leading-relaxed">{q.scope}</p>
            {q.notes ? (
              <>
                <p className="field-label mt-4">Notes from {p.firstName}</p>
                <p className="mt-1 text-[0.9375rem] leading-relaxed text-ink-2">{q.notes}</p>
              </>
            ) : null}
          </section>

          {/* Price */}
          <dl className="border-t border-rule px-5 sm:px-7">
            {lines.map(([k, val, note]) => (
              <div key={k} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-rule-soft py-2.5">
                <dt>
                  {k}
                  {note ? <span className="block text-[0.8125rem] text-ink-3">{note}</span> : null}
                </dt>
                <dd className="tnum font-semibold">{val}</dd>
              </div>
            ))}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline py-4">
              <dt className="heading text-[1.125rem]">Estimated total</dt>
              <dd className="num text-[2rem]">{t.planFor}</dd>
            </div>
          </dl>
          <p className={`mx-5 mb-4 border px-3 py-2 text-[0.9375rem] font-semibold sm:mx-7 ${q.partsIncluded ? "border-ink" : "border-amber bg-amber-wash text-amber"}`}>
            {t.partsLine}
            {!q.partsIncluded ? <span className="block text-[0.8125rem] font-normal text-ink">The total can go up or down with the real parts cost.</span> : null}
          </p>
          <div className="grid gap-4 border-t border-rule-soft px-5 py-4 sm:grid-cols-2 sm:px-7">
            <div>
              <p className="field-label">Included</p>
              <ul className="mt-1.5 space-y-1 text-[0.875rem]">
                {inc.included.map((x) => (
                  <li key={x} className="flex gap-1.5">
                    <Check size={15} className="mt-0.5 shrink-0" aria-hidden /> {x}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="field-label">Not included</p>
              <ul className="mt-1.5 space-y-1 text-[0.875rem] text-ink-2">
                {inc.notIncluded.map((x) => (
                  <li key={x} className="flex gap-1.5">
                    <Minus size={15} className="mt-0.5 shrink-0" aria-hidden /> {x}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {q.assumptions ? (
            <p className="border-t border-rule-soft px-5 py-3 text-[0.875rem] sm:px-7">
              <span className="font-semibold">This price assumes:</span> <span className="text-ink-2">{q.assumptions}</span>
            </p>
          ) : null}
          {q.alternates?.length ? (
            <div className="border-t border-rule-soft px-5 py-3 sm:px-7">
              <p className="field-label">If diagnosis finds something else</p>
              <ul className="mt-1.5 space-y-1 text-[0.9375rem]">
                {q.alternates.map((a) => (
                  <li key={a.label} className="flex justify-between gap-3">
                    <span>{a.label}</span>
                    <span className="tnum shrink-0 font-semibold">{usd(a.laborCents + a.partsCents + q.diagnosticFeeCents + q.travelFeeCents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="border-t border-rule-soft bg-paper/60 px-5 py-3 text-[0.875rem] text-ink-2 sm:px-7">
            <span className="font-semibold text-ink">Final scope may change after diagnosis.</span> If {p.firstName} finds something else, they must send you a revised estimate. Nothing extra is done without your approval.
          </p>

          {/* Questions */}
          {q.customerQuestions.length > 0 && (
            <section aria-label="Questions about this estimate" className="border-t border-rule px-5 py-4 sm:px-7">
              <p className="field-label">Your questions</p>
              <ul className="mt-2 space-y-3">
                {q.customerQuestions.map((x) => (
                  <li key={x.askedAt} className="text-[0.9375rem]">
                    <p className="font-semibold">{x.question}</p>
                    {x.answer ? (
                      <p className="mt-0.5 text-ink-2">
                        <span className="font-semibold text-ink">{p.firstName}:</span> {x.answer}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-ink-3">Waiting for {p.firstName} to answer.</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-label="Before you choose" className="border-t border-rule px-5 py-4 sm:px-7">
            <p className="field-label mb-3">Before you choose</p>
            <Policies firstName={p.firstName} guarantee={p.guarantee} />
            {q.expiresOn ? <p className="mt-3 text-[0.8125rem] text-ink-3">This estimate is valid until {dayMonth(q.expiresOn)}.</p> : null}
          </section>

          {/* Decide */}
          <footer className="border-t border-dashed border-rule px-5 py-5 sm:px-7">
            {q.status === "accepted" ? (
              <p className="font-semibold text-ink">
                You accepted version {q.acceptedVersion ?? q.version ?? 1}
                {q.acceptedAt ? ` on ${dayMonth(q.acceptedAt)}` : ""}. {p.firstName} is booked. An accepted estimate can&apos;t be changed; extra work needs your approval on the repair page.
              </p>
            ) : q.status === "withdrawn" ? (
              <p className="text-ink-2">{p.firstName} withdrew this estimate. It can&apos;t be accepted.</p>
            ) : q.status === "expired" ? (
              <p className="text-ink-2">This estimate expired.</p>
            ) : q.status === "declined" && q.closedReason === "request_cancelled" ? (
              <p className="text-ink-2">You cancelled this request, so this estimate is closed.</p>
            ) : q.status === "declined" && q.closedReason === "customer_declined" ? (
              <p className="text-ink-2">You declined this estimate.</p>
            ) : !open ? (
              <p className="text-ink-3">You chose a different mechanic for this job.</p>
            ) : (
              <div className="space-y-4">
                <EligibilityNotice e={elig} />
                {elig.eligible && !elig.fullyVerified ? (
                  <div className="space-y-2">
                    <Link href={`/customer/quotes/${q.id}/book`} className="btn btn-ink min-h-12 w-full text-[1rem]">
                      Review verification and book {p.firstName}
                    </Link>
                    <p className="text-[0.8125rem] text-ink-3">Next, you&apos;ll see exactly which checks Clutch hasn&apos;t verified and confirm before booking. No payment is taken on Clutch.</p>
                  </div>
                ) : (
                <form action={acceptQuote.bind(null, q.id)} className="space-y-2">
                  {/* The version being read. If the mechanic revises it meanwhile, accepting is refused and the new version shown. */}
                  <input type="hidden" name="version" value={q.version ?? 1} />
                  <ConfirmButton
                    disabled={!elig.eligible}
                    message={`Book ${p.firstName} for ${q.availableOn}?\n\nEstimated total: ${t.planFor}\n${t.partsLine}\n\n${p.firstName} gets your address and access notes. Other mechanics are told you chose someone else.`}
                    className="btn btn-ink min-h-12 w-full text-[1rem] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Accept and book {p.firstName}
                  </ConfirmButton>
                  <p className="text-[0.8125rem] text-ink-3">No payment is taken on Clutch. You pay {p.firstName} directly after the work.</p>
                </form>
                )}
                <details className="group border border-rule">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center gap-2 px-3 text-[0.9375rem] font-semibold [&::-webkit-details-marker]:hidden">
                    <MessageCircleQuestion size={17} aria-hidden /> Ask {p.firstName} a question
                  </summary>
                  <form action={askAboutQuote.bind(null, q.id)} className="border-t border-rule-soft p-3">
                    <label className="block">
                      <span className="field-label">Your question</span>
                      <textarea name="question" required rows={3} className="input mt-1 w-full" placeholder="e.g. Are OEM rotors included? Can you come earlier?" />
                    </label>
                    <button className="btn btn-line mt-2 min-h-11 w-full">Send question</button>
                  </form>
                </details>
                <form action={declineQuote.bind(null, q.id)}>
                  <ConfirmButton message={`Decline ${p.firstName}'s estimate? They'll be told you went with another option.`} className="btn btn-quiet min-h-11 w-full text-ink-2">
                    Decline this estimate
                  </ConfirmButton>
                </form>
              </div>
            )}
            {q.revisions?.length ? (
              <div className="mt-5 border-t border-rule-soft pt-4">
                <EstimateVersions q={q} viewer="customer" />
              </div>
            ) : null}
          </footer>
        </article>
        <p className="mt-4 text-center text-[0.8125rem] text-ink-3">
          Something wrong with this estimate? <Link href={`/customer/help?request=${r.id}`} className="link">Report it to Clutch staff</Link>. They reply in the app.
        </p>
      </div>
    </EvidenceProvider>
  );
}
