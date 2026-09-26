import Link from "next/link";
import type { PublicMechanicProfile } from "@/lib/domain/public-profile";
import type { ProfileStep } from "@/lib/domain/completeness";
import { eligibility, screeningItems } from "@/lib/domain/eligibility";
import { SCREENING_STYLE } from "@/components/trust/screening-style";

/**
 * Three separate measures instead of one "% complete": whether the public
 * profile is filled in, whether screening lets you quote and be booked, and
 * how much of your skill is proven. Proof never reaches "100%": it keeps growing,
 * and checks expire.
 */
export function Standing({ p, steps }: { p: PublicMechanicProfile; steps: ProfileStep[] }) {
  const basics = steps.filter((s) => !s.requiredForWork && ["Basic information and bio", "Profile photo", "Service area", "Services you offer", "Pricing"].includes(s.label));
  const basicsDone = basics.filter((s) => s.done).length;
  const nextBasic = basics.find((s) => !s.done);
  const e = eligibility(p);
  const items = screeningItems(p);
  const verifiedCreds = p.credentials.filter((c) => c.provenance !== "self" && (c.status === "verified" || c.status === "reverification_required")).length;
  const selfCount = p.selfReported.repairs.length + p.selfReported.claims.length;
  const box = "border border-rule bg-sheet p-4";
  return (
    <section aria-label="Account status" className="grid gap-3 md:grid-cols-3">
      <div className={box}>
        <p className="field-label">Public profile</p>
        <p className="mt-1">
          <span className="num text-[1.75rem]">{basicsDone}</span>
          <span className="text-ink-2"> of {basics.length} basics</span>
        </p>
        {nextBasic ? (
          <p className="mt-1 text-[0.875rem]">
            Next:{" "}
            <Link href={nextBasic.href} className="font-semibold underline decoration-rule underline-offset-2">
              {nextBasic.label.toLowerCase()}
            </Link>
            <span className="block text-[0.8125rem] text-ink-2">{nextBasic.why}</span>
          </p>
        ) : (
          <p className="mt-1 text-[0.875rem] text-ink-2">Everything customers expect to see is filled in.</p>
        )}
      </div>
      <div className={`${box} ${e.tone === "stop" ? "border-alert" : e.tone === "warn" ? "border-amber" : ""}`}>
        <p className="field-label">Safety screening</p>
        <p className={`mt-1 font-bold ${e.tone === "stop" ? "text-alert" : e.tone === "warn" ? "text-amber" : ""}`}>
          {e.eligible ? (e.tone === "warn" ? "You can quote and be booked. Renewal due." : "You can quote and be booked") : "You can't quote or be booked yet"}
        </p>
        <ul className="mt-2 space-y-1 text-[0.8125rem]">
          {items.map((i) => {
            const S = SCREENING_STYLE[i.state];
            return (
              <li key={i.key} className="flex items-center gap-1.5">
                <S.icon size={14} aria-hidden className={i.state === "verified" ? "text-carbon" : i.state === "expiring" ? "text-amber" : i.state === "expired" || i.state === "rejected" ? "text-alert" : "text-ink-3"} />
                {i.privateLabel}
              </li>
            );
          })}
        </ul>
        {e.tone !== "ok" ? (
          <Link href="/mechanic/verification" className="mt-2 inline-block text-[0.875rem] font-semibold underline decoration-rule underline-offset-2">
            Go to Verification Center
          </Link>
        ) : null}
      </div>
      <div className={box}>
        <p className="field-label">Proven experience</p>
        <p className="mt-1">
          <span className="num text-[1.75rem]">{p.reputation.verifiedRepairs}</span>
          <span className="text-ink-2"> verified repairs</span>
        </p>
        <p className="text-[0.8125rem] text-ink-2">
          {verifiedCreds} verified {verifiedCreds === 1 ? "credential" : "credentials"} · {selfCount} self-reported {selfCount === 1 ? "claim" : "claims"} still unproven
        </p>
        <Link href="/mechanic/repairs" className="mt-2 inline-block text-[0.875rem] font-semibold underline decoration-rule underline-offset-2">
          Add proof of past work
        </Link>
      </div>
    </section>
  );
}
