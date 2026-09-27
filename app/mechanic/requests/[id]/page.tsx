import { vehicleSpecOf } from "@/lib/vehicles/effective";
import { VehicleBrief } from "@/components/vehicle/vehicle-brief";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { notFound } from "next/navigation";
import { getRepo } from "@/lib/data";
import { getSession, needs } from "@/lib/session";
import { REPAIR_LABEL, repairNoun } from "@/lib/domain/provenance";
import { vehicleLine } from "@/lib/domain/intake";
import { journey } from "@/lib/domain/journey";
import { JourneyStatus } from "@/components/app/journey-status";
import { JobBrief, type MatchEvidence } from "@/components/request/job-brief";
import { findArea, milesBetween } from "@/lib/domain/areas";
import { toPublicProfile } from "@/lib/domain/public-profile";
import { dayMonth, usd } from "@/lib/format";
import { eligibility } from "@/lib/domain/eligibility";
import { quoteReadiness } from "@/lib/domain/readiness";
import { quoteTotals } from "@/lib/domain/quote";
import { daysAgo } from "@/lib/domain/availability";
import { parseSlotText, parseTime } from "@/lib/domain/schedule";
import { today } from "@/lib/verification/lifecycle";
import { askQuestion, declineRequest, markInterested, type EstimateInput } from "@/app/actions/mechanic";
import { EstimateBuilder } from "@/components/mechanic/estimate-builder";
import { EligibilityNotice } from "@/components/trust/eligibility-notice";
import { DeclineForm } from "@/components/mechanic/decline-form";
import { NeedsPersona, Notice } from "@/components/workspace/ui";
import { RequestSummary } from "@/components/request/request-summary";
import { MediaThumb } from "@/components/request/media-capture";

export const metadata: Metadata = { title: "Repair request" };

