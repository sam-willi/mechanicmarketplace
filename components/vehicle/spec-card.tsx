import { AlertTriangle, ChevronDown, CircleHelp, ScanLine } from "lucide-react";
import type { RepairCategory, Vehicle } from "@/lib/domain/types";
import { transmissionLabel } from "@/lib/domain/intake";
import { customerSummary, mechanicHeadline, orderedFields, SPEC_LABEL, STATUS_LABEL } from "@/lib/vehicles/spec";
import type { SpecStatus, VehicleSpec } from "@/lib/vehicles/types";
import { levelOfSpec } from "@/lib/domain/fact-level";
import { FactTag } from "@/components/trust/fact-tag";

/** Where a spec came from, on the shared five-level scale (lib/domain/fact-level.ts). */
export function StatusTag({ status }: { status: SpecStatus }) {
  return <FactTag level={levelOfSpec(status)} label={STATUS_LABEL[status]} />;
}

function vinLine(v: Vehicle, spec: VehicleSpec | undefined, revealVin: boolean) {
  const shown = v.vin ? (revealVin ? v.vin : `ending ${v.vin.slice(-6)}`) : null;
  if (spec?.vin.status === "decoded" || spec?.vin.status === "partial") return `VIN decoded${shown ? ` (${shown})` : ""}`;
  if (v.vin) return `VIN provided, not decoded (${shown})`;
  return "No VIN yet";
}

/**
 * The car, for whoever is looking. Mechanics get the technical headline and the
 * attributes that matter for this repair first; customers get the short version.
 * Every attribute says where it came from. Nothing unconfirmed is stated as fact.
 */
