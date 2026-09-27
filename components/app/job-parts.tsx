import { CalendarClock } from "lucide-react";
import type { Job, PaymentReport, Quote } from "@/lib/domain/types";
import { quoteTotals } from "@/lib/domain/quote";
import { dayMonth, usd } from "@/lib/format";
import { ConfirmButton } from "./confirm-button";

type FormAction = (formData: FormData) => void | Promise<void>;

/** "Paid / not paid yet" and an amount. Self-reported: Clutch never collects card or bank details. */
export function PaymentFields({ legend, required = false }: { legend: string; required?: boolean }) {
  return (
    <fieldset className="space-y-2">
      <legend className="field-label">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["paid", "Paid"],
            ["not_paid", "Not paid yet"],
          ] as const
        ).map(([v, label]) => (
          <label key={v} className="flex min-h-11 cursor-pointer items-center gap-2 border border-rule bg-sheet px-3 has-[:checked]:border-brand has-[:checked]:font-semibold">
            <input type="radio" name="paid" value={v} required={required} className="accent-[var(--ink)]" /> {label}
          </label>
        ))}
        <label className="flex min-h-11 items-center gap-2">
          <span className="text-[0.875rem] text-ink-2">Amount $</span>
          <input name="paidAmount" inputMode="decimal" className="input tnum w-28" aria-label="Amount in dollars (optional)" />
        </label>
      </div>
      <p className="text-[0.8125rem] text-ink-3">Recorded as you enter it. Clutch doesn&apos;t process, hold or refund payments.</p>
    </fieldset>
  );
}

function paymentLine(p: PaymentReport | undefined) {
  if (!p) return "Nothing entered";
  return `${p.status === "paid" ? "Paid" : "Not paid yet"}${p.amountCents !== undefined ? `, ${usd(p.amountCents)}` : ""} (entered ${dayMonth(p.at)})`;
}

/** What each side says about payment, side by side, labelled as self-reported. */
export function PaymentFacts({ job, viewer, otherName }: { job: Job; viewer: "customer" | "mechanic"; otherName: string }) {
  const mine = viewer === "customer" ? job.payment?.customer : job.payment?.mechanic;
  const theirs = viewer === "customer" ? job.payment?.mechanic : job.payment?.customer;
  return (
    <dl className="grid gap-x-6 border-t border-rule text-[0.9375rem] sm:grid-cols-2">
      <div className="border-b border-rule-soft py-2">
        <dt className="text-[0.8125rem] text-ink-3">You said</dt>
        <dd>{paymentLine(mine)}</dd>
      </div>
      <div className="border-b border-rule-soft py-2">
        <dt className="text-[0.8125rem] text-ink-3">{otherName} said</dt>
        <dd>{paymentLine(theirs)}</dd>
      </div>
      {mine && theirs && (mine.status !== theirs.status || (mine.amountCents !== undefined && theirs.amountCents !== undefined && mine.amountCents !== theirs.amountCents)) ? (
        <p className="py-2 text-[0.875rem] font-semibold text-amber sm:col-span-2">These don&apos;t match. Sort it out directly, or report a problem to Clutch staff.</p>
      ) : null}
    </dl>
  );
}

/**
 * Suggest a new time, or answer the other side's suggestion. The booked time only changes
 * when the other side accepts; until then the original booking stands.
 */
