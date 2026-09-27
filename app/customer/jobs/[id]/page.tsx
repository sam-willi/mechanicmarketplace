import type { Metadata } from "next";
import { StarRating } from "@/components/visual/stars";
import Link from "next/link";
import { ArrowLeft, CalendarClock, LifeBuoy, MapPin, Phone } from "lucide-react";
import { notFound } from "next/navigation";
import { getRepo } from "@/lib/data";
import { getSession, needs } from "@/lib/session";
import { BookingVerification } from "@/components/trust/booking-verification";
import { vehicleLine } from "@/lib/domain/intake";
import { jobValueCents } from "@/lib/domain/status";
import { dayMonth, usd } from "@/lib/format";
import { answerNewTime, cancelRepair, confirmCompletion, proposeNewTime, reopenRepair, reportPaymentAsCustomer, respondScopeChange, submitReview } from "@/app/actions/customer";
import { HistoryList } from "@/components/app/history-list";
import { PaymentFacts, PaymentFields, RescheduleBox, EstimateVersions, ScopeHistory } from "@/components/app/job-parts";
import { ConfirmButton } from "@/components/app/confirm-button";
import { ReviewPhoto } from "@/components/app/review-photo";
import { NowPanel } from "@/components/app/job-lifecycle";
import { jobLifecycle } from "@/lib/domain/lifecycle";
import { Tick } from "@/components/trust/marks";
import { journey } from "@/lib/domain/journey";
import { JourneyStatus } from "@/components/app/journey-status";
import { PhotoPrint } from "@/components/profile/photo";
import { MediaThumb } from "@/components/request/media-capture";
import { EvidenceProvider } from "@/components/trust/evidence-sheet";
import { ScreeningList } from "@/components/trust/screening-list";
import { SaveMechanicButton } from "@/components/profile/save-button";
import { StatusTimeline } from "@/components/visual/timeline";
import { VehicleTile } from "@/components/visual/vehicle-glyph";
import { Notice } from "@/components/workspace/ui";
import { findArea } from "@/lib/domain/areas";

export const metadata: Metadata = { title: "Your repair" };