export function VehicleSpecCard({
  v,
  spec,
  category,
  audience,
  revealVin = false,
  compact = false,
}: {
  v: Vehicle;
  spec?: VehicleSpec;
  category: RepairCategory;
  audience: "mechanic" | "customer";
  revealVin?: boolean;
  compact?: boolean;
}) {
  const fields = spec ? orderedFields(spec, category) : [];
  const headline = audience === "mechanic" ? mechanicHeadline(v, spec) : customerSummary(v, spec);
  const conflicts = spec?.vin.conflicts ?? [];
  const open = spec?.open ?? [];

  if (compact) {
    // The headline already carries engine, transmission and drivetrain; chips add the rest.
    const inHeadline = new Set(["engine", "transmission", "drivetrain"]);
    const top = fields.filter((f) => f.f!.status !== "needs_confirmation" && !inHeadline.has(f.key)).slice(0, 2);
    const unresolved = fields.filter((f) => f.f!.status === "needs_confirmation").length;
    return (
      <div className="text-[0.8125rem]">
        {headline.includes(" — ") ? <p className="font-semibold text-ink">{headline.split(" — ").slice(1).join(" — ")}</p> : null}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-2">
          {top.map(({ key, f }) => (
            <span key={key} className="inline-flex items-center gap-1">
              {f!.label} <StatusTag status={f!.status} />
            </span>
          ))}
          {!spec ? <span className="text-ink-3">Configuration not recorded</span> : null}
          {unresolved ? <span className="font-semibold text-amber">{unresolved} to confirm</span> : null}
          {conflicts.length ? <span className="font-semibold text-alert">VIN conflict</span> : null}
        </p>
      </div>
    );
  }

  return (
    <section aria-label="Vehicle" className="space-y-3">
      <div>
        <p className="heading text-[1.0625rem] leading-snug sm:text-[1.25rem]">{headline}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.875rem] text-ink-2">
          {v.mileage ? <span className="tnum">{v.mileage.toLocaleString()} mi</span> : <span>Mileage not given</span>}
          <span aria-hidden className="text-rule">
            ·
          </span>
          <span className="inline-flex items-center gap-1">
            <ScanLine size={13} aria-hidden /> {vinLine(v, spec, revealVin)}
          </span>
          {spec ? (
            <>
              <span aria-hidden className="text-rule">
                ·
              </span>
              <span>{spec.market} market</span>
            </>
          ) : null}
        </p>
      </div>

      {conflicts.length ? (
        <div role="alert" className="flex gap-2 border border-alert bg-alert-wash px-3 py-2 text-[0.875rem]">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-alert" aria-hidden />
          <div>
            <p className="font-bold text-alert">The VIN and the customer&apos;s selections disagree</p>
            {conflicts.map((c) => (
              <p key={c}>{c}</p>
            ))}
            <p className="text-ink-2">Confirm the car before ordering parts.</p>
          </div>
        </div>
      ) : null}

      {spec ? (
        <dl className="grid gap-x-6 border-t border-rule-soft sm:grid-cols-2">
          {fields.slice(0, audience === "mechanic" ? 4 : 3).map(({ key, f }) => (
            <div key={key} className="border-b border-rule-soft py-2">
              <dt className="field-label">{SPEC_LABEL[key]}</dt>
              <dd className="mt-0.5 text-[0.9375rem]">
                {f!.status === "needs_confirmation" ? <span className="text-ink-2">{f!.options?.join(" or ") ?? "Unknown"}</span> : f!.label} <StatusTag status={f!.status} />
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="border border-dashed border-rule px-3 py-2 text-[0.875rem] text-ink-2">
          Configuration not recorded.{" "}
          {v.engine || v.transmission ? (
            <>
              Customer&apos;s description: {[v.engine, transmissionLabel(v.transmission)].filter(Boolean).join(", ")} <StatusTag status="customer_text" />
            </>
          ) : (
            "Ask the customer to confirm the engine and transmission."
          )}
        </p>
      )}

      {audience === "mechanic" && open.length ? (
        <ul className="space-y-1 text-[0.875rem]">
          {open.map((q) => (
            <li key={q} className="flex gap-1.5 text-ink">
              <CircleHelp size={15} className="mt-0.5 shrink-0 text-amber" aria-hidden /> {q}
            </li>
          ))}
        </ul>
      ) : null}

      {spec && (fields.length > 4 || spec.vin.decoded) ? (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-[0.875rem] font-semibold [&::-webkit-details-marker]:hidden">
            <ChevronDown size={16} className="transition-transform group-open:rotate-180" aria-hidden /> Full vehicle specifications
          </summary>
          <dl className="grid gap-x-6 text-[0.875rem] sm:grid-cols-2">
            {fields.map(({ key, f }) => (
              <div key={key} className="flex justify-between gap-3 border-b border-rule-soft py-1.5">
                <dt className="text-ink-2">{SPEC_LABEL[key]}</dt>
                <dd className="text-right">
                  {f!.status === "needs_confirmation" ? "Not confirmed" : f!.label} <StatusTag status={f!.status} />
                </dd>
              </div>
            ))}
            {spec.engine?.displacementL ? (
              <div className="flex justify-between gap-3 border-b border-rule-soft py-1.5">
                <dt className="text-ink-2">Displacement / cylinders</dt>
                <dd>
                  {spec.engine.displacementL.toFixed(1)}L{spec.engine.cylinders ? ` · ${spec.engine.cylinders} cyl` : ""}
                  {spec.engine.aspiration ? ` · ${spec.engine.aspiration}` : ""}
                </dd>
              </div>
            ) : null}
            {Object.entries(spec.vin.decoded ?? {})
              .filter(([k]) => ["BodyClass", "Doors", "EngineConfiguration", "EngineModel", "DriveType", "TransmissionStyle", "PlantCountry", "Series", "Trim"].includes(k))
              .map(([k, val]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-rule-soft py-1.5">
                  <dt className="text-ink-2">{k.replace(/([a-z])([A-Z])/g, "$1 $2")} (from VIN)</dt>
                  <dd className="text-right">{val}</dd>
                </div>
              ))}
          </dl>
        </details>
      ) : null}
    </section>
  );
}
