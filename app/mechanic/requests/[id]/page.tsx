import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { ready, repo } from "@/lib/data";
import { getSession } from "@/lib/session";
import { REPAIR_LABEL, repairNoun } from "@/lib/domain/provenance";
import { jobStatus, vehicleLine } from "@/lib/domain/intake";
import { findArea, milesBetween } from "@/lib/domain/areas";
import { toPublicProfile } from "@/lib/domain/public-profile";
import { dayMonth, usd } from "@/lib/format";
import { eligibility } from "@/lib/domain/eligibility";
import { quoteReadiness } from "@/lib/domain/readiness";
import { quoteTotals } from "@/lib/domain/quote";
import { daysAgo } from "@/lib/domain/availability";
import { askQuestion, declineRequest, markInterested, type EstimateInput } from "@/app/actions/mechanic";
import { EstimateBuilder } from "@/components/mechanic/estimate-builder";
import { EligibilityNotice } from "@/components/trust/eligibility-notice";
import { ReadinessBadge } from "@/components/request/readiness";
import { DeclineForm } from "@/components/mechanic/decline-form";
import { NeedsPersona, Notice } from "@/components/workspace/ui";
import { RequestSummary, StatusBadge } from "@/components/request/request-summary";
import { MediaThumb } from "@/components/request/media-capture";

export const metadata: Metadata = { title: "Repair request" };

