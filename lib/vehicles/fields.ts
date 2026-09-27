import "server-only";
import type { VehicleMake } from "@/lib/domain/types";
import { EMPTY_CHOICE, type VehicleChoice } from "./choice";
import { resolveSpec } from "./resolve";

/** The selector's choice, parsed defensively (anything unexpected becomes empty). */
export function parseChoice(raw: unknown): VehicleChoice {
  let obj: Partial<Record<keyof VehicleChoice, unknown>> = {};
  try {
    obj = (typeof raw === "string" ? JSON.parse(raw) : raw ?? {}) as typeof obj;
  } catch {
    obj = {};
  }
  return Object.fromEntries(Object.entries(EMPTY_CHOICE).map(([k, d]) => [k, typeof obj[k as keyof VehicleChoice] === typeof d ? obj[k as keyof VehicleChoice] : d])) as unknown as VehicleChoice;
}

/**
 * Vehicle fields from a choice. The structured spec is rebuilt on the server from the catalog and
 * (if the customer confirmed it) the decoded VIN; nothing the browser built is trusted.
 */
export async function vehicleFromChoice(c: VehicleChoice, mileageRaw?: unknown) {
  const vin = c.vin.trim().toUpperCase();
  const spec = await resolveSpec({ ...c, model: c.model.slice(0, 80) });
  const firm = (st?: string) => st && st !== "needs_confirmation" && st !== "likely";
  const t = firm(spec?.transmission?.status) ? spec?.transmission?.type : undefined;
  return {
    year: Number(c.year) || 2015,
    make: c.make as VehicleMake,
    model: c.model.replace(/^custom:/, "").trim().slice(0, 80),
    trim: firm(spec?.trim?.status) ? spec?.trim?.label : undefined,
    engine: firm(spec?.engine?.status) ? spec?.engine?.label : c.engineText.trim() || undefined,
    transmission: t === "manual" ? ("manual" as const) : t === "automatic" ? ("automatic" as const) : t === "cvt" || t === "ecvt" ? ("cvt" as const) : t === "dct" ? ("dual_clutch" as const) : undefined,
    mileage: Number(String(mileageRaw ?? "").replace(/[^0-9]/g, "")) || undefined,
    vin: /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : undefined,
    spec,
  };
}
