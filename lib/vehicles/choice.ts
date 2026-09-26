import type { Selection } from "./spec";
import type { BodyStyle, Drivetrain } from "./types";

/** The picker's raw state: ids chosen at each step, plus the VIN. */
export interface VehicleChoice {
  year: string;
  make: string;
  model: string;
  body: string;
  trim: string;
  engine: string;
  transmission: string;
  drivetrain: string;
  engineText: string;
  vin: string;
  /** The customer confirmed the decoded VIN is their car. */
  vinConfirmed: boolean;
}

export const EMPTY_CHOICE: VehicleChoice = { year: "", make: "", model: "", body: "", trim: "", engine: "", transmission: "", drivetrain: "", engineText: "", vin: "", vinConfirmed: false };

export function choiceToSelection(c: VehicleChoice): Selection {
  return {
    year: Number(c.year) || undefined,
    make: c.make || undefined,
    model: c.model || undefined,
    body: (c.body || undefined) as BodyStyle | undefined,
    trim: c.trim || undefined,
    engine: c.engine || undefined,
    transmission: c.transmission || undefined,
    drivetrain: (c.drivetrain || undefined) as Drivetrain | undefined,
    engineText: c.engineText || undefined,
  };
}

