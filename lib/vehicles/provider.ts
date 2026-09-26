import "server-only";
import { VEHICLE_MAKES } from "@/lib/domain/types";
import { catalogModels, configsFor, type CatalogConfig } from "./catalog";
import type { VinDecode } from "./spec";
import type { BodyStyle, Drivetrain, TransmissionType } from "./types";

/**
 * Where vehicle data comes from. Swap the implementation (e.g. a licensed
 * YMMT + VIN provider) without touching callers.
 */
export interface VehicleDataProvider {
  years(): number[];
  makes(year: number): Promise<string[]>;
  /** Models that existed for this make and year. `source` says whether it's live data or the offline fallback. */
  models(year: number, make: string): Promise<{ models: string[]; source: "nhtsa" | "catalog" }>;
  configurations(year: number, make: string, model: string): Promise<CatalogConfig[]>;
  decodeVin(vin: string): Promise<VinDecode>;
}

const DAY = 86_400_000;
type Entry<T> = { at: number; value: T };
const g = globalThis as unknown as { __clutchVehicleCache?: Map<string, Entry<unknown>> };
const cache = (g.__clutchVehicleCache ??= new Map());

async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as Entry<T> | undefined;
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function getJSON(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), next: { revalidate: 86400 } });
  if (!res.ok) throw new Error(`vPIC ${res.status}`);
  return res.json();
}

const VPIC = "https://vpic.nhtsa.dot.gov/api/vehicles";

/** NHTSA vPIC for model lists and VIN decoding; the curated catalog for factory configurations. */
export class NhtsaCatalogProvider implements VehicleDataProvider {
  years() {
    const now = new Date().getFullYear() + 1;
    return Array.from({ length: now - 1989 }, (_, i) => now - i);
  }

  async makes(year: number) {
    return VEHICLE_MAKES.filter((m) => m !== "Tesla" || year >= 2008).slice();
  }

  async models(year: number, make: string) {
    try {
      const models = await cached(`models:${year}:${make.toLowerCase()}`, 7 * DAY, async () => {
        const types = ["car", "mpv", "truck"];
        const lists = await Promise.all(
          types.map((t) =>
            getJSON(`${VPIC}/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${year}/vehicletype/${t}?format=json`)
              .then((j: { Results?: { Model_Name: string }[] }) => (j.Results ?? []).map((r) => r.Model_Name.trim()))
              .catch(() => [] as string[]),
          ),
        );
        const all = [...new Set([...lists.flat(), ...catalogModels(year, make)])].filter(Boolean);
        if (!lists.flat().length) throw new Error("no data");
        return all.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      });
      return { models, source: "nhtsa" as const };
    } catch {
      return { models: catalogModels(year, make), source: "catalog" as const };
    }
  }

  async configurations(year: number, make: string, model: string) {
    return configsFor(year, make, model);
  }

  async decodeVin(raw: string): Promise<VinDecode> {
    const vin = raw.trim().toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return { ok: false, vin, raw: {}, warnings: ["A VIN is 17 letters and numbers (no I, O or Q)."] };
    try {
      const j = await cached(`vin:${vin}`, 30 * DAY, () => getJSON(`${VPIC}/DecodeVinValues/${vin}?format=json`));
      const r = (j as { Results: Record<string, string>[] }).Results[0];
      const pick = (k: string) => (r[k] && r[k] !== "Not Applicable" ? r[k].trim() : undefined);
      const make = pick("Make");
      const makeNorm = VEHICLE_MAKES.find((m) => m.toLowerCase() === make?.toLowerCase()) ?? (make ? make.charAt(0) + make.slice(1).toLowerCase() : undefined);
      const year = Number(pick("ModelYear")) || undefined;
      const warnings: string[] = [];
      const err = pick("ErrorText");
      if (err && !err.startsWith("0")) warnings.push(err.replace(/^\d+ - /, ""));
      const rawOut: Record<string, string> = {};
      for (const k of ["ModelYear", "Make", "Model", "Trim", "Series", "BodyClass", "Doors", "DisplacementL", "EngineCylinders", "EngineConfiguration", "EngineModel", "Turbo", "FuelTypePrimary", "DriveType", "TransmissionStyle", "TransmissionSpeeds", "PlantCountry"]) {
        const v = pick(k);
        if (v) rawOut[k] = v;
      }
      return {
        ok: Boolean(year && make),
        vin,
        year,
        make: makeNorm,
        model: pick("Model"),
        trim: pick("Trim") ?? pick("Series"),
        body: bodyFrom(pick("BodyClass")),
        displacementL: Number(pick("DisplacementL")) || undefined,
        cylinders: Number(pick("EngineCylinders")) || undefined,
        fuel: pick("FuelTypePrimary"),
        drivetrain: driveFrom(pick("DriveType")),
        transmissionType: transFrom(pick("TransmissionStyle")),
        transmissionSpeeds: Number(pick("TransmissionSpeeds")) || undefined,
        engineModel: pick("EngineModel"),
        turbo: pick("Turbo") === "Yes" ? true : undefined,
        raw: rawOut,
        warnings,
      };
    } catch {
      return { ok: false, vin, raw: {}, warnings: ["The VIN decoder isn't reachable right now. You can still pick the car yourself."] };
    }
  }
}

function bodyFrom(s?: string): BodyStyle | undefined {
  if (!s) return undefined;
  const t = s.toLowerCase();
  if (t.includes("convertible") || t.includes("cabriolet")) return "convertible";
  if (t.includes("coupe")) return "coupe";
  if (t.includes("sedan")) return "sedan";
  if (t.includes("hatchback")) return "hatchback";
  if (t.includes("wagon")) return "wagon";
  if (t.includes("pickup")) return "truck";
  if (t.includes("minivan")) return "minivan";
  if (t.includes("sport utility") || t.includes("suv") || t.includes("crossover") || t.includes("mpv")) return "suv";
  return undefined;
}
function driveFrom(s?: string): Drivetrain | undefined {
  if (!s) return undefined;
  const t = s.toLowerCase();
  if (t.includes("4wd") || t.includes("4x4") || t.includes("4-wheel")) return "4WD";
  if (t.includes("awd") || t.includes("all-wheel") || t.includes("all wheel")) return "AWD";
  if (t.includes("rwd") || t.includes("rear")) return "RWD";
  if (t.includes("fwd") || t.includes("front")) return "FWD";
  return undefined;
}
function transFrom(s?: string): TransmissionType | undefined {
  if (!s) return undefined;
  const t = s.toLowerCase();
  if (t.includes("dual") || t.includes("dct")) return "dct";
  if (t.includes("cvt") || t.includes("continuously")) return "cvt";
  if (t.includes("manual") || t.includes("standard")) return "manual";
  if (t.includes("automatic")) return "automatic";
  return undefined;
}

export const vehicleData: VehicleDataProvider = new NhtsaCatalogProvider();
