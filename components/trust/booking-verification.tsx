import type { VerificationAtBooking } from "@/lib/domain/types";
import { INSURANCE_UNVERIFIED_NOTE, screeningItems, STATUS_WORD } from "@/lib/domain/eligibility";
import type { PublicMechanicProfile } from "@/lib/domain/public-profile";
import { dayMonth } from "@/lib/format";

/**
 * The mechanic's checks as they were when this repair was booked (and what the customer
 * acknowledged), next to the current status where it has changed since. The booking record
 * never changes; the current column is only information.
 */
export function BookingVerification({ at, current, firstName }: { at?: VerificationAtBooking; current: PublicMechanicProfile; firstName: string }) {
  if (!at) return null;
  const now = new Map(screeningItems(current).map((c) => [c.key, c]));
  const changed = at.checks.some((c) => now.get(c.key)?.state !== c.state);
  const insuranceUnverified = !(now.get("insurance")?.verified ?? false);
  return (
    <section id="verification" aria-labelledby="verification-title" className="scroll-mt-24 space-y-2">
      <h2 id="verification-title" className="heading text-[1.0625rem]">
        Verification when you booked
      </h2>
      <p className="text-[0.875rem] text-ink-2">
        {at.fullyVerified ? `Clutch had verified all of ${firstName}'s checks on ${dayMonth(at.capturedAt)}.` : `Recorded ${dayMonth(at.capturedAt)}. You confirmed you understood which checks Clutch hadn't verified.`}
      </p>
      <table className="w-full border-collapse text-left text-[0.9375rem]">
        <thead>
          <tr className="border-b border-ink">
            <th className="field-label py-1.5 pr-3 font-semibold">Check</th>
            <th className="field-label py-1.5 pr-3 font-semibold">When you booked</th>
            {changed ? <th className="field-label py-1.5 font-semibold">Now</th> : null}
          </tr>
        </thead>
        <tbody>
          {at.checks.map((c) => {
            const n = now.get(c.key);
            return (
              <tr key={c.key} className="border-b border-rule-soft">
                <td className="py-1.5 pr-3 font-semibold">{c.name}</td>
                <td className={`py-1.5 pr-3 ${c.verified ? "" : "font-semibold text-amber"}`}>{c.status}</td>
                {changed ? <td className="py-1.5">{n ? (n.state === "expiring" ? `Verified, renews ${n.when}` : n.state === "expired" && n.when ? `Expired ${n.when}` : STATUS_WORD[n.state]) : "Not applicable"}</td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      {at.acknowledgement ? (
        <p className="text-[0.8125rem] text-ink-3">
          You confirmed: &ldquo;{at.acknowledgement.text}&rdquo; ({dayMonth(at.acknowledgement.at)}, disclosure {at.acknowledgement.version})
        </p>
      ) : null}
      {insuranceUnverified ? <p className="text-[0.875rem]">{INSURANCE_UNVERIFIED_NOTE}</p> : null}
    </section>
  );
}
