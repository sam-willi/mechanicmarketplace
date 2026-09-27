import "server-only";
import { choiceToSelection, type VehicleChoice } from "./choice";
import { vehicleData } from "./provider";
import { buildSpec, pruneSelection } from "./spec";
import type { VehicleSpec } from "./types";

/** Rebuild a spec on the server from the customer's choices (never trust a client-built spec). */
export async function resolveSpec(choice?: VehicleChoice): Promise<VehicleSpec | undefined> {
  if (!choice) return undefined;
  const sel = choiceToSelection(choice);
  if (!sel.year || !sel.make || !sel.model) return undefined;
  const configs = await vehicleData.configurations(sel.year, sel.make, sel.model);
  // Any VIN given is decoded: one that matches confirms the selections; one that disagrees is kept
  // as a recorded conflict (buildSpec never upgrades or overwrites on a mismatch).
  const decoded = /^[A-HJ-NPR-Z0-9]{17}$/.test(choice.vin.trim().toUpperCase()) ? await vehicleData.decodeVin(choice.vin) : undefined;
  return buildSpec(configs.length ? pruneSelection(configs, sel) : sel, configs, decoded?.ok ? decoded : undefined);
}