export default async function RequestDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ blocked?: string; sent?: string }> }) {
  await ready();
  const s = await getSession();
  if (s.role !== "mechanic") return <NeedsPersona role="mechanic" />;
  const { id } = await params;
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
  const mk = p.verifiedWork.filter((w) => w.make === v.make).length;
  const cross = p.verifiedWork.filter((w) => w.category === r.repairCategory && w.make === v.make).length;
  const history = repo.listCustomerHistory(r.customerId).filter((h) => h.mechanicId === s.mechanicId);
  const fixed = m.fixedPrices.find((f) => f.repairCategory === r.repairCategory);
  const declined = r.declinedBy.includes(s.mechanicId);
  const myInterest = r.interested.find((i) => i.mechanicId === s.mechanicId);
  const myQuestions = r.questions.filter((q) => q.mechanicId === s.mechanicId);
  const area = findArea(r.location.area);
  const status = jobStatus(r);
  const canRespond = !mine && !declined;
  const inAWeek = daysAgo(-7);
  const initial: EstimateInput = draft
    ? {
        lines: draft.lineItems?.length
          ? draft.lineItems
          : [{ id: "l0", kind: "labor", label: "Labor", cents: draft.laborCents }, ...(draft.partsEstimateCents ? [{ id: "l1", kind: "part" as const, label: "Parts", cents: draft.partsEstimateCents }] : [])],
        diagnosticFeeCents: draft.diagnosticFeeCents,
        travelFeeCents: draft.travelFeeCents,
        partsIncluded: draft.partsIncluded,
        durationHours: draft.durationHours,
        availableOn: draft.availableOn,
        serviceMode: draft.serviceMode,
        scope: draft.scope,
        notes: draft.notes ?? "",
        expiresOn: draft.expiresOn ?? inAWeek,
        assumptions: draft.assumptions ?? "",
        exclusions: draft.exclusions ?? "",
        alternates: draft.alternates ?? [],
      }
    : {
        lines: [{ id: "l0", kind: "labor", label: fixed?.label ?? `${REPAIR_LABEL[r.repairCategory]} labor`, cents: fixed?.laborCents ?? m.hourlyRateCents * 2 }],
        diagnosticFeeCents: m.diagnosticFeeCents,
        travelFeeCents: m.travelFeeCents ?? 0,
        partsIncluded: false,
        durationHours: 2,
        availableOn: m.nextAvailable,
        serviceMode: m.workModel === "shop" || r.location.serviceMode === "shop" ? "shop" : "mobile",
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
          <h1 className="display text-[1.875rem] sm:text-[2.25rem]">{vehicleLine(v)}</h1>
          <p className="mt-1 text-ink-2">
            {c?.displayName} · posted {dayMonth(r.createdAt)}
          </p>
        </div>
        <StatusBadge tone={status.tone}>{status.headline}</StatusBadge>
      </div>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <RequestSummary r={r} v={v} distanceMi={area ? milesBetween(m, area) : undefined} revealPrivate={booked} audience="mechanic" showTitle={false} />

        <aside className="space-y-6">
          {sp.sent ? <Notice tone="ok">Estimate sent. {first} gets a notification and sees it next to your verified record.</Notice> : null}
          {canRespond ? (
            <div className="border-2 border-ink p-4">
              <p className="field-label">Next step</p>
              <p className="heading mt-1 text-[1.125rem]">{readiness.level === "ask" ? `Ask ${first} before quoting` : draft ? "Finish and send your estimate" : "Write an estimate"}</p>
              <div className="mt-3">
                <ReadinessBadge readiness={readiness} />
              </div>
              <a href={readiness.level === "ask" ? "#ask" : "#estimate"} className="btn btn-ink mt-3 min-h-11 w-full">
                {readiness.level === "ask" ? "Ask a question" : draft ? "Go to your draft" : "Start the estimate"}
              </a>
            </div>
          ) : null}
          <p className="text-[0.875rem] text-ink-2">
            Sent to you for your verified {REPAIR_LABEL[r.repairCategory].toLowerCase()} and {v.make} experience: {cat} {repairNoun(r.repairCategory, cat)}, {mk} on {v.make}
            {cross ? ` (${cross} both)` : ""}. The customer sees your estimate next to that record.
          </p>
          {history.length ? (
            <Notice tone="ok">
              Returning customer: you&apos;ve done {history.length} {history.length === 1 ? "job" : "jobs"} for {first}, most recently {history[0].title.toLowerCase()} on their {history[0].model}.
            </Notice>
          ) : null}

          {/* Questions before quoting */}
          <section id="ask" className="scroll-mt-24 space-y-3">
            <h2 className="heading text-[1.125rem]">Questions for {first}</h2>
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
                <textarea
                  name="question"
                  required
                  rows={2}
                  className="input"
                  placeholder="e.g. Can you send a video of what happens when you press Start? Do the headlights dim when you try?"
                  aria-label={`Ask ${first} a question`}
                />
                <button className="btn btn-line min-h-11 text-sm">Ask {first}</button>
                <p className="text-[0.8125rem] text-ink-3">You don&apos;t need to quote first. {first} can reply with photos, video or audio.</p>
              </form>
            ) : null}
          </section>

          {canRespond &&
            (myInterest ? (
              <p className="border border-ink bg-sheet px-4 py-3 text-[0.9375rem]">
                You told {first} you&apos;re interested and available to help{myInterest.note ? `: “${myInterest.note}”` : "."} Send an estimate when you&apos;re ready.
              </p>
            ) : (
              <form action={markInterested.bind(null, r.id)} className="sheet space-y-2 p-4">
                <p className="text-[0.9375rem] font-bold">Interested, but not ready to quote?</p>
                <input name="note" className="input" placeholder="e.g. Available Saturday. I'd want to test the starter circuit first." aria-label="Note to the customer" />
                <button className="btn btn-quiet min-h-11 text-sm">I&apos;m interested in this job</button>
              </form>
            ))}

          {canRespond ? (
            <DeclineForm
              action={declineRequest.bind(null, r.id)}
              summary="Can't take this job?"
              note={
                r.requestedMechanicId === s.mechanicId
                  ? `${first} asked for you. We'll tell them you can't take it, share your reason if you pick one, and suggest other mechanics.`
                  : `It leaves your list. ${first} is only told if no one else can take it. Any reason you pick is shared with them.`
              }
              confirm={`Decline this request from ${first}?`}
              submit="Decline this request"
            />
          ) : null}
        </aside>
      </div>
      <section id="estimate" className="scroll-mt-24 border-t-2 border-ink pt-6">
        {declined ? (
          <Notice>You declined this request.</Notice>
        ) : mine ? (
          <div className="sheet p-5">
            <p className="field-label">Your estimate · {mine.status === "submitted" ? "sent" : mine.status === "accepted" ? "approved" : "not chosen"}</p>
            <p className="num mt-2 text-[2.5rem]">{quoteTotals(mine).planFor}</p>
            <p className="text-ink-2">
              estimated total · {usd(mine.laborCents)} labor · {mine.durationHours} hrs · {mine.availableOn}
            </p>
            <p className="mt-1 text-[0.875rem] font-semibold">{quoteTotals(mine).partsLine}</p>
            <p className="mt-1 text-[0.8125rem] text-ink-3">{mine.viewedAt ? `${first} viewed it ${dayMonth(mine.viewedAt)}` : `${first} hasn't opened it yet`}</p>
            <p className="mt-3 text-[0.9375rem] text-ink">{mine.scope}</p>
            {booked ? <p className="mt-3 text-[0.875rem] font-semibold">Booked: the address and access details are now shown in the request.</p> : null}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <h2 className="heading text-[1.25rem]">{draft ? "Your draft estimate" : "Write your estimate"}</h2>
              <p className="mt-1 text-[0.875rem] text-ink-2">Your price, your call. Other mechanics never see your estimate, and you never see theirs.</p>
            </div>
            <EligibilityNotice e={elig} audience="mechanic" />
            <EstimateBuilder
              requestId={r.id}
              customerFirst={first}
              initial={initial}
              hourlyRateCents={m.hourlyRateCents}
              canSend={elig.eligible}
              blockedReason={elig.eligible ? undefined : "You can keep writing and your draft saves, but sending is paused until your screening is current."}
              mobileAllowed={m.workModel !== "shop"}
              shopAllowed={m.workModel !== "mobile"}
            />
          </div>
        )}
      </section>
    </div>
  );
}
