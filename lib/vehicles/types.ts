/**
 * Structured vehicle identity. Every attribute records where it came from, so
 * nothing uncertain is ever shown as fact:
 *  - vin_confirmed: decoded from the VIN (or implied by it with only one factory option)
 *  - selected: picked by the customer from options that existed for that vehicle
 *  - likely: implied by the customer's selections (only one factory option in our data),
 *    but not confirmed by a VIN
 *  - needs_confirmation: more than one possibility; nobody has confirmed which
 *  - customer_text: typed by the customer, not matched to factory data
 *  - mechanic_confirmed: confirmed by the mechanic who worked on the car
 *  - not_recorded: older records that never captured this
 */
export type SpecStatus = "vin_confirmed" | "selected" | "likely" | "needs_confirmation" | "customer_text" | "mechanic_confirmed" | "not_recorded";

export type TransmissionType = "manual" | "automatic" | "dct" | "cvt" | "ecvt";
export type Drivetrain = "FWD" | "RWD" | "AWD" | "4WD";
export type BodyStyle = "sedan" | "coupe" | "convertible" | "hatchback" | "wagon" | "suv" | "truck" | "minivan";

export interface SpecField {
  /** Normalized id, e.g. "N54", "6MT", "RWD", "E82". */
  id?: string;
  /** Human label, e.g. "N54 3.0L twin-turbo inline-six". */
  label: string;
  status: SpecStatus;
  /** When several were possible, the candidates (labels). */
  options?: string[];
}

export interface EngineSpec extends SpecField {
  code?: string;
  displacementL?: number;
  cylinders?: number;
  layout?: "inline" | "V" | "flat";
  aspiration?: "naturally aspirated" | "turbocharged" | "twin-turbo" | "hybrid";
  fuel?: "gasoline" | "hybrid" | "diesel" | "electric";
}

export interface TransmissionSpec extends SpecField {
  type?: TransmissionType;
  speeds?: number;
}

export interface VinInfo {
  status: "none" | "decoded" | "partial" | "failed";
  decodedAt?: string;
  /** Last 6 characters only; the full VIN is kept on the vehicle record and shown only to the owner and the booked mechanic. */
  last6?: string;
  /** Differences between the VIN and what the customer selected. */
  conflicts: string[];
  /** Raw decoded attributes (labels), for the full spec sheet. */
  decoded?: Record<string, string>;
}

export interface VehicleSpec {
  version: 1;
  market: "US";
  /** Catalog configuration id when the combination resolves to exactly one. */
  configId?: string;
  platform?: SpecField;
  body?: SpecField;
  trim?: SpecField;
  engine?: EngineSpec;
  transmission?: TransmissionSpec;
  drivetrain?: SpecField;
  fuel?: SpecField;
  vin: VinInfo;
  /** Plain-language open questions a mechanic may want to confirm. */
  open: string[];
  /** Inferred for a car saved before structured details existed (lib/vehicles/effective.ts). */
  legacy?: boolean;
  /** Changes made after the fact (a customer edit, a mechanic confirming): what it was, what it became, who. Never rewritten. */
  corrections?: SpecCorrection[];
}

export interface SpecCorrection {
  at: string;
  by: "customer" | "mechanic";
  field: "engine" | "transmission" | "drivetrain" | "trim" | "body" | "platform" | "fuel" | "vin" | "model" | "year";
  from: { label: string; status: SpecStatus };
  to: { label: string; status: SpecStatus };
}

/** What a completed repair recorded about the car. Older records simply don't have these. */
export interface RecordedSpec {
  platform?: string;
  engineCode?: string;
  transmissionType?: TransmissionType;
  drivetrain?: Drivetrain;
  source: "vin_confirmed" | "selected" | "likely" | "mechanic_confirmed";
}