export default async function RequestDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ blocked?: string; sent?: string; error?: string }> }) {
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "mechanic") return <NeedsPersona role="mechanic" />;
  const { id } = await params;
  await (await needs(s)).mechanicRequest(id);
  const sp = await searchParams;
  const r = repo.getRequest(id);
  if (!r || !r.matchedMechanicIds.includes(s.mechanicId)) notFound();
  const v = repo.getVehicle(r.vehicleId)!;
  const c = repo.getCustomer(r.customerId);
  const first = c?.displayName.split(" ")[0] ?? "the customer";
  const m = repo.getMechanic(s.mechanicId)!;
  const quote = repo.listQuotesForRequest(r.id).find((q) => q.mechanicId === s.mechanicId);
  const draft = quote?.status === "draft" ? quote : undefined;
  const mine = quote && quote.status !== "draft" ? quote : undefined;
  const booked = mine?.status === "accepted";
  const p = toPublicProfile(repo.getMechanicSources(s.mechanicId));
  const elig = eligibility(p);
  const readiness = quoteReadiness(r, v);
  const cat = p.verifiedWork.filter((w) => w.category === r.repairCategory).length;
  const cross = p.verifiedWork.filter((w) => w.category === r.repairCategory && w.make === v.make).length;
  const history = repo.listCustomerHistory(r.customerId).filter((h) => h.mechanicId === s.mechanicId);
  const fixed = m.fixedPrices.find((f) => f.repairCategory === r.repairCategory);
  const declined = r.declinedBy.includes(s.mechanicId);
  const myInterest = r.interested.find((i) => i.mechanicId === s.mechanicId);
  const myQuestions = r.questions.filter((q) => q.mechanicId === s.mechanicId);
  const area = findArea(r.location.area);
  const job = repo.listJobsForMechanic(s.mechanicId).find((x) => x.requestId === r.id);
  const j = journey({ request: r, quotes: repo.listQuotesForRequest(r.id), job, audience: "mechanic", mechanicId: s.mechanicId, names: { customer: first, mechanic: m.firstName } });
  // Why it came to them, on the shared five-level scale: verified work first, then what they list.
  const make = v.make;
  const match: MatchEvidence = cross
    ? { level: "verified", text: `${cross} verified ${make} ${repairNoun(r.repairCategory, cross)}` }
    : cat
      ? { level: "verified", text: `${cat} verified ${repairNoun(r.repairCategory, cat)}` }
      : m.declaredRepairCategories.includes(r.repairCategory)
        ? { level: "self_reported", text: `You list ${REPAIR_LABEL[r.repairCategory].toLowerCase()} on your profile` }
        : { level: "inferred", text: `Your verified ${make} work and your area` };
  const canRespond = !mine && !declined;
  // "Interested" and the estimate are one step: interest (or a saved draft) opens the estimate box.
  const interested = canRespond && Boolean(myInterest || draft);
  const inAWeek = daysAgo(-7);
  // Offer the mechanic's own posted openings as one-tap times.
  const openingSlots = p.openings
    .filter((o) => o.on >= today())
    .slice(0, 4)
    .map((o) => ({ date: o.on, time: parseTime(o.time) ?? "09:00" }));
  const firstOpening = openingSlots[0];
  // A draft continues where it was left; a sent (not yet accepted) estimate can be revised from itself.
  const base = draft ?? (mine?.status === "submitted" ? mine : undefined);
  const initial: EstimateInput = base
    ? {
        lines: base.lineItems?.length
          ? base.lineItems
          : [{ id: "l0", kind: "labor", label: "Labor", cents: base.laborCents }, ...(base.partsEstimateCents ? [{ id: "l1", kind: "part" as const, label: "Parts", cents: base.partsEstimateCents }] : [])],
        diagnosticFeeCents: base.diagnosticFeeCents,
        travelFeeCents: base.travelFeeCents,
        partsIncluded: base.partsIncluded,
        durationHours: base.durationHours,
        availableOn: base.availableOn,
        availableDate: (base.availableAt ?? parseSlotText(base.availableOn, today()))?.date ?? "",
        availableTime: (base.availableAt ?? parseSlotText(base.availableOn, today()))?.time ?? "",
        serviceMode: "mobile",
        scope: base.scope,
        notes: base.notes ?? "",
        expiresOn: base.expiresOn ?? inAWeek,
        assumptions: base.assumptions ?? "",
        exclusions: base.exclusions ?? "",
        alternates: base.alternates ?? [],
      }
    : {
        lines: [{ id: "l0", kind: "labor", label: fixed?.label ?? `${REPAIR_LABEL[r.repairCategory]} labor`, cents: fixed?.laborCents ?? m.hourlyRateCents * 2 }],
        diagnosticFeeCents: m.diagnosticFeeCents,
        travelFeeCents: m.travelFeeCents ?? 0,
        partsIncluded: false,
        durationHours: 2,
        availableOn: m.nextAvailable,
        availableDate: firstOpening?.date ?? "",
        availableTime: firstOpening?.time ?? "",
        serviceMode: "mobile",
        scope: "",
        notes: "",
        expiresOn: inAWeek,
        assumptions: "",
        exclusions: "",
        alternates: [],
      };

  return (
    <div className="space-y-6">
      <Link href="/mechanic/requests" className="inline-flex items-center gap-1.5 text-[0.875rem] text-ink-3 hover:text-ink">
        <ArrowLeft size={14} aria-hidden /> Requests
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-ink pb-4">
        <div>
          <h1 className="display text-[2rem] sm:text-[2.25rem]">{vehicleLine(v)}</h1>
          <p className="mt-1 text-ink-2">
            {first} · posted {dayMonth(r.createdAt)}
            {v.mileage ? ` · ${Math.round(v.mileage / 1000)}k mi` : ""}
          </p>
        </div>
      </div>

      {sp.error ? (
        <Notice tone="error">
          {sp.error}
        </Notice>
      ) : null}
      {sp.sent ? <Notice tone="ok">Estimate sent. {first} gets a notification and sees it next to your verified record.</Notice> : null}

      <JourneyStatus j={j} audience="mechanic" names={{ customer: first, mechanic: m.firstName }} />
      <VehicleBrief v={v} spec={vehicleSpecOf(v, r.vehicleSpec)} audience="mechanic" warn={canRespond ? "quote" : undefined} showVinTail={booked} />
      <JobBrief r={r} distanceMi={area ? milesBetween(m, area) : undefined} match={match} />

      {/* Your response: decide, then the estimate, as one connected step. */}
      <section id="estimate" aria-labelledby="respond-title" className="scroll-mt-20">
        {declined ? (
          <Notice>You declined this request.</Notice>
        ) : mine ? (
          <div className="border-2 border-brand-deep bg-sheet">
            <p className="flex items-center gap-2 bg-brand-deep px-5 py-3 font-bold text-on-brand">
              <Check size={18} className="text-brass" aria-hidden />
              <span id="respond-title">
                Estimate{" "}
                {mine.status === "submitted"
                  ? `sent${(mine.version ?? 1) > 1 ? ` (version ${mine.version})` : ""}`
                  : mine.status === "accepted"
                    ? `approved (version ${mine.acceptedVersion ?? mine.version ?? 1})`
                    : mine.status === "withdrawn"
                      ? "withdrawn"
                      : "not chosen"}
              </span>
            </p>
            <div className="p-5">
              <p className="num text-[2.5rem]">{quoteTotals(mine).planFor}</p>
              <p className="text-ink-2">
                estimated total · {usd(mine.laborCents)} labor · {mine.durationHours} hrs · {mine.availableOn}
              </p>
              <p className="mt-1 text-[0.875rem] font-semibold">{quoteTotals(mine).partsLine}</p>
              <p className="mt-1 text-[0.8125rem] text-ink-3">{mine.viewedAt ? `${first} viewed it ${dayMonth(mine.viewedAt)}` : `${first} hasn't opened it yet`}</p>
              <p className="mt-3 text-[0.9375rem]">{mine.scope}</p>
              {booked ? <p className="mt-3 text-[0.875rem] font-semibold">Booked: the address and access details are now shown below.</p> : null}
              {mine.status === "submitted" && elig.eligible ? (
                <details className="mt-4 border-t border-rule-soft pt-3">
                  <summary className="min-h-11 cursor-pointer content-center font-semibold">Revise this estimate</summary>
                  <p className="mt-1 text-[0.875rem] text-ink-2">
                    {first} sees it as a new version, with this one kept. They have to accept the new version; once they accept, the estimate can&apos;t be changed.
                  </p>
                  <div className="mt-3">
                    <EstimateBuilder
                      requestId={r.id}
                      customerFirst={first}
                      initial={initial}
                      hourlyRateCents={m.hourlyRateCents}
                      canSend
                      openings={openingSlots}
                      revising
                    />
                  </div>
                </details>
              ) : booked ? (
                <p className="mt-2 text-[0.8125rem] text-ink-3">An accepted estimate can&apos;t be changed. Extra work needs {first}&apos;s approval from the job page.</p>
              ) : null}
            </div>
          </div>
        ) : interested ? (
          <div className="border-2 border-brand-deep bg-sheet">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-brand-deep px-5 py-3 text-on-brand">
              <p className="flex items-center gap-2 font-bold">
                <Check size={18} className="text-brass" aria-hidden />
                <span id="respond-title">You&apos;re interested</span>
                <span className="font-normal text-on-brand-2">· {first} has been told. Now send your estimate.</span>
              </p>
              <a href="#not-interested" className="text-[0.875rem] text-on-brand-2 underline decoration-on-brand-2/50 underline-offset-2 hover:text-on-brand">
                Not interested anymore?
              </a>
            </div>
            <div className="space-y-4 p-4 sm:p-6">
              <h2 className="heading text-[1.5rem] sm:text-[1.75rem]">{draft ? "Finish your estimate" : "Your estimate"}</h2>
              <EligibilityNotice e={elig} audience="mechanic" />
              <EstimateBuilder
                requestId={r.id}
                customerFirst={first}
                initial={initial}
                hourlyRateCents={m.hourlyRateCents}
                canSend={elig.eligible}
                blockedReason={elig.eligible ? undefined : `You can keep writing and your draft saves. Finish your profile to send it: ${elig.missing.map((x) => x.label.toLowerCase()).join(", ")}.`}
                openings={openingSlots}
              />
            </div>
          </div>
        ) : canRespond ? (
          <div className="border-2 border-ink bg-sheet p-5 sm:p-6">
            <h2 id="respond-title" className="heading text-[1.5rem] sm:text-[1.75rem]">
              Can you take this job?
            </h2>
            {readiness.level === "ask" ? (
              <p className="mt-1 text-ink-2">
                Some details are missing:{" "}
                <a href="#ask" className="font-semibold text-ink underline decoration-rule underline-offset-2">
                  ask {first} first
                </a>
                .
              </p>
            ) : null}
            <div className="mt-5 grid gap-3 sm:grid-cols-2 sm:items-start">
              <form action={markInterested.bind(null, r.id)}>
                <button className="btn btn-ink min-h-16 w-full text-[1.0625rem]">
                  <Check size={20} aria-hidden /> I&apos;m interested
                </button>
                <p className="mt-1.5 text-center text-[0.8125rem] text-ink-3">Opens your estimate</p>
              </form>
              <DeclineForm
                big
                action={declineRequest.bind(null, r.id)}
                summary="Not interested"
                note={
                  r.requestedMechanicId === s.mechanicId
                    ? `${first} asked for you. We'll tell them and suggest other mechanics.`
                    : `It leaves your list. ${first} is only told if no one else can take it.`
                }
                confirm={`Decline this request from ${first}?`}
                submit="Decline this request"
              />
            </div>
          </div>
        ) : null}
      </section>

      {history.length ? (
        <Notice tone="ok">
          Returning customer: you&apos;ve done {history.length} {history.length === 1 ? "job" : "jobs"} for {first}, most recently {history[0].title.toLowerCase()} on their {history[0].model}.
        </Notice>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <h2 className="heading mb-3 text-[1.25rem]">Full request</h2>
          <RequestSummary r={r} v={v} distanceMi={area ? milesBetween(m, area) : undefined} revealPrivate={booked} audience="mechanic" showTitle={false} briefShown />
        </div>

        <aside className="space-y-6">
          {/* Questions before quoting */}
          <section id="ask" className="scroll-mt-24 space-y-3">
            <h2 className="heading text-[1.25rem]">Questions for {first}</h2>
            {myQuestions.map((q) => (
              <div key={q.askedAt + q.question} className="border-t border-rule-soft pt-3 text-[0.9375rem]">
                <p>
                  <span className="font-semibold">You:</span> {q.question}
                </p>
                {q.response || q.attachments.length ? (
                  <div className="mt-1.5">
                    {q.response ? (
                      <p className="text-ink-2">
                        <span className="font-semibold text-ink">{first}:</span> {q.response}
                      </p>
                    ) : null}
                    {q.attachments.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {q.attachments.map((a) => (
                          <MediaThumb key={a.id} m={a} size={84} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-1 text-ink-3">Waiting for {first}&apos;s reply.</p>
                )}
              </div>
            ))}
            {canRespond ? (
              <form action={askQuestion.bind(null, r.id)} className="space-y-2">
                <textarea name="question" required rows={2} className="input" placeholder="e.g. When you press Start, is there a click, a whir, or nothing at all?" aria-label={`Ask ${first} a question`} />
                <button className="btn btn-line min-h-11 text-sm">Ask {first}</button>
              </form>
            ) : null}
          </section>

          {interested && canRespond ? (
            <div id="not-interested" className="scroll-mt-24">
              <DeclineForm
                action={declineRequest.bind(null, r.id)}
                summary="Not interested anymore?"
                note={
                  r.requestedMechanicId === s.mechanicId
                    ? `${first} asked for you. We'll tell them and suggest other mechanics.`
                    : `It leaves your list. ${first} is only told if no one else can take it.`
                }
                confirm={`Decline this request from ${first}?`}
                submit="Decline this request"
              />
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
