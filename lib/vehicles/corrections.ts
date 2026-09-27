import type { SpecCorrection, SpecField, VehicleSpec } from "./types";

const FIELDS = ["engine", "transmission", "drivetrain", "trim", "body", "platform", "fuel"] as const;

/**
 * Carry a spec's history into its replacement: every field whose value or source changed is
 * appended as a correction (what it was, what it became, who, when). Earlier corrections are kept.
 */
export function withCorrections(prev: VehicleSpec | undefined, next: VehicleSpec, by: SpecCorrection["by"], at = new Date().toISOString()): VehicleSpec {
  const out: VehicleSpec = { ...next, corrections: [...(prev?.corrections ?? []), ...(next.corrections ?? []).filter((c) => !(prev?.corrections ?? []).some((p) => p.at === c.at && p.field === c.field))] };
  if (!prev) return out;
  for (const k of FIELDS) {
    const a = prev[k] as SpecField | undefined;
    const b = next[k] as SpecField | undefined;
    if (!a || !b) continue;
    if (a.label !== b.label || a.status !== b.status) out.corrections!.push({ at, by, field: k, from: { label: a.label, status: a.status }, to: { label: b.label, status: b.status } });
  }
  if ((prev.vin.last6 ?? "") !== (next.vin.last6 ?? "") && next.vin.last6)
    out.corrections!.push({ at, by, field: "vin", from: { label: prev.vin.last6 ? `…${prev.vin.last6}` : "No VIN", status: prev.vin.status === "decoded" ? "vin_confirmed" : "not_recorded" }, to: { label: `…${next.vin.last6}`, status: next.vin.status === "decoded" ? "vin_confirmed" : "needs_confirmation" } });
  if (!out.corrections!.length) delete out.corrections;
  return out;
}
