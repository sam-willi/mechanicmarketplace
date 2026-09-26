import type { PublicRepair } from "./public-profile";
import { repairNoun } from "./provenance";
import type { RepairCategory } from "./types";
import { baseModel, platformFor } from "@/lib/vehicles/catalog";
import type { VehicleSpec } from "@/lib/vehicles/types";

export type EvidenceLevel = "exact_config" | "engine" | "platform" | "transmission" | "model" | "make";

export interface VehicleEvidence {
  level: EvidenceLevel;
  n: number;
  /** "3 verified repairs on BMW E82/E88 (1 Series)". */
  text: string;
}

export interface TargetVehicle {
  year: number;
  make: string;
  model: string;
  spec?: VehicleSpec;
}

const known = (s?: { status: string }) => Boolean(s && s.status !== "needs_confirmation" && s.status !== "not_recorded");

/**
 * Verified experience with this particular car, from most to least specific.
 * Engine and transmission experience only count repairs that recorded them;
 * platform comes from the record or factory data that allows only one answer.
 */
export function vehicleEvidence(work: PublicRepair[], car: TargetVehicle, category?: RepairCategory): VehicleEvidence[] {
  const make = car.make.toLowerCase();
  const sameMake = work.filter((w) => w.make.toLowerCase() === make);
  const model = baseModel(car.model).toLowerCase();
  const platform = known(car.spec?.platform) ? car.spec!.platform!.id : platformFor(car.year, car.make, car.model)?.code;
  const engine = known(car.spec?.engine) ? car.spec!.engine!.code : undefined;
  const trans = known(car.spec?.transmission) ? car.spec!.transmission!.type : undefined;
  const out: VehicleEvidence[] = [];
  const catWord = (n: number) => (category ? repairNoun(category, n) : n === 1 ? "repair" : "repairs");

  if (platform && engine && category) {
    const n = sameMake.filter((w) => w.platform === platform && w.engineCode === engine && w.category === category).length;
    if (n) out.push({ level: "exact_config", n, text: `${n} verified ${engine} ${catWord(n)} on the ${platform}` });
  }
  if (engine) {
    const n = sameMake.filter((w) => w.engineCode === engine).length;
    if (n) out.push({ level: "engine", n, text: `${n} verified ${n === 1 ? "repair" : "repairs"} on ${engine} engines` });
  }
  if (platform) {
    const n = sameMake.filter((w) => w.platform === platform).length;
    if (n) out.push({ level: "platform", n, text: `${n} verified ${n === 1 ? "repair" : "repairs"} on ${car.make} ${platform} cars` });
  }
  if (trans === "manual" || trans === "dct") {
    const n = sameMake.filter((w) => w.transmissionType === trans).length;
    if (n) out.push({ level: "transmission", n, text: `${n} verified ${n === 1 ? "repair" : "repairs"} on ${trans === "manual" ? "manual-transmission" : "dual-clutch"} ${car.make}s` });
  }
  const nModel = sameMake.filter((w) => baseModel(w.model).toLowerCase() === model).length;
  if (nModel) out.push({ level: "model", n: nModel, text: `${nModel} verified ${nModel === 1 ? "repair" : "repairs"} on a ${car.make} ${baseModel(car.model)}` });
  return out;
}
