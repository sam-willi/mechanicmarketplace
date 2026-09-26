import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CreditCard, Eye, Lock } from "lucide-react";
import { ready, repo } from "@/lib/data";
import { getSession } from "@/lib/session";
import { vehicleLine } from "@/lib/domain/intake";
import { findArea, milesBetween } from "@/lib/domain/areas";
import { jobValueCents, mechanicJobStatus } from "@/lib/domain/status";
import { jobLifecycle } from "@/lib/domain/lifecycle";
import { eligibility } from "@/lib/domain/eligibility";
import { quoteTotals } from "@/lib/domain/quote";
import { toPublicProfile } from "@/lib/domain/public-profile";
import { usd } from "@/lib/format";
import {
  attachJobPhotos,
  cancelJobAsMechanic,
  markJobDone,
  recordDiagnosis,
  requestScopeChange,
  saveJobNotes,
  startJob,
} from "@/app/actions/mechanic";
import { RepairPhotoUploader } from "@/components/mechanic/photo-uploader";
import { StatusChip } from "@/components/app/status-chip";
import { ConfirmButton } from "@/components/app/confirm-button";
import { DeclineForm } from "@/components/mechanic/decline-form";
import { ConfirmDecide } from "@/components/mechanic/confirm-decide";
import { LifecycleRail, NowPanel } from "@/components/app/job-lifecycle";
import { EligibilityNotice } from "@/components/trust/eligibility-notice";
import { RequestSummary } from "@/components/request/request-summary";
import { VehicleSpecCard } from "@/components/vehicle/spec-card";
import { configsFor, DRIVE_LABEL, ENGINES, TRANSMISSIONS } from "@/lib/vehicles/catalog";
import { MediaThumb } from "@/components/request/media-capture";

export const metadata: Metadata = { title: "Job" };

