import type { Metadata } from "next";
import { StarRating } from "@/components/visual/stars";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ArrowLeft, Check, ShieldAlert, ShieldCheck } from "lucide-react";
import { ready, repo } from "@/lib/data";
import { getSession } from "@/lib/session";
import { repairNoun } from "@/lib/domain/provenance";
import { dayMonth, plural } from "@/lib/format";
import { EvidenceProvider } from "@/components/trust/evidence-sheet";
import { PhotoPrint } from "@/components/profile/photo";
import { RequestSummary } from "@/components/request/request-summary";
import { QuestionReply } from "@/components/request/question-reply";
import { MediaThumb } from "@/components/request/media-capture";
import { primarySymptom, vehicleLine } from "@/lib/domain/intake";
import { findArea } from "@/lib/domain/areas";
import { topPicks } from "@/lib/domain/recommend";
import { eligibility, notBookableStatus } from "@/lib/domain/eligibility";
import { quoteTotals } from "@/lib/domain/quote";
import { HandoffNote, ReplacementPanel } from "@/components/request/replacement-panel";
import { replacementFor } from "@/lib/replacement";

export const metadata: Metadata = { title: "Your shortlist" };

export default async function CompareQuotes({ params }: { params: Promise<{ id: string }> }) {
  await ready();
  const s = await getSession();
  if (s.role !== "customer") return null;
  const { id } = await params;
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
  const interestedCount = new Set([...r.interested.map((i) => i.mechanicId), ...sentQuotes.map((q) => q.mechanicId)]).size;
  const picks = topPicks(
    withProfiles
      .filter(({ q }) => q.status === "submitted")
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
  const replacement = replacementFor(r);
  const lastHandoff = (r.handoffs ?? []).at(-1);
  // A quiet "sent to…" note until the mechanics it was sent on to respond.
  const handoffPending =
    !replacement && lastHandoff
      ? lastHandoff.to.filter(
          (mid) =>
            !r.declinedBy.includes(mid) && !quotes.some((q) => q.mechanicId === mid && q.status !== "draft") && !r.interested.some((i) => i.mechanicId === mid),
        )
      : [];
  const rows = withProfiles
    .filter(({ q }) => q.status !== "draft")
    .map(({ q, p }) => ({
      q,
      p,
      e: eligibility(p),
      t: quoteTotals(q),
      exact: p.verifiedWork.filter((x) => x.category === r.repairCategory && x.make === v.make).length,
    }));
  const stage = job ? (job.status === "scheduled" ? 2 : 3) : sentQuotes.length + interestedCount > 0 ? 1 : 0;
  const stageNotes = [
    `Sent ${dayMonth(r.createdAt)}`,
    sentQuotes.length ? plural(sentQuotes.length, "estimate") : interestedCount ? `${interestedCount} interested` : "",
    accepted ? (repo.getMechanic(accepted.mechanicId)?.firstName ?? "") : "",
    job?.status === "completed" ? "Done" : job && job.status !== "scheduled" ? "In progress" : "",
  ];
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

      {replacement ? <ReplacementPanel r={r} rep={replacement} /> : null}
      {handoffPending.length ? (
        <HandoffNote r={r} names={handoffPending.length === 1 ? [repo.getMechanic(handoffPending[0])!.displayName] : handoffPending.map(String)} />
      ) : null}

      <Lifecycle stage={stage} notes={stageNotes} />

      {job ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border border-brand bg-sheet px-4 py-3">
          <p className="text-[0.9375rem] font-semibold">
            {repo.getMechanic(accepted!.mechanicId)?.firstName} is booked for {accepted!.availableOn}.
          </p>
          <Link href={`/customer/jobs/${job.id}`} className="btn btn-ink min-h-11">
            View the repair <ArrowRight size={15} aria-hidden />
          </Link>
        </div>
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

          {sentQuotes.length >= 2 && (
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
          <ul className={`mt-5 grid gap-4 lg:grid-cols-3 ${sentQuotes.length >= 2 ? "sm:hidden" : ""}`}>
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
                        <Link href={`/mechanics/${p.slug}?${ctx}`} className="heading block text-[1.1875rem] hover:underline">
                          {p.displayName}
                        </Link>
                        <p className="text-[0.8125rem] text-ink-2">{q.serviceMode === "mobile" ? "Comes to you" : "At their shop"}</p>
                      </div>
                    </div>
                    <p className="flex items-baseline gap-2">
                      <span className="num text-[1.625rem] leading-none">{exact}</span>
                      <span className="text-[0.9375rem] font-bold">
                        verified {v.make} {repairNoun(r.repairCategory, exact)}
                      </span>
                    </p>
                    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[0.875rem]">
                      <li className="inline-flex items-center gap-1.5">
                        {rating ? <StarRating value={rating.average} size={14} /> : null}
                        {rating ? `${rating.average.toFixed(1)} (${rating.count})` : "No reviews yet"}
                      </li>
                      <li className={`inline-flex items-center gap-1.5 ${e.eligible ? "" : "font-semibold text-alert"}`}>
                        {e.eligible ? <ShieldCheck size={15} className="text-carbon" aria-hidden /> : <ShieldAlert size={15} aria-hidden />}
                        {e.eligible ? "Screening current" : `Can't be booked: ${notBookableStatus(e).toLowerCase()}`}
                      </li>
                    </ul>
                    {q.notes ? <p className="line-clamp-2 text-[0.875rem] text-ink-2">&ldquo;{q.notes}&rdquo;</p> : null}
                    <div className="mt-auto flex items-end justify-between gap-3 border-t border-rule-soft pt-3">
                      <div>
                        <p className="num text-[1.625rem]">{t.planFor}</p>
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
                      <Link href={`/mechanics/${p.slug}?${ctx}`} className="heading block text-[1.1875rem] hover:underline">
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
        </section>
      ) : !replacement && !job ? (
        <p className="mt-8 border-y border-rule py-6 text-ink-2">Sent to {plural(pending, "qualified mechanic")}. Responses will appear here.</p>
      ) : null}
    </EvidenceProvider>
  );
}

const STAGES = ["Request", "Responses", "Selected mechanic", "Repair"];

/** Request → Responses → Selected mechanic → Repair, with a short note under each. */
function Lifecycle({ stage, notes }: { stage: number; notes: string[] }) {
  return (
    <ol className="mt-6 grid grid-cols-4 gap-1.5" aria-label="Where this repair stands">
      {STAGES.map((label, i) => (
        <li key={label} aria-current={i === stage ? "step" : undefined} className="min-w-0">
          <span className={`block h-2 ${i < stage ? "bg-ink-2" : i === stage ? "bg-brand" : "bg-rule-soft"}`} />
          <span
            className={`mt-1.5 block text-[0.75rem] leading-tight sm:text-[0.875rem] ${i === stage ? "font-bold" : i < stage ? "text-ink-2" : "text-ink-3"}`}
          >
            {label}
            {i < stage ? <span className="sr-only"> (done)</span> : null}
          </span>
          {notes[i] ? <span className="block text-[0.75rem] text-ink-3">{notes[i]}</span> : null}
        </li>
      ))}
    </ol>
  );
}
