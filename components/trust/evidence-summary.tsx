
import { StarRating } from "@/components/visual/stars";
import type { PublicMechanicProfile } from "@/lib/domain/public-profile";
import { repairNoun } from "@/lib/domain/provenance";
import type { RepairCategory, VehicleMake } from "@/lib/domain/types";
import { plural, rating } from "@/lib/format";
import { ScreeningList } from "./screening-list";

/**
 * Trust-first summary used in search results and quote comparison.
 * Order: safe → relevant proof → outcomes. Price is rendered by the caller,
 * at equal or lower weight, never first.
 */
export function EvidenceSummary({
  p,
  repair,
  make,
  model,
}: {
  p: PublicMechanicProfile;
  repair?: RepairCategory;
  make?: VehicleMake;
  model?: string;
}) {
  const w = p.verifiedWork;
  const cat = repair ? w.filter((x) => x.category === repair).length : 0;
  const mk = make ? w.filter((x) => x.make === make).length : 0;
  const mdl = model ? w.filter((x) => (!make || x.make === make) && x.model.toLowerCase().includes(model.toLowerCase())).length : 0;
  const cross = repair && make ? w.filter((x) => x.category === repair && x.make === make).length : 0;
  const r = p.reputation;
  const verifiedCreds = p.credentials.filter((c) => c.provenance !== "self" && (c.status === "verified" || c.status === "reverification_required"));
  const selfCount = p.selfReported.repairs.length + p.selfReported.claims.length;

  return (
    <div className="space-y-3">
      <ScreeningList p={p} compact />

      <ul className="space-y-1">
        {repair ? (
          <li className="flex items-baseline gap-2">
            <span className={`num w-10 shrink-0 text-right text-[1.5rem] ${cat ? "text-ink" : "text-ink-3"}`}>{cat}</span>
            <span className="text-[0.9375rem] text-ink">
              verified {repairNoun(repair, cat)}
              {make && cat ? (
                <>
                  {", "}
                  <span className={cross ? "highlight px-0.5 font-semibold" : "text-ink-3"}>
                    {cross} on {make}
                  </span>
                </>
              ) : null}
            </span>
          </li>
        ) : null}
        {make ? (
          <li className="flex items-baseline gap-2">
            <span className={`num w-10 shrink-0 text-right text-[1.5rem] ${mk ? "text-ink" : "text-ink-3"}`}>{mk}</span>
            <span className="text-[0.9375rem] text-ink">verified {make} repairs</span>
          </li>
        ) : null}
        {model ? (
          <li className="flex items-baseline gap-2">
            <span className={`num w-10 shrink-0 text-right text-[1.5rem] ${mdl ? "text-ink" : "text-ink-3"}`}>{mdl}</span>
            <span className="text-[0.9375rem] text-ink">verified repairs on a {model}</span>
          </li>
        ) : null}
        <li className="flex items-baseline gap-2">
          <span className="num w-10 shrink-0 text-right text-[1.5rem] text-ink">{r.verifiedRepairs}</span>
          <span className="text-[0.9375rem] text-ink-2">verified repairs in total</span>
        </li>
      </ul>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.875rem] text-ink-2">
        {r.rating ? (
          <span className="inline-flex items-center gap-1">
            <StarRating value={r.rating.average} size={13} />
            <span className="tnum font-semibold text-ink">{rating(r.rating.average)}</span> from {plural(r.rating.count, "verified review")}
          </span>
        ) : (
          <span className="text-ink-3">No verified reviews yet</span>
        )}
        <span className="text-rule" aria-hidden>
          |
        </span>
        <span>{plural(r.repeatCustomers, "repeat customer")}</span>
        {verifiedCreds.length ? (
          <>
            <span className="text-rule" aria-hidden>
              |
            </span>
            <span>
              {verifiedCreds
                .slice(0, 2)
                .map((c) => `${c.issuer}${c.code ? ` ${c.code}` : ""}`)
                .join(", ")}{" "}
              verified
            </span>
          </>
        ) : null}
      </p>
      {selfCount > 0 && r.verifiedRepairs < 10 ? (
        <p className="text-[0.8125rem] text-pencil">Some experience on this profile is self-reported and not yet verified.</p>
      ) : null}
    </div>
  );
}
