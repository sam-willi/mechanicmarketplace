import Link from "next/link";
import { ArrowRight, Check, Send, UserX } from "lucide-react";
import type { RepairRequest } from "@/lib/domain/types";
import type { Replacement } from "@/lib/replacement";
import { sendToMoreMechanics, sendToReplacement } from "@/app/actions/customer";
import { quoteTotals } from "@/lib/domain/quote";
import { PhotoPrint } from "@/components/profile/photo";
import { AvailabilityPill } from "@/components/visual/availability";

/**
 * Shown when the mechanic the customer picked declines or cancels. Leads with
 * estimates they already have, then up to three mechanics likely to be good,
 * chosen by the same rules as Best Fit. One tap sends the same request on.
 */
export function ReplacementPanel({ r, rep }: { r: RepairRequest; rep: Replacement }) {
  const { lost } = rep;
  const [top, ...rest] = rep.suggestions;
  const anyStrong = rep.suggestions.some((s) => s.strong);
  return (
    <section aria-labelledby="replacement-title" className="mt-6 border-2 border-brand-deep bg-sheet">
      <div className="flex gap-3 border-b-4 border-brass bg-brand-deep px-5 py-4 text-on-brand">
        <UserX size={20} className="mt-1 shrink-0 text-brass" aria-hidden />
        <div>
          <h2 id="replacement-title" className="heading text-[1.25rem] text-on-brand sm:text-[1.375rem]">
            {lost.cancelledJob ? `${lost.firstName} cancelled your booking` : `${lost.firstName} can't take this job`}
          </h2>
          <p className="mt-1 text-[0.9375rem] text-on-brand-2">
            {lost.reason ? `${lost.reason} ` : ""}
            {rep.openQuotes.length || rep.suggestions.length
              ? "Here's who else could do it. Your request goes as it is, so there's nothing to fill in again."
              : null}
          </p>
        </div>
      </div>

      <div className="space-y-6 p-4 sm:p-5">
        {rep.openQuotes.length ? (
          <div>
            <h3 className="field-label">Estimates you already have</h3>
            <p className="mt-1 text-[0.875rem] text-ink-2">These mechanics already priced this job and can still be booked.</p>
            <ul className="mt-3 divide-y divide-rule-soft border-y border-rule-soft">
              {rep.openQuotes.map(({ q, p }) => (
                <li key={q.id} className="flex flex-wrap items-center gap-3 py-3">
                  <PhotoPrint photoUrl={p.photoUrl} initials={p.initials} name={p.displayName} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{p.displayName}</p>
                    <p className="text-[0.8125rem] text-ink-2">
                      Plan for {quoteTotals(q).planFor} · {q.availableOn}
                    </p>
                  </div>
                  <Link href={`/customer/quotes/${q.id}`} className="btn btn-line min-h-11">
                    Review estimate <ArrowRight size={15} aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {top ? (
          <div>
            <h3 className="field-label">{anyStrong ? `Likely good fits for ${rep.context}` : "Closest matches we have"}</h3>
            <p className="mt-1 max-w-[62ch] text-[0.875rem] text-ink-2">
              {anyStrong
                ? "Picked the way Best Fit is: Clutch-verified repairs on this car and repair, serving your area, with fully verified mechanics first only at equal experience. Each shows which checks Clutch has verified. Nobody pays to appear here."
                : `No one else has strong verified experience with ${rep.context} yet. These are the closest, based on what's on their records.`}
            </p>
            <ul className="mt-3 grid gap-3 lg:grid-cols-3">
              {[top, ...rest].map((s, i) => {
                const p = s.fit.p;
                const lead = i === 0 && s.strong;
                return (
                  <li key={p.id} className={`flex flex-col border bg-sheet ${lead ? "border-2 border-brand" : "border-rule"}`}>
                    {lead ? <p className="bg-brand px-4 py-1.5 text-[0.8125rem] font-bold text-on-brand">Recommended next</p> : null}
                    <div className="flex flex-1 flex-col p-4">
                      <div className="flex gap-3">
                        <PhotoPrint photoUrl={p.photoUrl} initials={p.initials} name={p.displayName} size={56} />
                        <div className="min-w-0">
                          <p className="heading text-[1.0625rem]">{p.displayName}</p>
                          <div className="mt-1">
                            <AvailabilityPill openings={p.openings} size="sm" />
                          </div>
                        </div>
                      </div>
                      {s.dominant ? (
                        <p className="mt-3 flex items-baseline gap-2">
                          <span className="num text-[2rem]">{s.dominant.n}</span>
                          <span className="text-[0.9375rem] font-semibold">{s.dominant.text}</span>
                        </p>
                      ) : null}
                      {s.reasons.length ? (
                        <ul className="mt-2 space-y-1 text-[0.8125rem] text-ink-2">
                          {s.reasons.map((t) => (
                            <li key={t} className="flex gap-1.5">
                              <Check size={13} className="mt-0.5 shrink-0" aria-hidden /> {t}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-4">
                        <form action={sendToReplacement.bind(null, r.id, p.id)}>
                          <button className={`btn min-h-11 ${lead ? "btn-ink" : "btn-line"}`}>
                            <Send size={15} aria-hidden /> Send to {p.firstName}
                          </button>
                        </form>
                        <Link
                          href={`/mechanics/${p.slug}`}
                          className="text-[0.875rem] font-semibold underline decoration-rule underline-offset-[3px] hover:decoration-ink"
                        >
                          See record
                        </Link>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : !rep.openQuotes.length ? (
          <p className="text-[0.9375rem] text-ink-2">
            There&apos;s no other mechanic with verified {rep.context} work who serves your area yet.
            {rep.broaden.length
              ? " You can still send it to mechanics who list this kind of work."
              : " Your request stays open. You can edit it, for example to a nearby area, or cancel it."}
          </p>
        ) : null}

        {rep.broaden.length > 1 ? (
          <form action={sendToMoreMechanics.bind(null, r.id)} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule-soft pt-4">
            <p className="text-[0.875rem] text-ink-2">Would you rather compare prices?</p>
            <button className="btn btn-quiet min-h-11">Send it to {rep.broaden.length} more mechanics who match</button>
          </form>
        ) : null}
        <p className="text-[0.75rem] text-ink-3">The mechanic you send it to sees a new request. They aren&apos;t told who passed on it.</p>
      </div>
    </section>
  );
}

/** After the customer sent it on: a quiet record of what happened. */
export function HandoffNote({ r, names }: { r: RepairRequest; names: string[] }) {
  const last = (r.handoffs ?? []).at(-1);
  if (!last || !names.length) return null;
  return (
    <p className="mt-6 flex items-start gap-2 border border-rule bg-sheet px-4 py-3 text-[0.9375rem]">
      <Send size={16} className="mt-0.5 shrink-0 text-brand" aria-hidden />
      <span>
        Sent to {names.length === 1 ? names[0] : `${names.length} more mechanics`}. You&apos;ll see it here and in Notifications when{" "}
        {names.length === 1 ? "they reply" : "someone replies"}.
      </span>
    </p>
  );
}
