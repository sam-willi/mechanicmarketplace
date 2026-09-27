import type { Vehicle } from "@/lib/domain/types";
import { legacySpec } from "./effective";

/**
 * Persist the honest, inferred spec for vehicles saved before structured details existed. Pure:
 * returns the updates. Vehicles that already have a spec are never touched, so a rerun changes
 * nothing. Each backfilled spec is marked `legacy` and says what is inferred or unknown.
 */
export function planVehicleBackfill(vehicles: Vehicle[]) {
  return vehicles
    .filter((v) => !v.spec)
    .map((v) => {
      const spec = legacySpec(v);
      return { id: v.id, after: { ...v, spec }, summary: `engine ${spec.engine?.label ?? "unknown"} (${spec.engine?.status ?? "not_recorded"}), transmission ${spec.transmission?.label ?? "unknown"} (${spec.transmission?.status ?? "not_recorded"})` };
    });
}
