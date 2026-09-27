import type { Metadata } from "next";
import { StarRating } from "@/components/visual/stars";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ArrowLeft, Check, Clock3, Pencil, RefreshCw, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { getRepo } from "@/lib/data";
import { getSession, needs } from "@/lib/session";
import { repairNoun } from "@/lib/domain/provenance";
import { dayMonth, plural } from "@/lib/format";
import { EvidenceProvider } from "@/components/trust/evidence-sheet";
import { PhotoPrint } from "@/components/profile/photo";
import { RequestSummary } from "@/components/request/request-summary";
import { QuestionReply } from "@/components/request/question-reply";
import { MediaThumb } from "@/components/request/media-capture";
import { primarySymptom, urgencyLabel, vehicleLine } from "@/lib/domain/intake";
import { REPAIR_LABEL } from "@/lib/domain/provenance";
import { isWaitingForMatch } from "@/lib/domain/status";
import { ConfirmButton } from "@/components/app/confirm-button";
import { cancelRequest, rematchRequest } from "@/app/actions/customer";
import type { RepairRequest, Vehicle } from "@/lib/domain/types";
import { findArea } from "@/lib/domain/areas";
import { topPicks } from "@/lib/domain/recommend";
import { eligibility, notBookableStatus, screeningSummary } from "@/lib/domain/eligibility";
import { quoteTotals } from "@/lib/domain/quote";
import { HandoffNote, ReplacementPanel } from "@/components/request/replacement-panel";
import { replacementFor } from "@/lib/replacement";
import { Notice } from "@/components/workspace/ui";
import { journey } from "@/lib/domain/journey";
import { JourneyStatus } from "@/components/app/journey-status";
import { emailAlertsOn } from "@/lib/notify/config";

export const metadata: Metadata = { title: "Your shortlist" };

