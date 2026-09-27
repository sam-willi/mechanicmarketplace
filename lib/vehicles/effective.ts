import type { Vehicle } from "@/lib/domain/types";
import { configsFor, TRANSMISSIONS } from "./catalog";
import { buildSpec } from "./spec";
import type { SpecField, SpecStatus, VehicleSpec } from "./types";

/**
 * The spec to show for a vehicle: the request's snapshot, else the saved spec, else one inferred
 * at read time for a car saved before structured details existed. An inferred spec says so: what
 * the customer typed is "customer entered", what the factory data implies is "likely", and the
 * rest is unknown. Nothing is stored by reading it (scripts/backfill-vehicle-specs.ts persists it).
 */
export function vehicleSpecOf(v: Pick<Vehicle, "year" | "make" | "model" | "transmission" | "engine" | "trim" | "spec">, snapshot?: VehicleSpec): VehicleSpec {
  return snapshot ?? v.spec ?? legacySpec(v);
}

const ENTERED: SpecStatus = "customer_text";

export function legacySpec(v: Pick<Vehicle, "year" | "make" | "model" | "transmission" | "engine" | "trim">): VehicleSpec {
  const configs = configsFor(v.year, v.make, v.model);
  // The customer's old free choice of transmission type, matched to a factory option only when exactly one fits.
  const type = v.transmission === "dual_clutch" ? "dct" : v.transmission === "unsure" ? undefined : v.transmission;
  const transIds = type ? [...new Set(configs.flatMap((c) => c.transmissions))].filter((t) => TRANSMISSIONS[t].type === type) : [];
  const spec = buildSpec({ year: v.year, make: v.make, model: v.model, transmission: transIds.length === 1 ? transIds[0] : undefined, engineText: configs.length ? undefined : v.engine }, configs);
  // What buildSpec calls "selected" came from the old form: the customer entered it, not chose it from factory options.
  const relabel = (f?: SpecField) => {
    if (f && f.status === "selected") f.status = ENTERED;
  };
  relabel(spec.transmission);
  relabel(spec.body);
  relabel(spec.trim);
  relabel(spec.drivetrain);
  if (!spec.transmission && type) spec.transmission = { id: type, label: type === "dct" ? "Dual-clutch" : type.charAt(0).toUpperCase() + type.slice(1), status: ENTERED, type };
  if (!spec.engine) spec.engine = v.engine ? { label: v.engine, status: ENTERED } : { label: "Unknown", status: "not_recorded" };
  spec.legacy = true;
  spec.open = [
    "Saved before Clutch recorded structured vehicle details: the engine and trim are inferred or unknown. The VIN, or a look under the hood, confirms them.",
    ...spec.open,
  ];
  return spec;
}

/** Where to look to confirm a field nobody has confirmed. */
export const HOW_TO_CONFIRM: Record<string, string> = {
  engine: "Add the VIN (driver's door jamb or the base of the windshield), or check the label on the engine cover.",
  transmission: "Check for a clutch pedal, or the gear selector.",
  drivetrain: "The VIN confirms it; so does the badge on the trunk (xDrive, 4MATIC, AWD).",
  trim: "The badge on the trunk, or the VIN.",
  body: "Count the doors: coupe, sedan, wagon or convertible.",
  platform: "The VIN confirms it.",
};

/** Safety-relevant configuration nobody has confirmed: warn before quoting or booking, never block. */
export function unconfirmedEssentials(s: VehicleSpec) {
  const weak = (f?: SpecField) => !f || f.status === "needs_confirmation" || f.status === "not_recorded" || f.status === "likely";
  const out: { key: "engine" | "transmission" | "drivetrain"; label: string; likely?: string }[] = [];
  if (weak(s.engine)) out.push({ key: "engine", label: "engine", likely: s.engine?.status === "likely" ? s.engine.label : undefined });
  if (weak(s.transmission)) out.push({ key: "transmission", label: "transmission", likely: s.transmission?.status === "likely" ? s.transmission.label : undefined });
  if (s.drivetrain && weak(s.drivetrain)) out.push({ key: "drivetrain", label: "drivetrain", likely: s.drivetrain.status === "likely" ? s.drivetrain.label : undefined });
  return { gaps: out, conflicts: s.vin.conflicts };
}
