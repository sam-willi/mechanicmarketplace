import { ShieldAlert, CircleDashed } from "lucide-react";
import { INSURANCE_UNVERIFIED_NOTE, STATUS_WORD, type Eligibility } from "@/lib/domain/eligibility";

/**
 * Next to the primary action. "stop": the profile is incomplete, so no booking. "warn": can be
 * booked, but Clutch hasn't verified every check; the list says exactly which, and how.
 * Nothing here says a mechanic is safe, and nothing hides that a check is missing.
 */
export function EligibilityNotice({ e, audience = "customer", className = "", compact = false }: { e: Eligibility; audience?: "customer" | "mechanic"; className?: string; compact?: boolean }) {
  if (e.tone === "ok" && !e.expiring.length) return null;
  const stop = e.tone === "stop";
  const Icon = stop ? CircleDashed : ShieldAlert;
  const insuranceUnverified = e.unverified.some((c) => c.key === "insurance");
  return (
    <div role={stop ? "alert" : "status"} className={`flex gap-2.5 border px-3 py-2.5 text-[0.875rem] ${stop ? "border-alert bg-alert-wash text-alert" : "border-amber/60 bg-amber-wash text-amber"} ${className}`}>
      <Icon size={17} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-bold">
          {stop
            ? audience === "customer"
              ? "Can't be booked yet: profile incomplete"
              : "Finish your profile to receive requests and bookings"
            : e.unverified.length
              ? audience === "customer"
                ? `Clutch hasn't verified ${e.unverified.length === e.checks.length ? "any" : `${e.unverified.length} of ${e.checks.length}`} checks`
                : "Bookable, not fully verified"
              : "Verification renewal due soon"}
        </p>
        {compact || audience === "mechanic" ? (
          <p className="text-ink">{audience === "customer" ? e.customerLine : e.mechanicLine}</p>
        ) : e.unverified.length && !stop ? (
          <>
            <ul className="mt-1 space-y-0.5 text-ink">
              {e.checks.map((c) => (
                <li key={c.key}>
                  <span className="font-semibold">{c.name}:</span> {c.state === "expiring" ? `Verified, renews ${c.when}` : STATUS_WORD[c.state]}
                  {c.state === "expired" && c.when ? ` ${c.when}` : ""}
                </li>
              ))}
            </ul>
            {insuranceUnverified ? <p className="mt-1 text-ink">{INSURANCE_UNVERIFIED_NOTE}</p> : null}
          </>
        ) : (
          <p className="text-ink">{e.customerLine}</p>
        )}
      </div>
    </div>
  );
}