export default async function CompareQuotes({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edited?: string; cancelled?: string; checked?: string; error?: string }>;
}) {
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "customer") return null;
  const { id } = await params;
  await (await needs(s)).customerRequest(id);
  const sp = await searchParams;
  const r = repo.getRequest(id);
  if (!r || r.customerId !== s.customerId) notFound();
  const v = repo.getVehicle(r.vehicleId)!;
  const quotes = repo.listQuotesForRequest(r.id);
  const withProfiles = quotes
    .map((q) => {
      const m = repo.getMechanic(q.mechanicId)!;
      const p = repo.getPublicProfile(m.slug)!;
      const w = p.verifiedWork;
      const rel = [
        w.filter((x) => x.category === r.repairCategory && x.make === v.make).length,
        w.filter((x) => x.category === r.repairCategory).length,
        p.reputation.verifiedRepairs,
      ];
      return { q, p, rel };
    })
    // Ordered by relevant verified experience. Never by price.
    .sort((a, b) => b.rel[0] - a.rel[0] || b.rel[1] - a.rel[1] || b.rel[2] - a.rel[2]);
  const interestedOnly = r.interested
    .filter((i) => !quotes.some((q) => q.mechanicId === i.mechanicId) && !r.declinedBy.includes(i.mechanicId))
    .map((i) => ({ i, p: repo.getPublicProfile(repo.getMechanic(i.mechanicId)!.slug)! }));
  const pending = r.matchedMechanicIds.filter(
    (mid) => !quotes.some((q) => q.mechanicId === mid) && !r.declinedBy.includes(mid) && !r.interested.some((i) => i.mechanicId === mid),
  ).length;
  const openQuestions = r.questions.map((q, idx) => ({ q, idx, m: repo.getMechanic(q.mechanicId)! }));
  const unanswered = openQuestions.filter(({ q }) => !q.response && !q.attachments.length).length;
  const ctx = `repair=${r.repairCategory}&make=${encodeURIComponent(v.make)}`;
  const accepted = quotes.find((q) => q.status === "accepted");
  const job = accepted ? repo.listJobsForCustomer(s.customerId).find((j) => j.quoteId === accepted.id) : undefined;
  const sentQuotes = quotes.filter((q) => q.status !== "draft");
  const picks = topPicks(
    withProfiles
      .filter(({ q, p }) => q.status === "submitted" && eligibility(p).eligible)
      .map(({ q, p }) => ({
        q,
        p,
        cross: p.verifiedWork.filter((x) => x.category === r.repairCategory && x.make === v.make).length,
        cat: p.verifiedWork.filter((x) => x.category === r.repairCategory).length,
        mk: p.verifiedWork.filter((x) => x.make === v.make).length,
        mdl: 0,
      })),
    { repair: r.repairCategory, make: v.make },
  );
  const replacement = await replacementFor(repo, r);
  const lastHandoff = (r.handoffs ?? []).at(-1);
  // A quiet "sent to…" note until the mechanics it was sent on to respond.
  const handoffPending =
    !replacement && lastHandoff
      ? lastHandoff.to.filter(
          (mid) =>
            !r.declinedBy.includes(mid) && !quotes.some((q) => q.mechanicId === mid && q.status !== "draft") && !r.interested.some((i) => i.mechanicId === mid),
        )
      : [];
  const allRows = withProfiles
    .filter(({ q }) => q.status !== "draft")
    .map(({ q, p }) => ({
      q,
      p,
      e: eligibility(p),
      t: quoteTotals(q),
      exact: p.verifiedWork.filter((x) => x.category === r.repairCategory && x.make === v.make).length,
    }));
  // Only estimates the customer could accept are compared. A response from a mechanic whose basic
  // profile isn't complete (older or demo data; they can't send new ones) is listed apart, with the
  // reason and no price comparison.
  const rows = allRows.filter((x) => x.e.eligible || x.q.status === "accepted");
  const unavailable = allRows.filter((x) => !x.e.eligible && x.q.status !== "accepted");
  const waiting = isWaitingForMatch(r);
  const chosen = accepted ? repo.getMechanic(accepted.mechanicId)?.firstName : undefined;
  const j = journey({ request: r, quotes, job, audience: "customer", names: { customer: s.name.split(" ")[0], mechanic: chosen } });
  const cancelled = r.status === "cancelled";
  // Editable until any mechanic responds; cancellable until it's booked.
  const editable = r.status === "open" && !sentQuotes.length && !r.interested.length && !r.questions.length;
  const cancellable = (r.status === "open" || r.status === "quoted") && !job;
  const badgesFor = (quoteId: string) => (sentQuotes.length > 1 ? picks.filter((t) => t.row.q.id === quoteId).map((t) => t.title) : []);

  return (
    <EvidenceProvider>
      <Link href="/customer/requests" className="inline-flex items-center gap-1.5 text-[0.875rem] text-ink-3 hover:text-ink">
        <ArrowLeft size={14} aria-hidden /> Requests
      </Link>
      <div className="mt-3 border-b-2 border-ink pb-4">
        <h1 className="display text-[2rem] sm:text-[2.75rem]">Your {vehicleLine(v)}</h1>
        <p className="mt-2 max-w-[70ch] text-ink-2">&ldquo;{primarySymptom(r)}&rdquo;</p>
        <p className="mt-1 text-[0.875rem] text-ink-3">
          Posted {dayMonth(r.createdAt)} · {findArea(r.location.area)?.label ?? ""}
          {r.preferredTimes ? ` · ${r.preferredTimes}` : ""}
        </p>
        <details className="mt-3">
          <summary className="cursor-pointer text-[0.875rem] font-semibold underline decoration-rule underline-offset-2">
            See your full request as mechanics see it
          </summary>
          <div className="mt-4 max-w-[760px]">
            <RequestSummary r={r} v={v} audience="customer" revealPrivate />
          </div>
        </details>
      </div>

      {sp.error ? (
        <Notice tone="error" className="mt-4">
          {sp.error}
        </Notice>
      ) : sp.checked && sp.checked !== "0" && !waiting ? (
        <Notice tone="ok" className="mt-4"><span className="font-semibold">Sent to {plural(Number(sp.checked) || 1, "mechanic")}. Their replies will appear on this page.</span></Notice>
      ) : sp.edited ? (
        <Notice tone="ok" className="mt-4"><span className="font-semibold">Your changes are saved.</span></Notice>
      ) : null}

      <div className="mt-6">
        <JourneyStatus
          j={j}
          audience="customer"
          names={{ customer: s.name.split(" ")[0], mechanic: chosen }}
          action={
            job ? (
              <Link href={`/customer/jobs/${job.id}`} className="btn btn-ink min-h-11">
                View the repair <ArrowRight size={15} aria-hidden />
              </Link>
            ) : undefined
          }
        />
      </div>

      {cancelled ? (
        <CancelledPanel r={r} fresh={Boolean(sp.cancelled)} />
      ) : waiting ? (
        <WaitingPanel r={r} v={v} checked={sp.checked} editable={editable} />
      ) : null}

      {replacement ? <ReplacementPanel r={r} rep={replacement} /> : null}
      {handoffPending.length ? (
        <HandoffNote r={r} names={handoffPending.length === 1 ? [repo.getMechanic(handoffPending[0])!.displayName] : handoffPending.map(String)} />
      ) : null}


      {openQuestions.length > 0 && (
        <section aria-labelledby="questions-title" className="mt-6 space-y-3">
          <h2 id="questions-title" className="heading text-[1.25rem]">
            Questions from mechanics{unanswered ? ` · ${unanswered} waiting for you` : ""}
          </h2>
          <ul className="border-t border-rule">
            {openQuestions.map(({ q, idx, m }) => (
              <li key={idx} className="border-b border-rule-soft py-3">
                <p className="text-[0.9375rem]">
                  <span className="font-semibold">{m.displayName}:</span> {q.question}
                </p>
                {q.response || q.attachments.length ? (
                  <div className="mt-1 text-[0.9375rem] text-ink-2">
                    {q.response ? (
                      <p>
                        <span className="font-semibold text-ink">You:</span> {q.response}
                      </p>
                    ) : null}
                    {q.attachments.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {q.attachments.map((a) => (
                          <MediaThumb key={a.id} m={a} size={72} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <QuestionReply requestId={r.id} index={idx} firstName={m.firstName} />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {sentQuotes.length + interestedOnly.length > 0 ? (
        <section aria-labelledby="responses-title" className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="responses-title" className="heading text-[1.5rem]">
              Compare responses
            </h2>
            {pending ? <p className="text-[0.875rem] text-ink-3">{pending} more still reviewing</p> : null}
          </div>

          {rows.length >= 2 && (
            <div className="mt-3 hidden overflow-x-auto sm:block">
              <table className="w-full border-collapse text-left text-[0.9375rem]">
                <thead>
                  <tr className="border-b-2 border-ink text-[0.8125rem] text-ink-2">
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      Mechanic
                    </th>
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      Estimated total
                    </th>
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      Parts
                    </th>
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      When
                    </th>
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      {v.make} {repairNoun(r.repairCategory, 2)}
                    </th>
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      Rating
                    </th>
                    <th scope="col" className="py-2 font-semibold">
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ q, p, e, t, exact }) => (
                    <tr key={q.id} className="border-b border-rule-soft align-top">
                      <th scope="row" className="py-2.5 pr-4 font-semibold">
                        <Link href={`/customer/quotes/${q.id}`} className="hover:underline">
                          {p.displayName}
                        </Link>
                        {badgesFor(q.id).length ? <span className="block text-[0.75rem] font-bold text-brand">{badgesFor(q.id)[0]}</span> : null}
                      </th>
                      <td className="num py-2.5 pr-4 text-[1.25rem]">{t.planFor}</td>
                      <td className={`py-2.5 pr-4 text-[0.875rem] ${q.partsIncluded ? "" : "font-semibold text-amber"}`}>
                        {q.partsIncluded ? "Included" : "At cost"}
                      </td>
                      <td className="py-2.5 pr-4 text-[0.875rem]">{q.availableOn}</td>
                      <td className="tnum py-2.5 pr-4 font-semibold">{exact} verified</td>
                      <td className="tnum py-2.5 pr-4 text-[0.875rem]">
                        {p.reputation.rating ? (
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                            <StarRating value={p.reputation.rating.average} size={13} /> {p.reputation.rating.average.toFixed(1)} ({p.reputation.rating.count})
                          </span>
                        ) : (
                          "–"
                        )}
                      </td>
                      <td className="py-1.5 text-right">
                        {q.status === "accepted" ? (
                          <span className="inline-flex items-center gap-1 text-[0.875rem] font-semibold text-brand">
                            <Check size={15} aria-hidden /> Approved
                          </span>
                        ) : !accepted && e.eligible ? (
                          <Link href={`/customer/quotes/${q.id}`} className={`btn min-h-10 px-4 text-sm ${badgesFor(q.id).length ? "btn-ink" : "btn-line"}`}>
                            Review
                          </Link>
                        ) : (
                          <span className="inline-flex flex-col items-end text-[0.8125rem]">
                            <span className="inline-flex items-center gap-1 font-semibold text-alert">
                              <ShieldAlert size={14} aria-hidden /> {notBookableStatus(e)}
                            </span>
                            <Link href={`/customer/quotes/${q.id}`} className="text-ink-2 underline decoration-rule underline-offset-2">
                              Read estimate
                            </Link>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Cards on phones; on larger screens the table above is the comparison. */}
          <ul className={`mt-5 grid gap-4 lg:grid-cols-3 ${rows.length >= 2 ? "sm:hidden" : ""}`}>
            {rows.map(({ q, p, e, t, exact }) => {
              const chosen = q.status === "accepted";
              const pick = badgesFor(q.id)[0];
              const rating = p.reputation.rating;
              return (
                <li
                  key={q.id}
                  className={`flex flex-col bg-sheet ${pick || chosen ? "border-2 border-brand-deep" : "border border-rule"} ${q.status === "declined" ? "opacity-60" : ""}`}
                >
                  {pick ? <p className="border-b-4 border-brass bg-brand-deep px-4 py-2 text-[0.875rem] font-extrabold text-brass-wash">{pick}</p> : null}
                  <div className="flex flex-1 flex-col gap-3 p-4">
                    <div className="flex items-center gap-3">
                      <PhotoPrint photoUrl={p.photoUrl} initials={p.initials} name={p.displayName} size={52} />
                      <div className="min-w-0">
                        <Link href={`/mechanics/${p.slug}?${ctx}`} className="heading block text-[1.25rem] hover:underline">
                          {p.displayName}
                        </Link>
                        <p className="text-[0.8125rem] text-ink-2">Comes to you</p>
                      </div>
                    </div>
                    <p className="flex items-baseline gap-2">
                      <span className="num text-[1.75rem] leading-none">{exact}</span>
                      <span className="text-[0.9375rem] font-bold">
                        verified {v.make} {repairNoun(r.repairCategory, exact)}
                      </span>
                    </p>
                    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[0.875rem]">
                      <li className="inline-flex items-center gap-1.5">
                        {rating ? <StarRating value={rating.average} size={14} /> : null}
                        {rating ? `${rating.average.toFixed(1)} (${rating.count})` : "No reviews yet"}
                      </li>
                      <li className={`inline-flex items-center gap-1.5 ${!e.eligible ? "font-semibold text-alert" : e.fullyVerified ? "" : "font-semibold text-amber"}`}>
                        {e.eligible && e.fullyVerified ? <ShieldCheck size={15} className="text-carbon" aria-hidden /> : <ShieldAlert size={15} aria-hidden />}
                        {!e.eligible ? `Can't be booked: ${notBookableStatus(e).toLowerCase()}` : screeningSummary(p).label}
                      </li>
                    </ul>
                    {q.notes ? <p className="line-clamp-2 text-[0.875rem] text-ink-2">&ldquo;{q.notes}&rdquo;</p> : null}
                    <div className="mt-auto flex items-end justify-between gap-3 border-t border-rule-soft pt-3">
                      <div>
                        <p className="num text-[1.75rem]">{t.planFor}</p>
                        <p className={`text-[0.8125rem] ${q.partsIncluded ? "text-ink-2" : "font-semibold text-amber"}`}>
                          {q.partsIncluded ? "Parts included" : "Parts at cost"}
                        </p>
                      </div>
                      <p className="text-right text-[0.875rem]">{q.availableOn}</p>
                    </div>
                    {chosen ? (
                      <p className="flex items-center gap-1.5 font-semibold text-brand">
                        <Check size={16} strokeWidth={2.5} aria-hidden /> Estimate approved
                      </p>
                    ) : !accepted && e.eligible ? (
                      <Link href={`/customer/quotes/${q.id}`} className={`btn min-h-11 ${pick ? "btn-ink" : "btn-line"}`}>
                        Review estimate <ArrowRight size={15} aria-hidden />
                      </Link>
                    ) : (
                      <Link href={`/customer/quotes/${q.id}`} className="text-[0.875rem] font-semibold underline decoration-rule underline-offset-2">
                        Read estimate
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {interestedOnly.length > 0 && (
            <ul className="mt-4 grid gap-4 lg:grid-cols-3">
              {interestedOnly.map(({ i, p }) => (
                <li key={i.mechanicId} className="flex flex-col gap-3 border border-dashed border-rule bg-sheet p-4">
                  <div className="flex items-center gap-3">
                    <PhotoPrint photoUrl={p.photoUrl} initials={p.initials} name={p.displayName} size={52} />
                    <div className="min-w-0">
                      <Link href={`/mechanics/${p.slug}?${ctx}`} className="heading block text-[1.25rem] hover:underline">
                        {p.displayName}
                      </Link>
                      <p className="text-[0.8125rem] font-semibold">Estimate coming</p>
                    </div>
                  </div>
                  {i.note ? <p className="line-clamp-2 text-[0.875rem] text-ink-2">&ldquo;{i.note}&rdquo;</p> : null}
                </li>
              ))}
            </ul>
          )}
          {unavailable.length > 0 && (
            <section aria-labelledby="unavailable-title" className="mt-6 border-t border-rule pt-4">
              <h3 id="unavailable-title" className="text-[1rem] font-bold">
                Can&apos;t be booked right now
              </h3>
              <p className="mt-1 max-w-[62ch] text-[0.875rem] text-ink-2">
                {unavailable.length === 1 ? "This mechanic replied, but their" : "These mechanics replied, but their"} Clutch profile isn&apos;t complete, so the estimate
                can&apos;t be accepted. It isn&apos;t part of the comparison above.
              </p>
              <ul className="mt-3 space-y-3">
                {unavailable.map(({ q, p, e }) => (
                  <li key={q.id} className="flex items-center gap-3">
                    <PhotoPrint photoUrl={p.photoUrl} initials={p.initials} name={p.displayName} size={40} />
                    <div className="min-w-0 text-[0.9375rem]">
                      <Link href={`/mechanics/${p.slug}?${ctx}`} className="font-semibold hover:underline">
                        {p.displayName}
                      </Link>
                      <p className="text-[0.8125rem] text-alert">{notBookableStatus(e)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>
      ) : !replacement && !job && !waiting && !cancelled ? (
        <p className="mt-8 border-y border-rule py-6 text-ink-2">Sent to {plural(pending, "mechanic")} who {pending === 1 ? "matches" : "match"} your car, repair and area. Their replies will appear on this page, with which of their checks Clutch has verified.</p>
      ) : null}

      {!waiting && !cancelled && cancellable ? <ManageRequest r={r} editable={editable} /> : null}
    </EvidenceProvider>
  );
}


/** Request → Responses → Selected mechanic → Repair, with a short note under each. */
/** Saved with no mechanic to send it to. Says what was kept and what happens next, without promising outreach. */
function WaitingPanel({ r, v, checked, editable }: { r: RepairRequest; v: Vehicle; checked?: string; editable: boolean }) {
  const area = findArea(r.location.area);
  const facts: [string, string][] = [
    ["Car", vehicleLine(v)],
    ["Repair type", REPAIR_LABEL[r.repairCategory]],
    ["Where", `Comes to the car${area ? ` · ${area.label}` : ""}`],
    ["How soon", urgencyLabel(r.urgency) || "Not set"],
    ["When works", r.preferredTimes || "Not set"],
    ["Photos and recordings", String(r.media.length)],
  ];
  return (
    <section aria-labelledby="waiting-title" className="mt-6 border-2 border-ink bg-sheet">
      <div className="flex gap-3 border-b border-rule px-5 py-4">
        <Clock3 size={20} className="mt-1 shrink-0" aria-hidden />
        <div>
          <h2 id="waiting-title" className="heading text-[1.25rem] sm:text-[1.375rem]">
            What happens next
          </h2>
          <p className="mt-1 max-w-[65ch] text-[0.9375rem] text-ink-2">
            Clutch checks again whenever a mechanic finishes their profile. When one fits your car, repair and area, Clutch sends them this request and their reply shows
            on this page.{" "}
            {emailAlertsOn() ? "You'll also get an email alert if alerts are on in your account settings." : "Clutch doesn't send email or text alerts yet, so check back here."}
          </p>
        </div>
      </div>
      <div className="space-y-5 p-5">
        {checked === "0" ? (
          <p role="status" className="text-[0.9375rem] font-semibold">
            Checked just now: still no mechanic fits.
          </p>
        ) : null}
        <div>
          <h3 className="field-label">What Clutch saved</h3>
          <dl className="mt-2 grid gap-x-6 text-[0.9375rem] sm:grid-cols-2">
            {facts.map(([k, val]) => (
              <div key={k} className="border-b border-rule-soft py-2">
                <dt className="text-[0.75rem] text-ink-3">{k}</dt>
                <dd className="font-semibold">{val}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-[0.8125rem] text-ink-3">Your address and access details stay private until you book someone.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {editable ? (
            <Link href={`/customer/requests/${r.id}/edit`} className="btn btn-ink min-h-11">
              <Pencil size={15} aria-hidden /> Edit request
            </Link>
          ) : null}
          <form action={rematchRequest.bind(null, r.id)}>
            <button className="btn btn-line min-h-11">
              <RefreshCw size={15} aria-hidden /> Check again now
            </button>
          </form>
          <form action={cancelRequest.bind(null, r.id)}>
            <ConfirmButton message="Cancel this request? It will stay in your history, but no mechanic will be sent it." className="min-h-11 px-2 text-[0.9375rem] font-semibold text-alert underline decoration-rule underline-offset-2">
              Cancel request
            </ConfirmButton>
          </form>
          <Link href="/customer" className="min-h-11 px-2 py-2.5 text-[0.9375rem] text-ink-2 underline decoration-rule underline-offset-2">
            Back to home
          </Link>
        </div>
      </div>
    </section>
  );
}

function CancelledPanel({ r, fresh }: { r: RepairRequest; fresh: boolean }) {
  return (
    <section aria-labelledby="cancelled-title" role={fresh ? "status" : undefined} className="mt-6 flex gap-3 border border-rule bg-sheet px-5 py-4">
      <XCircle size={20} className="mt-1 shrink-0 text-ink-3" aria-hidden />
      <div>
        <h2 id="cancelled-title" className="heading text-[1.25rem]">
          {fresh ? "Request cancelled" : "You cancelled this request"}
          {r.cancelledAt ? <span className="font-normal text-ink-3"> · {dayMonth(r.cancelledAt)}</span> : null}
        </h2>
        <p className="mt-1 text-[0.9375rem] text-ink-2">It stays here for your records. No mechanic can quote it or be booked for it.</p>
        <Link href="/customer/requests/new" className="btn btn-line mt-3 min-h-11">
          Start a new request
        </Link>
      </div>
    </section>
  );
}

/** Edit or withdraw a request that's out with mechanics but not booked. */
function ManageRequest({ r, editable }: { r: RepairRequest; editable: boolean }) {
  return (
    <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-rule pt-4 text-[0.9375rem]">
      {editable ? (
        <Link href={`/customer/requests/${r.id}/edit`} className="font-semibold underline decoration-rule underline-offset-2">
          Edit request
        </Link>
      ) : null}
      <form action={cancelRequest.bind(null, r.id)}>
        <ConfirmButton message="Cancel this request? Mechanics will see it's withdrawn, and any estimates on it will close." className="min-h-11 font-semibold text-alert underline decoration-rule underline-offset-2">
          Cancel request
        </ConfirmButton>
      </form>
    </div>
  );
}
