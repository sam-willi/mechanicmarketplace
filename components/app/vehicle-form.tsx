"use client";

import { useState } from "react";
import type { Vehicle } from "@/lib/domain/types";
import { EMPTY_CHOICE, VehicleSelector, type VehicleChoice } from "@/components/vehicle/vehicle-selector";

/** The choice a saved vehicle already has, so editing starts where it left off. */
function initialChoice(v?: Vehicle): VehicleChoice {
  if (!v) return EMPTY_CHOICE;
  const s = v.spec;
  const firm = (st?: string) => st === "selected" || st === "vin_confirmed" || st === "mechanic_confirmed";
  return {
    ...EMPTY_CHOICE,
    year: String(v.year),
    make: v.make,
    model: v.model,
    body: firm(s?.body?.status) ? (s?.body?.id ?? "") : "",
    trim: firm(s?.trim?.status) ? (s?.trim?.id ?? "") : "",
    engine: firm(s?.engine?.status) ? (s?.engine?.code ?? "") : "",
    transmission: firm(s?.transmission?.status) ? (s?.transmission?.id ?? "") : "",
    drivetrain: firm(s?.drivetrain?.status) ? (s?.drivetrain?.id ?? "") : "",
    engineText: s?.engine?.status === "customer_text" ? s.engine.label : "",
    vin: v.vin ?? "",
    vinConfirmed: s?.vin.status === "decoded",
  };
}

/** Add/edit a vehicle with the same year → make → model → configuration picker as a repair request. */
export function VehicleFields({ v, showVin = true }: { v?: Vehicle; showVin?: boolean }) {
  const [choice, setChoice] = useState<VehicleChoice>(initialChoice(v));
  return (
    <div className="space-y-4">
      <input type="hidden" name="choice" value={JSON.stringify(choice)} />
      <VehicleSelector value={choice} onChange={(c) => setChoice(c)} showVin={showVin} />
      <label className="block max-w-[16rem]">
        <span className="field-label">Mileage</span>
        <input name="mileage" inputMode="numeric" defaultValue={v?.mileage?.toLocaleString()} className="input tnum mt-1" />
      </label>
    </div>
  );
}