function Rating({ name, label, value = 5 }: { name: string; label: string; value?: number }) {
  return (
    <fieldset className="flex flex-wrap items-center justify-between gap-2 border-b border-rule-soft py-2.5">
      <legend className="float-left text-[0.9375rem]">{label}</legend>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="grid size-10 cursor-pointer place-items-center border border-rule bg-sheet text-[0.875rem] font-semibold has-[:checked]:border-brand has-[:checked]:bg-brand has-[:checked]:text-sheet">
            <input type="radio" name={name} value={n} defaultChecked={n === value} className="sr-only" />
            {n}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function when(scheduledFor: string) {
  return scheduledFor.replace(/^(\w+)\s/, "$1 ").trim();
}

type Flags = { confirmed?: string; error?: string; cancelled?: string; reopened?: string; proposed?: string; reviewed?: string; reviewEdited?: string; paymentSaved?: string; editReview?: string };

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Flags> }) {
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "customer") return null;
  const { id } = await params;
  await (await needs(s)).customerJob(id);
  const sp = await searchParams;
  const job = repo.getJob(id);
  if (!job || job.customerId !== s.customerId) notFound();
  const v = repo.getVehicle(job.vehicleId)!;
  const mech = repo.getMechanic(job.mechanicId)!;
  const m = repo.getPublicProfile(mech.slug)!;
  const q = repo.getQuote(job.quoteId);
  const req = repo.getRequest(job.requestId)!;
  const review = repo.getReviewForJob(job.id);
  const { stages, current } = jobLifecycle(job, review, { customer: s.name.split(" ")[0], mechanic: m.firstName }, "customer");
  const phone = repo.getUser(mech.userId)?.phone;
  const saved = repo.listSaved(s.customerId).includes(m.id);
  const total = q ? q.laborCents + q.diagnosticFeeCents + q.travelFeeCents + q.partsEstimateCents : 0;
  const upcoming = job.status === "scheduled";
  const active = job.status === "scheduled" || job.status === "in_progress";
  const approved = repo.approvedLaborAndFees(job);
  const notice = sp.cancelled
    ? "Booking cancelled."
    : sp.reopened
      ? `Sent back to ${m.firstName} with what's left to do.`
      : sp.proposed
        ? `New time suggested. The booking only changes if ${m.firstName} accepts.`
        : sp.reviewed
          ? "Review posted."
          : sp.reviewEdited
            ? "Review updated."
            : sp.paymentSaved
              ? "Payment note saved."
              : null;
  const photos = (job.photos ?? []).filter((ph) => ph.url);
  const headline =
    job.status === "scheduled"
      ? job.confirmedAt
        ? `${m.firstName} is confirmed for ${when(job.scheduledFor)}`
        : `${m.firstName} is booked for ${when(job.scheduledFor)}`
      : job.status === "in_progress"
        ? `${m.firstName} is working on your ${v.make}`
        : job.status === "awaiting_customer"
          ? `${m.firstName} says the repair is done`
          : job.status === "completed"
            ? "Repair complete"
            : "This booking was cancelled";

  return (
    <EvidenceProvider mechanicId={m.id} variant="high">
      <div className="mx-auto grid max-w-[1040px] gap-8 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0 space-y-8">
          <Link href="/customer/jobs" className="inline-flex items-center gap-1.5 text-[0.875rem] text-ink-3 hover:text-ink">
            <ArrowLeft size={14} aria-hidden /> My Repairs
          </Link>
          {sp.error ? (
            <Notice tone="error">
              {sp.error}
            </Notice>
          ) : notice ? (
            <Notice tone="ok"><span className="font-semibold">{notice}</span></Notice>
          ) : null}

          <JourneyStatus j={journey({ request: req, quotes: q ? [q] : [], job, audience: "customer", names: { customer: s.name.split(" ")[0], mechanic: m.firstName } })} audience="customer" names={{ customer: s.name.split(" ")[0], mechanic: m.firstName }} />

          {/* The booking, as one confirmation card */}
          <section aria-label="Booking" className={`sheet overflow-hidden ${job.status === "completed" ? "" : "perf-top"}`}>
            <div className="border-b border-rule px-5 pt-6 pb-4">
              <h1 className="display text-[1.75rem] sm:text-[2.25rem]">{headline}</h1>
              {job.status === "cancelled" && job.cancelledBy === "mechanic" ? (
                <p className="mt-2 text-[0.9375rem] text-ink-2">
                  {m.firstName} cancelled. Your request is open again.{" "}
                  <Link href={`/customer/requests/${req.id}`} className="font-semibold text-ink underline decoration-rule underline-offset-[3px]">
                    See who else could do it
                  </Link>
                </p>
              ) : null}
              {upcoming && !job.confirmedAt ? (
                <p className="mt-1 text-[0.9375rem] text-ink-2">You&apos;ll see it here and in Notifications when {m.firstName} confirms the time.</p>
              ) : null}
            </div>
            <div className="flex gap-4 border-b border-rule-soft px-5 py-4">
              <PhotoPrint photoUrl={m.photoUrl} initials={m.initials} name={m.displayName} size={72} />
              <div className="min-w-0 flex-1">
                <p className="heading text-[1.25rem]">{m.displayName}</p>
                <p className="text-[0.875rem] text-ink-2">
                  {m.reputation.verifiedRepairs} verified repairs
                  {m.reputation.rating ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden> ·</span> <StarRating value={m.reputation.rating.average} size={13} /> {m.reputation.rating.average.toFixed(1)} from{" "}
                      {m.reputation.rating.count} verified reviews
                    </span>
                  ) : null}
                </p>
                <div className="mt-2">
                  <ScreeningList p={m} compact />
                </div>
              </div>
            </div>
            <dl className="grid sm:grid-cols-2">
              <div className="border-b border-rule-soft px-5 py-3 sm:border-r">
                <dt className="field-label">Appointment</dt>
                <dd className="mt-1 flex items-center gap-2 font-semibold">
                  <CalendarClock size={16} aria-hidden /> {job.status === "completed" ? `Completed ${dayMonth(job.completedAt)}` : job.scheduledFor}
                </dd>
              </div>
              <div className="border-b border-rule-soft px-5 py-3">
                <dt className="field-label">Where</dt>
                <dd className="mt-1 flex items-start gap-2 font-semibold">
                  <MapPin size={16} className="mt-0.5 shrink-0" aria-hidden />
                  <span>
                    {req.location.address ?? findArea(req.location.area)?.label ?? "Your location"}
                  </span>
                </dd>
              </div>
              <div className="flex items-center gap-3 border-b border-rule-soft px-5 py-3 sm:border-r">
                <VehicleTile v={v} size="sm" />
                <div className="min-w-0">
                  <dt className="field-label">Vehicle</dt>
                  <dd className="mt-0.5 font-semibold">{vehicleLine(v)}</dd>
                </div>
              </div>
              <div className="border-b border-rule-soft px-5 py-3">
                <dt className="field-label">Approved estimate</dt>
                <dd className="mt-1">
                  <span className="num text-[1.375rem]">{q ? usd(total) : "—"}</span>
                  {q ? (
                    <Link href={`/customer/quotes/${q.id}`} className="link ml-2 text-[0.875rem]">
                      View estimate
                    </Link>
                  ) : null}
                </dd>
              </div>
              <div className="px-5 py-3 sm:col-span-2">
                <dt className="field-label">Contact</dt>
                <dd className="mt-1 text-[0.9375rem]">
                  {phone && active ? (
                    <a href={`tel:${phone.replace(/[^0-9+]/g, "")}`} className="inline-flex items-center gap-2 font-semibold underline decoration-rule underline-offset-[3px]">
                      <Phone size={15} aria-hidden /> Call or text {m.firstName}: {phone}
                    </a>
                  ) : (
                    <span className="text-ink-2">Updates arrive in your Clutch notifications.</span>
                  )}
                  {active ? <span className="block text-[0.8125rem] text-ink-3">Shared with you because this booking is confirmed. {m.firstName} now sees your address and access notes.</span> : null}
                </dd>
              </div>
            </dl>
          </section>
      <NowPanel current={current} hideHeadline hideWaiting>
        {job.diagnosis ? (
          <p className="mb-3 text-[0.9375rem]">
            <span className="font-semibold">{m.firstName}&apos;s diagnosis:</span> {job.diagnosis.note}
            <span className="block text-[0.8125rem] text-ink-2">{job.diagnosis.matchesEstimate ? "Matches the estimate you approved." : "Different from the estimate. Nothing extra is done without your approval."}</span>
          </p>
        ) : null}
        {current?.key === "scope" && job.scopeChange ? (
          <div className="space-y-3">
            <p className="text-[0.9375rem]">
              {m.firstName} wants to: <span className="font-semibold">{job.scopeChange.description}</span>
            </p>
            <p className="num text-[1.5rem]">+{usd(job.scopeChange.extraCents)}</p>
            <div className="flex flex-wrap gap-2">
              <form action={respondScopeChange.bind(null, job.id, true)}>
                <ConfirmButton message={`Approve the extra work for ${usd(job.scopeChange.extraCents)}?`} className="btn btn-ink min-h-11">
                  Approve extra work
                </ConfirmButton>
              </form>
              <form action={respondScopeChange.bind(null, job.id, false)}>
                <ConfirmButton message={`Decline the extra work? ${m.firstName} finishes only what you originally approved.`} className="btn btn-line min-h-11">
                  Decline
                </ConfirmButton>
              </form>
            </div>
          </div>
        ) : null}
        {current?.key === "customer_confirm" ? (
          <div className="space-y-4">
            {job.completionNotes ? <p className="text-[0.9375rem] text-ink-2">&ldquo;{job.completionNotes}&rdquo;</p> : null}
            {job.finalAmountCents !== undefined ? (
              <div className="tnum text-[0.9375rem]">
                <p>
                  {m.firstName}&apos;s final amount: <span className="font-bold">{usd(job.finalAmountCents)}</span> for labor and fees
                </p>
                <p className={job.finalExceedsApproved ? "font-semibold text-alert" : "text-ink-2"}>
                  You approved {usd(approved)} for labor and fees{job.finalExceedsApproved ? `. That's ${usd(job.finalAmountCents - approved)} more than you approved; you don't have to agree to it here.` : "."}
                </p>
              </div>
            ) : null}
            <form action={confirmCompletion.bind(null, job.id)} className="space-y-3">
              <PaymentFields legend={`Have you paid ${m.firstName}? (optional, for your records)`} />
              <ConfirmButton message={`Confirm ${m.firstName} finished the repair?\n\nIt becomes part of ${m.firstName}'s verified public record (car, repair type and month; never your name or address).`} className="btn btn-ink min-h-12">
                Yes, the work is done
              </ConfirmButton>
            </form>
            <details className="border-t border-rule-soft pt-3">
              <summary className="min-h-11 cursor-pointer content-center text-[0.9375rem] font-semibold">It isn&apos;t finished</summary>
              <form action={reopenRepair.bind(null, job.id)} className="mt-2 space-y-2">
                <label className="block">
                  <span className="field-label">What&apos;s left to do? ({m.firstName} sees this)</span>
                  <textarea name="note" required rows={2} maxLength={300} className="input mt-1" />
                </label>
                <button className="btn btn-line min-h-11">Send back to {m.firstName}</button>
              </form>
            </details>
            <p className="text-[0.8125rem] text-ink-3">
              Something wrong with the work or the price? <Link href={`/customer/help?job=${job.id}`} className="link">Report it to Clutch staff</Link>. They reply in the app.
            </p>
          </div>
        ) : null}
        {current?.key === "review" ? (
          <a href="#review" className="btn btn-ink min-h-11">
            Leave a review
          </a>
        ) : null}
      </NowPanel>

      {sp.confirmed ? (
        <p className="flex items-center gap-2 border border-ink bg-sheet px-4 py-3 text-[0.9375rem]">
          <Tick size={16} /> Confirmed. This repair is now on {m.firstName}&apos;s record, verified through a Clutch job.
        </p>
      ) : null}

      {upcoming ? <RescheduleBox job={job} viewer="customer" otherName={m.firstName} propose={proposeNewTime.bind(null, job.id)} answer={(accept) => answerNewTime.bind(null, job.id, accept)} /> : null}

      {q ? <EstimateVersions q={q} viewer="customer" /> : null}
      <ScopeHistory job={job} />

      <BookingVerification at={job.verificationAtBooking} current={m} firstName={m.firstName} />

      {job.status === "awaiting_customer" || job.status === "completed" ? (
        <section id="payment" className="scroll-mt-24 space-y-3">
          <h2 className="heading text-[1.0625rem]">Payment</h2>
          <PaymentFacts job={job} viewer="customer" otherName={m.firstName} />
          <form action={reportPaymentAsCustomer.bind(null, job.id)} className="space-y-2">
            <PaymentFields legend="Update what you've paid" required />
            <button className="btn btn-line min-h-11">Save payment note</button>
          </form>
        </section>
      ) : null}

      {q?.scope ? (
        <section>
          <h2 className="heading text-[1.0625rem]">Approved scope</h2>
          <p className="mt-1 text-[0.9375rem] leading-relaxed text-ink-2">{q.scope}</p>
          {job.finalAmountCents ? (
            <p className="tnum mt-2 text-[0.9375rem]">
              Final labor and fees: <span className="font-bold">{usd(job.finalAmountCents)}</span>
              {q ? <span className="text-ink-3"> · estimated {usd(jobValueCents({ ...job, finalAmountCents: undefined }, q))}, parts billed separately</span> : null}
            </p>
          ) : null}
        </section>
      ) : null}

      {job.status === "completed" && (
        <section aria-label="Repair record" className="border-2 border-ink">
          <div className="flex flex-wrap items-center gap-4 border-b border-rule px-5 py-4">
            <PhotoPrint photoUrl={m.photoUrl} initials={m.initials} name={m.displayName} size={52} />
            <div className="min-w-0 flex-1">
              <p className="heading text-[1.25rem]">{job.title}</p>
              <p className="text-[0.875rem] text-ink-2">
                {vehicleLine(v)} · by {m.firstName} · {dayMonth(job.completedAt)}
              </p>
            </div>
            <Link href={`/customer/vehicles/${v.id}`} className="btn btn-line min-h-11 text-sm">
              View repair record
            </Link>
          </div>
          {photos.length > 0 ? (
            <ul className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4">
              {photos.map((ph) => (
                <li key={ph.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ph.url} alt={`${ph.kind} photo`} className="aspect-square w-full border border-rule object-cover" />
                  <p className="mt-1 text-[0.75rem] capitalize text-ink-2">{ph.kind}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-3 text-[0.875rem] text-ink-3">No photos were attached to this job.</p>
          )}
          <p className="flex items-center gap-2 border-t border-rule-soft px-5 py-3 text-[0.875rem] text-carbon">
            <Tick size={15} /> On {m.firstName}&apos;s record, verified through a Clutch job
          </p>
        </section>
      )}

      {req.media.length > 0 && (
        <section>
          <h2 className="heading text-[1.0625rem]">Photos & documents</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {req.media.map((x) => (
              <MediaThumb key={x.id} m={x} size={88} />
            ))}
          </div>
        </section>
      )}

      {job.status === "completed" &&
        (review ? (
          sp.editReview ? (
            <form id="review" action={submitReview.bind(null, job.id)} className="scroll-mt-24 space-y-4">
              <input type="hidden" name="edit" value="1" />
              <h2 className="heading text-[1.375rem]">Edit your review</h2>
              <p className="text-[0.9375rem] text-ink-2">It still counts once toward {m.firstName}&apos;s rating. Your earlier version is kept in the record.</p>
              <div className="border-t border-rule">
                <Rating name="overall" label="Overall" value={review.overall} />
                <Rating name="workmanship" label="Workmanship" value={review.workmanship ?? 5} />
                <Rating name="communication" label="Communication" value={review.communication ?? 5} />
                <Rating name="timeliness" label="Timeliness" value={review.timeliness ?? 5} />
                <Rating name="priceAccuracy" label="Final price matched the estimate" value={review.priceAccuracy ?? 5} />
              </div>
              <label className="block">
                <span className="field-label">Comment (optional)</span>
                <textarea name="comment" rows={3} defaultValue={review.comment} className="input mt-1" />
              </label>
              <div className="flex flex-wrap gap-3">
                <button className="btn btn-ink">Save changes</button>
                <Link href={`/customer/jobs/${job.id}#review`} className="btn btn-quiet">
                  Keep it as it is
                </Link>
              </div>
            </form>
          ) : (
          <div id="review" className="sheet scroll-mt-24 space-y-2 p-5">
            <p className="flex items-center gap-2 font-semibold text-carbon">
              <Tick size={16} /> Verified review posted{review.updatedAt ? <span className="font-normal text-ink-3"> · edited {dayMonth(review.updatedAt)}</span> : null}
            </p>
            <p className="flex items-center gap-2">
              <StarRating value={review.overall} size={20} labelled />
              <span className="tnum text-[1.0625rem] font-semibold">{review.overall}/5</span>
            </p>
            {review.comment ? <p className="text-ink-2">{review.comment}</p> : null}
            <Link href={`/customer/jobs/${job.id}?editReview=1#review`} className="link text-[0.875rem]">
              Edit your review
            </Link>
          </div>
          )
        ) : (
          <form id="review" action={submitReview.bind(null, job.id)} className="scroll-mt-24 space-y-4">
            <div>
              <h2 className="heading text-[1.375rem]">How did {m.firstName} do?</h2>
              <p className="text-[0.9375rem] text-ink-2">You hired {m.firstName} for this repair, so your review counts toward their verified rating.</p>
            </div>
            <div className="border-t border-rule">
              <Rating name="overall" label="Overall" />
              <Rating name="workmanship" label="Workmanship" />
              <Rating name="communication" label="Communication" />
              <Rating name="timeliness" label="Timeliness" />
              <Rating name="priceAccuracy" label="Final price matched the estimate" />
            </div>
            <label className="block">
              <span className="field-label">Anything others should know? (optional)</span>
              <textarea name="comment" rows={3} className="input mt-1" />
            </label>
            <ReviewPhoto />
            <button className="btn btn-ink">Post verified review</button>
          </form>
        ))}

      {job.status === "completed" && (
        <section aria-label={`Use ${m.firstName} again`} className="sheet flex flex-wrap items-center gap-4 p-5">
          <PhotoPrint photoUrl={m.photoUrl} initials={m.initials} name={m.displayName} size={56} />
          <div className="min-w-0 flex-1">
            <p className="heading text-[1.25rem]">Want to use {m.firstName} again?</p>
            <p className="text-[0.875rem] text-ink-2">Rebooking sends your next request straight to {m.firstName}, with this repair attached.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SaveMechanicButton mechanicId={m.id} saved={saved} />
            <Link href={`/customer/requests/new?rebook=${m.slug}&vehicle=${v.id}&make=${encodeURIComponent(v.make)}`} className="btn btn-ink min-h-11">
              Rebook {m.firstName}
            </Link>
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-5">
        <Link href={`/customer/requests/${req.id}`} className="btn btn-quiet">
          Original request
        </Link>
        <Link href={`/customer/help?job=${job.id}`} className="btn btn-quiet">
          <LifeBuoy size={15} aria-hidden /> Get help with this repair
        </Link>
        {upcoming && (
          <form action={cancelRepair.bind(null, job.id)} className="ml-auto">
            <ConfirmButton
              message={`Cancel your booking with ${m.firstName}? They'll be told right away. This can't be undone; you'd need to request a new estimate.`}
              className="min-h-11 px-2 text-[0.875rem] text-ink-3 underline decoration-rule underline-offset-2 hover:text-ink"
            >
              Cancel booking
            </ConfirmButton>
          </form>
        )}
      </div>
      {upcoming ? (
        <p className="text-[0.8125rem] text-ink-3">
          You can cancel in Clutch until {m.firstName} starts; Clutch charges no fee. If parts were already bought for you, sort that out with {m.firstName}.
        </p>
      ) : job.status === "in_progress" ? (
        <p className="text-[0.8125rem] text-ink-3">Work has started, so the booking can&apos;t be cancelled in Clutch. Talk to {m.firstName}, or report a problem.</p>
      ) : null}
      <HistoryList entries={job.history ?? []} names={{ customer: "You", mechanic: m.firstName }} title="History of this repair" />
        </div>

        <aside className="lg:pt-10">
          <div className="sheet px-4 py-4 lg:sticky lg:top-20">
            <p className="field-label">Every step</p>
            <StatusTimeline steps={stages} className="mt-3" />
          </div>
        </aside>
      </div>
    </EvidenceProvider>
  );
}
