import Link from "next/link";
import type { Vehicle } from "@/lib/domain/types";
import type { SpecField, VehicleSpec } from "@/lib/vehicles/types";
import { STATUS_LABEL } from "@/lib/vehicles/spec";
import { HOW_TO_CONFIRM, unconfirmedEssentials } from "@/lib/vehicles/effective";
import { levelOfSpec } from "@/lib/domain/fact-level";
import { FactTag } from "@/components/trust/fact-tag";
import { Notice } from "@/components/workspace/ui";

type Row = { key: keyof typeof HOW_TO_CONFIRM; name: string; f?: SpecField };

/**
 * The car in one ruled box, at the top of every screen where someone quotes, books or works on it:
 * year, make, model, trim and platform, engine, transmission, drive and fuel, each with where it came
 * from (VIN-decoded, customer selected or entered, likely, unknown), plus mileage and the VIN's
 * state. A likely or unknown field says how to confirm it; before quoting or booking, a gap in the
 * engine, transmission or drive is a warning, never a block.
 */
export function VehicleBrief({
  v,
  spec,
  audience,
  warn,
  editHref,
  showVinTail = false,
}: {
  v: Pick<Vehicle, "year" | "make" | "model" | "mileage">;
  spec: VehicleSpec;
  audience: "customer" | "mechanic";
  /** "quote" (mechanic about to price it) or "book" (customer about to book): show the gap warning. */
  warn?: "quote" | "book";
  editHref?: string;
  showVinTail?: boolean;
}) {
  const rows: Row[] = [
    { key: "trim", name: "Trim / series", f: spec.trim },
    { key: "engine", name: "Engine", f: spec.engine },
    { key: "transmission", name: "Transmission", f: spec.transmission },
    { key: "drivetrain", name: "Drive", f: spec.drivetrain },
  ];
  const fuel = spec.fuel?.label ?? (spec.engine && "fuel" in spec.engine ? (spec.engine as { fuel?: string }).fuel : undefined);
  const sub = [spec.platform?.status !== "needs_confirmation" ? spec.platform?.label : undefined, spec.body?.status !== "needs_confirmation" ? spec.body?.label : undefined, fuel ? String(fuel).replace(/^./, (c) => c.toUpperCase()) : undefined]
    .filter(Boolean)
    .join(" · ");
  const vinState = spec.vin.status === "decoded" || spec.vin.status === "partial" ? "decoded" : spec.vin.status === "failed" ? "failed" : "none";
  const { gaps, conflicts } = unconfirmedEssentials(spec);
  const names = gaps.map((g) => g.label);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
  const unsure = (f?: SpecField) => !f || f.status === "likely" || f.status === "needs_confirmation" || f.status === "not_recorded";
  return (
    <section aria-label="Vehicle" className="sheet">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule-soft px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <p className="text-[1.0625rem] font-bold">
            {v.year} {v.make} {v.model}
          </p>
          {sub ? <p className="text-[0.875rem] text-ink-2">{sub}</p> : null}
        </div>
        <p className="tnum text-[0.875rem] text-ink-2">
          {v.mileage ? `${v.mileage.toLocaleString()} mi · ` : ""}
          {vinState === "decoded" ? <span className="font-semibold text-carbon">VIN-decoded{showVinTail && spec.vin.last6 ? ` (…${spec.vin.last6})` : ""}</span> : vinState === "failed" ? "VIN couldn't be decoded" : "No VIN yet"}
        </p>
      </div>
      <dl className="divide-y divide-rule-soft">
        {rows.map(({ key, name, f }) => (
          <div key={key} className="grid gap-x-3 gap-y-0.5 px-4 py-2 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:px-5">
            <dt className="field-label pt-1">{name}</dt>
            <dd className="min-w-0">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className={unsure(f) ? "text-ink-2" : "font-semibold"}>{!f || f.status === "not_recorded" ? "Unknown" : f.status === "needs_confirmation" ? `Not confirmed${f.options?.length ? `: ${f.options.join(" or ")}` : ""}` : f.status === "likely" ? `Likely ${f.label}` : f.label}</span>
                <FactTag level={levelOfSpec(f?.status ?? "not_recorded")} label={STATUS_LABEL[f?.status ?? "not_recorded"]} />
              </span>
              {unsure(f) && HOW_TO_CONFIRM[key] ? <span className="block text-[0.8125rem] text-ink-3">To confirm: {HOW_TO_CONFIRM[key]}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      {conflicts.length ? (
        <div className="border-t border-rule-soft px-4 py-3 sm:px-5">
          <Notice tone="warn">
            <span className="font-semibold">The VIN and the selections disagree.</span> {conflicts.join(" ")} Nothing was overwritten; confirm which is right.
          </Notice>
        </div>
      ) : null}
      {warn && gaps.length ? (
        <div className="border-t border-rule-soft px-4 py-3 sm:px-5">
          <Notice tone="warn">
            {warn === "quote" ? (
              <>
                <span className="font-semibold">Confirm the {list} before pricing parts.</span> {gaps.find((g) => g.likely) ? `Likely ${gaps.find((g) => g.likely)!.likely}, not confirmed. ` : ""}Ask for the VIN, or quote labor and confirm parts on site.
              </>
            ) : (
              <>
                <span className="font-semibold">Your car&apos;s {list} {gaps.length === 1 ? "isn't" : "aren't"} confirmed</span>, so parts in this estimate may change once the mechanic sees the car.{" "}
                {editHref ? (
                  <Link href={editHref} className="font-semibold underline decoration-rule underline-offset-2">
                    Add your VIN to confirm
                  </Link>
                ) : (
                  "Adding your VIN confirms it."
                )}
              </>
            )}
          </Notice>
        </div>
      ) : null}
      {spec.legacy ? <p className="border-t border-rule-soft px-4 py-2 text-[0.8125rem] text-ink-3 sm:px-5">Saved before Clutch recorded these details: anything not entered is inferred or unknown.</p> : null}
      {spec.corrections?.length ? (
        <details className="border-t border-rule-soft px-4 py-2 sm:px-5">
          <summary className="min-h-11 cursor-pointer content-center text-[0.8125rem] font-semibold">Corrections ({spec.corrections.length})</summary>
          <ul className="space-y-0.5 pb-2 text-[0.8125rem] text-ink-2">
            {spec.corrections.map((c, i) => (
              <li key={i}>
                {c.at.slice(0, 10)} · {audience === "mechanic" && c.by === "customer" ? "Customer" : c.by === "mechanic" ? "Mechanic" : "You"}: {c.field} {c.from.label} ({STATUS_LABEL[c.from.status].toLowerCase()}) → {c.to.label} ({STATUS_LABEL[c.to.status].toLowerCase()})
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