export default async function MechanicJob({ params }: { params: Promise<{ id: string }> }) {
  await ready();
  const s = await getSession();
  if (s.role !== "mechanic") return null;
  const { id } = await params;
  const j = repo.getJob(id);
  if (!j || j.mechanicId !== s.mechanicId) notFound();
  const m = repo.getMechanic(s.mechanicId)!;
  const r = repo.getRequest(j.requestId)!;
  const v = repo.getVehicle(j.vehicleId)!;
  const c = repo.getCustomer(j.customerId)!;
  const q = repo.getQuote(j.quoteId);
  const user = repo.getUser(c.userId);
  const status = mechanicJobStatus(j);
  const area = findArea(r.location.area);
  const first = c.displayName.split(" ")[0];
  const open = j.status === "scheduled" || j.status === "in_progress";
  const past = repo.listCustomerHistory(c.id).filter((h) => h.mechanicId === m.id && h.jobId !== j.id);
  const { stages, current } = jobLifecycle(j, repo.getReviewForJob(j.id), { customer: first, mechanic: m.firstName }, "mechanic");
  const elig = eligibility(toPublicProfile(repo.getMechanicSources(m.id)));
  const photos = j.photos ?? [];
  const scopePending = j.scopeChange?.status === "pending";
  // Open configuration items the mechanic can settle at completion (options from the factory data).
  const js = j.vehicleSpec ?? v.spec;
  const cfgs = configsFor(v.year, v.make, v.model);
  const confirmables = [
    js?.engine?.status === "needs_confirmation" || js?.engine?.status === "likely"
      ? { name: "engine", label: "Engine", options: [...new Set(cfgs.map((c) => c.engine))].map((e) => ({ id: e, label: ENGINES[e].label })) }
      : null,
    js?.transmission?.status === "needs_confirmation" || js?.transmission?.status === "likely"
      ? { name: "transmission", label: "Transmission", options: [...new Set(cfgs.flatMap((c) => c.transmissions))].map((t) => ({ id: t, label: TRANSMISSIONS[t].label })) }
      : null,
    js?.drivetrain?.status === "needs_confirmation" || js?.drivetrain?.status === "likely"
      ? { name: "drivetrain", label: "Drivetrain", options: [...new Set(cfgs.flatMap((c) => c.drivetrains))].map((d) => ({ id: d, label: DRIVE_LABEL[d] })) }
      : null,
  ].filter((x): x is { name: string; label: string; options: { id: string; label: string }[] } => Boolean(x && x.options.length));

  const action = (() => {
    switch (current?.key) {
      case "confirmed":
        return (
          <ConfirmDecide jobId={j.id} when="" first={first} />
        );
      case "checked_in":
        return (
          <div className="space-y-3">
            {!elig.eligible ? <EligibilityNotice e={elig} audience="mechanic" /> : null}
            <form action={startJob.bind(null, j.id)}>
              <ConfirmButton disabled={!elig.eligible} message={`Check in and start now? ${first} gets a notification that you've arrived.`} className="btn btn-ink min-h-11 disabled:opacity-50">
                Check in and start
              </ConfirmButton>
            </form>
          </div>
        );
      case "diagnosis":
        return (
          <form action={recordDiagnosis.bind(null, j.id)} className="space-y-3">
            <label className="block">
              <span className="field-label">What you found (visible to {first})</span>
              <textarea name="note" required rows={3} className="input mt-1" placeholder="e.g. Front pads at 2 mm, rotors scored below minimum. Rear pads fine." />
            </label>
            <fieldset className="flex flex-wrap gap-2">
              <legend className="field-label mb-1">Does it match the approved estimate?</legend>
              {(
                [
                  ["yes", "Yes, same work and price"],
                  ["no", "No, I found something else"],
                ] as const
              ).map(([val, label]) => (
                <label key={val} className="flex min-h-11 cursor-pointer items-center gap-2 border border-rule bg-sheet px-3 has-[:checked]:border-brand has-[:checked]:font-semibold">
                  <input type="radio" name="matches" value={val} defaultChecked={val === "yes"} className="accent-[var(--ink)]" /> {label}
                </label>
              ))}
            </fieldset>
            <p className="text-[0.8125rem] text-ink-3">If it doesn&apos;t match, you&apos;ll ask {first} to approve the extra work next. Nothing extra happens without their yes.</p>
            <button className="btn btn-ink min-h-11">Share with {first}</button>
          </form>
        );
      case "scope":
        return (
          <p className="text-[0.9375rem]">
            You asked for: <span className="font-semibold">{j.scopeChange?.description}</span> ({usd(j.scopeChange?.extraCents ?? 0)} extra). Don&apos;t start the extra work until {first}{" "}
            approves.
          </p>
        );
      case "working":
      case "completion":
        return (
          <div className="space-y-5">
            <div>
              <p className="font-semibold">1. Add photos</p>
              <p className="text-[0.875rem] text-ink-2">Before, after and old parts. Once {first} confirms, they appear on your profile as verified repair photos.</p>
              {photos.length ? (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {photos.map((ph) => (
                    <li key={ph.id}>
                      {ph.media === "video" ? (
                        <video src={ph.url} muted preload="metadata" className="size-20 border border-rule object-cover" aria-label={`${ph.kind} video`} />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={ph.url} alt={`${ph.kind} photo`} className="size-20 border border-rule object-cover" />
                      )}
                      <p className="mt-0.5 text-[0.6875rem] text-ink-2 capitalize">{ph.kind}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-2">
                <RepairPhotoUploader attach={attachJobPhotos.bind(null, j.id)} note="Keep licence plates, faces and house numbers out of frame." />
              </div>
            </div>
            <form action={markJobDone.bind(null, j.id)} className="space-y-3 border-t border-rule-soft pt-4">
              <p className="font-semibold">2. Final amount and notes</p>
              <label className="block">
                <span className="field-label">Final amount for labor and fees ($)</span>
                <input name="finalAmount" inputMode="decimal" defaultValue={q ? jobValueCents(j, q) / 100 + (j.scopeChange?.status === "approved" ? j.scopeChange.extraCents / 100 : 0) : undefined} className="input tnum mt-1" />
              </label>
              {confirmables.length ? (
                <fieldset className="border border-amber/60 bg-amber-wash/40 p-3">
                  <legend className="px-1 text-[0.875rem] font-bold">Confirm the car&apos;s configuration</legend>
                  <p className="text-[0.8125rem] text-ink-2">These weren&apos;t confirmed by a VIN or the customer. What you confirm goes on the repair record; leave any you didn&apos;t check.</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    {confirmables.map((c) => (
                      <label key={c.name} className="block">
                        <span className="field-label">{c.label}</span>
                        <select name={`confirm_${c.name}`} className="input mt-1" defaultValue="">
                          <option value="">Didn&apos;t check</option>
                          {c.options.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              <label className="block">
                <span className="field-label flex items-center gap-1.5">
                  <Eye size={13} aria-hidden /> Notes for {first} (they&apos;ll see these)
                </span>
                <textarea name="completionNotes" rows={2} className="input mt-1" placeholder="What you did and anything to watch for." />
              </label>
              <ConfirmButton
                message={`Mark this repair complete?\n\n${first} will be asked to confirm. ${photos.length ? `${photos.length} photo(s) attached.` : "No photos attached yet."}`}
                className="btn btn-ink min-h-11"
              >
                Mark complete
              </ConfirmButton>
            </form>
            {!j.scopeChange ? (
              <details className="border-t border-rule-soft pt-3">
                <summary className="min-h-11 cursor-pointer content-center text-[0.875rem] font-semibold">Found more work? Ask {first} to approve it first</summary>
                <form action={requestScopeChange.bind(null, j.id)} className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem]">
                  <input name="description" required className="input" placeholder="e.g. Replace seized rear caliper" aria-label="Extra work" />
                  <input name="extra" inputMode="decimal" required className="input tnum" placeholder="Extra $" aria-label="Extra cost in dollars" />
                  <button className="btn btn-line min-h-11 sm:col-span-2">Send for approval</button>
                </form>
              </details>
            ) : null}
          </div>
        );
      default:
        return null;
    }
  })();

  return (
    <div className="space-y-6">
      <Link href="/mechanic/jobs" className="inline-flex min-h-11 items-center gap-1.5 text-[0.875rem] text-ink-3 hover:text-ink">
        <ArrowLeft size={14} aria-hidden /> My Jobs
      </Link>
      <div className="border-b-2 border-ink pb-4">
        <StatusChip label={status} />
        <h1 className="display mt-2 text-[1.875rem] sm:text-[2.25rem]">{j.title}</h1>
        <p className="mt-1 text-ink-2">
          {vehicleLine(v)} · {first} · {j.scheduledFor}
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-6">
          <NowPanel current={current}>{action}</NowPanel>
          <div className="sheet p-4">
            <VehicleSpecCard v={v} spec={j.vehicleSpec ?? v.spec} category={j.repairCategory} audience="mechanic" revealVin />
          </div>
          {!current && j.status === "completed" ? <p className="border border-ink bg-sheet px-4 py-3">Done. This repair is on your verified record.</p> : null}
          {scopePending ? null : j.diagnosis ? (
            <p className="text-[0.9375rem]">
              <span className="font-semibold">Your diagnosis:</span> {j.diagnosis.note}
            </p>
          ) : null}

          <p className="flex gap-2.5 border border-rule bg-sheet px-4 py-3 text-[0.875rem]">
            <CreditCard size={17} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              <span className="font-semibold">Payment:</span> collect it from {first} directly. Clutch records the final amount for your earnings and the repair record, but
              doesn&apos;t process payments.
            </span>
          </p>

          <dl className="border-t border-rule">
            {[
              ["Customer", `${c.displayName}${past.length ? ` · ${past.length} earlier ${past.length === 1 ? "job" : "jobs"} with you` : ""}`],
              ["Contact", user?.phone ?? user?.email ?? "Shared via Clutch"],
              ["Approved estimate", q ? `${quoteTotals(q).planFor} · ${quoteTotals(q).partsLine}` : "Not available"],
              ["Scope", q?.scope ?? j.title],
              ["Schedule", j.scheduledFor],
              ["Location", `${r.location.address ?? "Address to follow"}${area ? ` · ${area.label} · ${Math.round(milesBetween(m, area))} mi` : ""}`],
              ["Access", r.location.accessInstructions ?? (r.location.serviceMode === "shop" ? "Customer brings it to your shop" : "Customer will be there")],
            ].map(([k, val]) => (
              <div key={k} className="grid gap-1 border-b border-rule-soft py-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
                <dt className="field-label pt-0.5">{k}</dt>
                <dd className="text-[0.9375rem]">{val}</dd>
              </div>
            ))}
          </dl>

          {/* Private, and visibly so */}
          <form action={saveJobNotes.bind(null, j.id)} className="space-y-2 border border-dashed border-ink-3 bg-paper p-4">
            <p className="flex items-center gap-1.5 font-semibold">
              <Lock size={15} aria-hidden /> Private notes
            </p>
            <p className="text-[0.8125rem] text-ink-3">Only you can see these. Never shown to {first} or on your profile.</p>
            <textarea name="notes" rows={3} defaultValue={j.mechanicNotes} className="input" aria-label="Private notes" placeholder="Parts to bring, torque specs, follow-ups." />
            <button className="btn btn-quiet min-h-11 text-sm">Save private notes</button>
          </form>

          {r.questions.filter((x) => x.mechanicId === m.id).length > 0 && (
            <section className="space-y-2">
              <h2 className="heading text-[1.125rem]">Questions with {first}</h2>
              {r.questions
                .filter((x) => x.mechanicId === m.id)
                .map((x) => (
                  <div key={x.askedAt + x.question} className="border-t border-rule-soft pt-2 text-[0.9375rem]">
                    <p>
                      <span className="font-semibold">You:</span> {x.question}
                    </p>
                    {x.response ? <p className="text-ink-2">{x.response}</p> : null}
                    <div className="mt-1 flex flex-wrap gap-2">
                      {x.attachments.map((a) => (
                        <MediaThumb key={a.id} m={a} size={72} />
                      ))}
                    </div>
                  </div>
                ))}
            </section>
          )}

          <details className="border-t border-rule pt-4">
            <summary className="min-h-11 cursor-pointer content-center font-semibold">The original request</summary>
            <div className="mt-4">
              <RequestSummary r={r} v={v} revealPrivate audience="mechanic" />
            </div>
          </details>

          {open && current?.key !== "confirmed" && (
            <div className="border-t border-rule pt-4">
              <DeclineForm
                danger
                action={cancelJobAsMechanic.bind(null, j.id)}
                summary="Cancel this job"
                note={`${first} is told right away and shown other mechanics. Cancelling booked work affects your record.`}
                confirm={`Cancel this job with ${first}? It can't be undone.`}
                submit="Cancel this job"
              />
            </div>
          )}
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <LifecycleRail stages={stages} />
        </aside>
      </div>
    </div>
  );
}
