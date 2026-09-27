import { ENGINES, TRANSMISSIONS } from "./catalog";
import { withCorrections } from "./corrections";
import type { Drivetrain, RecordedSpec, SpecStatus, VehicleSpec } from "./types";

const FIRM: SpecStatus[] = ["vin_confirmed", "selected", "mechanic_confirmed"];

/**
 * What a completed repair records about the car. Engine and transmission are
 * kept only when confirmed (VIN, customer selection, or the mechanic); a
 * "likely" configuration keeps the platform but not the engine claim.
 */
export function toRecorded(spec?: VehicleSpec): RecordedSpec | undefined {
  if (!spec) return undefined;
  const firm = (s?: SpecStatus) => Boolean(s && FIRM.includes(s));
  const rec: RecordedSpec = {
    platform: spec.platform?.id,
    engineCode: firm(spec.engine?.status) ? spec.engine?.code : undefined,
    transmissionType: firm(spec.transmission?.status) ? spec.transmission?.type : undefined,
    drivetrain: firm(spec.drivetrain?.status) ? (spec.drivetrain?.id as Drivetrain | undefined) : undefined,
    source: spec.engine?.status === "mechanic_confirmed" ? "mechanic_confirmed" : spec.vin.status === "decoded" ? "vin_confirmed" : "selected",
  };
  return rec.platform || rec.engineCode || rec.transmissionType ? rec : undefined;
}

/** Apply a mechanic's confirmation of open items to a spec. */
export function confirmSpec(spec: VehicleSpec, confirm: { engine?: string; transmission?: string; drivetrain?: string }): VehicleSpec {
  const next: VehicleSpec = structuredClone(spec);
  if (confirm.engine && ENGINES[confirm.engine]) {
    const e = ENGINES[confirm.engine];
    next.engine = { id: e.code, label: e.label, status: "mechanic_confirmed", code: e.code, displacementL: e.displacementL, cylinders: e.cylinders, layout: e.layout, aspiration: e.aspiration, fuel: e.fuel };
  }
  if (confirm.transmission && TRANSMISSIONS[confirm.transmission]) {
    const t = TRANSMISSIONS[confirm.transmission];
    next.transmission = { id: t.id, label: t.label, status: "mechanic_confirmed", type: t.type, speeds: t.speeds };
  }
  if (confirm.drivetrain && ["FWD", "RWD", "AWD", "4WD"].includes(confirm.drivetrain)) {
    const label = { FWD: "Front-wheel drive", RWD: "Rear-wheel drive", AWD: "All-wheel drive", "4WD": "Four-wheel drive" }[confirm.drivetrain as Drivetrain];
    next.drivetrain = { id: confirm.drivetrain, label, status: "mechanic_confirmed" };
  }
  next.open = next.open.filter((q) => !(confirm.engine && q.startsWith("Which engine")) && !(confirm.transmission && q.startsWith("Which transmission")) && !(confirm.drivetrain && q.startsWith("Which drivetrain")));
  // The mechanic's confirmation is added to the history; what it replaced stays visible.
  return withCorrections(spec, next, "mechanic");
}