export function RescheduleBox({
  job,
  viewer,
  otherName,
  propose,
  answer,
}: {
  job: Job;
  viewer: "customer" | "mechanic";
  otherName: string;
  propose: FormAction;
  answer: (accept: boolean) => FormAction;
}) {
  const rs = job.reschedule;
  const pending = rs?.status === "pending";
  const theirs = pending && rs.proposedBy !== viewer;
  return (
    <section id="reschedule" aria-labelledby="reschedule-title" className="scroll-mt-24 space-y-3 border border-rule bg-sheet p-4">
      <h2 id="reschedule-title" className="flex items-center gap-2 font-bold">
        <CalendarClock size={17} aria-hidden /> Booked for {job.scheduledFor}
      </h2>
      {theirs ? (
        <div className="space-y-2">
          <p className="text-[0.9375rem]">
            {otherName} suggested <span className="font-semibold">{rs.when}</span> instead.
            {rs.note ? <span className="block text-ink-2">&ldquo;{rs.note}&rdquo;</span> : null}
          </p>
          <div className="flex flex-wrap gap-2">
            <form action={answer(true)}>
              <ConfirmButton message={`Change the booking to ${rs.when}?`} className="btn btn-ink min-h-11">
                Accept new time
              </ConfirmButton>
            </form>
            <form action={answer(false)}>
              <button className="btn btn-line min-h-11">Keep {job.scheduledFor}</button>
            </form>
          </div>
        </div>
      ) : pending ? (
        <p className="text-[0.9375rem] text-ink-2">
          You suggested <span className="font-semibold text-ink">{rs.when}</span>. Waiting for {otherName}; until they accept, the original time stands.
        </p>
      ) : rs && rs.status !== "pending" ? (
        <p className="text-[0.875rem] text-ink-3">
          Last suggestion ({rs.when}) was {rs.status === "accepted" ? "accepted" : "declined"}.
        </p>
      ) : null}
      {!theirs ? (
        <details>
          <summary className="min-h-11 cursor-pointer content-center text-[0.9375rem] font-semibold">{pending ? "Suggest a different time" : "Need a different time?"}</summary>
          <form action={propose} className="mt-2 grid gap-2 sm:grid-cols-[10rem_8rem_minmax(0,1fr)_auto] sm:items-end">
            <label className="block">
              <span className="field-label">Date</span>
              <input type="date" name="date" required className="input mt-1" />
            </label>
            <label className="block">
              <span className="field-label">Time</span>
              <input type="time" name="time" required className="input mt-1" />
            </label>
            <label className="block">
              <span className="field-label">Note (optional)</span>
              <input name="note" maxLength={300} className="input mt-1" />
            </label>
            <button className="btn btn-line min-h-11">Suggest</button>
          </form>
        </details>
      ) : null}
    </section>
  );
}

/** The accepted estimate, and every earlier version the mechanic sent, so price changes are never silent. */
export function EstimateVersions({ q, viewer }: { q: Quote; viewer: "customer" | "mechanic" }) {
  const t = quoteTotals(q);
  const versions = q.revisions ?? [];
  return (
    <section aria-labelledby="versions-title" className="space-y-2">
      <h2 id="versions-title" className="heading text-[1.0625rem]">
        Estimate
      </h2>
      <p className="text-[0.9375rem]">
        {q.status === "accepted" || q.acceptedAt ? (
          <>
            {viewer === "customer" ? "You accepted" : "The customer accepted"} version {q.acceptedVersion ?? q.version ?? 1}
            {q.acceptedAt ? ` on ${dayMonth(q.acceptedAt)}` : ""}: <span className="num font-bold">{usd(q.acceptedTotalCents ?? t.total)}</span>{" "}
            <span className="text-ink-2">({t.partsLine.toLowerCase()})</span>. It can&apos;t be changed after acceptance.
          </>
        ) : (
          <>
            Version {q.version ?? 1}: <span className="num font-bold">{t.planFor}</span>
          </>
        )}
      </p>
      {versions.length ? (
        <details>
          <summary className="min-h-11 cursor-pointer content-center text-[0.875rem] font-semibold">Earlier versions ({versions.length})</summary>
          <ul className="mt-1 border-t border-rule text-[0.875rem]">
            {versions.map((v) => (
              <li key={v.version} className="flex flex-wrap justify-between gap-2 border-b border-rule-soft py-1.5">
                <span>
                  Version {v.version} · sent {dayMonth(v.sentAt)} · {v.availableOn}
                </span>
                <span className="tnum font-semibold">{usd(v.totalCents)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/** Every extra-work request on the job and what the customer said. */
export function ScopeHistory({ job }: { job: Job }) {
  const all = [...(job.scopeChangeHistory ?? []), ...(job.scopeChange ? [job.scopeChange] : [])];
  if (!all.length) return null;
  return (
    <section aria-labelledby="extra-title" className="space-y-2">
      <h2 id="extra-title" className="heading text-[1.0625rem]">
        Extra work requests
      </h2>
      <ul className="border-t border-rule text-[0.9375rem]">
        {all.map((x) => (
          <li key={x.requestedAt} className="flex flex-wrap justify-between gap-2 border-b border-rule-soft py-2">
            <span>{x.description}</span>
            <span className={`tnum font-semibold ${x.status === "declined" ? "text-ink-3 line-through" : ""}`}>
              +{usd(x.extraCents)} · {x.status === "pending" ? "waiting for approval" : x.status}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
