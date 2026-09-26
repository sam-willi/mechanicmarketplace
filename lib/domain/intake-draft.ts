import type { VehicleChoice } from "@/lib/vehicles/choice";
import type { VehicleSpec } from "@/lib/vehicles/types";
import type {
  CustomerPart,
  Driveability,
  Onset,
  ParkingType,
  RecentRepair,
  RepairMedia,
  StartsStatus,
  Transmission,
  Urgency,
  WorkSpace,
  YesNoUnsure,
} from "./types";

/**
 * The in-progress intake, exactly as the form holds it. Autosaved on every step
 * change so a customer standing next to their car can stop and come back.
 */
export interface IntakeDraft {
  step: number;
  vehicleId: string; // saved vehicle id, or "new"
  vehicle: {
    year: string;
    make: string;
    model: string;
    trim: string;
    engine: string;
    transmission: Transmission | "";
    vin: string;
    mileage: string;
    /** Structured selection from the cascading picker (components/vehicle). */
    choice?: VehicleChoice;
    /** Preview of the structured spec; the server rebuilds it on submit. */
    spec?: VehicleSpec;
  };

  symptomDescription: string;
  occurrence: string[];
  occurrenceNotes: string;
  onset: Onset | "";
  firstNoticed: string;
  startsStatus: StartsStatus | "";
  driveability: Driveability | "";
  safeToDrive: YesNoUnsure | "";

  warningLights: string[];
  hasCodes: "yes" | "no" | "";
  codes: string;
  soundPresent: YesNoUnsure | "";
  soundKinds: string[];
  soundDescription: string;
  smells: string[];
  leakPresent: YesNoUnsure | "";
  leakLocation: string;
  leakColor: string;
  leakAmount: string;

  hasRecentWork: "yes" | "no" | "";
  recentRepairs: RecentRepair[];
  hasMods: "yes" | "no" | "";
  modKinds: string[];
  modNotes: string;
  suspectedIssue: string;
  knownService: string;
  hadPriorShop: "yes" | "no" | "";
  priorSaid: string;
  priorRepair: string;
  priorPrice: string;
  hasParts: "yes" | "no" | "";
  parts: CustomerPart[];

  serviceMode: "mobile" | "shop" | "";
  area: string;
  address: string;
  parkingType: ParkingType | "";
  flatGround: YesNoUnsure | "";
  workSpace: WorkSpace | "";
  repairsAllowed: YesNoUnsure | "";
  locationNotes: string;
  accessAvailable: "yes" | "no" | "";
  accessInstructions: string;

  urgency: Urgency | "";
  preferredTimes: string;

  media: RepairMedia[];

  directTo?: string;
  rebookOf?: string;
}

export function emptyDraft(partial: Partial<IntakeDraft> = {}): IntakeDraft {
  return {
    step: 0,
    vehicleId: "new",
    vehicle: { year: "", make: "", model: "", trim: "", engine: "", transmission: "", vin: "", mileage: "" },
    symptomDescription: "",
    occurrence: [],
    occurrenceNotes: "",
    onset: "",
    firstNoticed: "",
    startsStatus: "",
    driveability: "",
    safeToDrive: "",
    warningLights: [],
    hasCodes: "",
    codes: "",
    soundPresent: "",
    soundKinds: [],
    soundDescription: "",
    smells: [],
    leakPresent: "",
    leakLocation: "",
    leakColor: "",
    leakAmount: "",
    hasRecentWork: "",
    recentRepairs: [],
    hasMods: "",
    modKinds: [],
    modNotes: "",
    suspectedIssue: "",
    knownService: "",
    hadPriorShop: "",
    priorSaid: "",
    priorRepair: "",
    priorPrice: "",
    hasParts: "",
    parts: [],
    serviceMode: "",
    area: "",
    address: "",
    parkingType: "",
    flatGround: "",
    workSpace: "",
    repairsAllowed: "",
    locationNotes: "",
    accessAvailable: "",
    accessInstructions: "",
    urgency: "",
    preferredTimes: "",
    media: [],
    ...partial,
  };
}

/** Per-step checks. Only what a mechanic genuinely needs is required. */
export function stepErrors(d: IntakeDraft, step: number, hasSavedVehicle: boolean): string[] {
  const e: string[] = [];
  if (step === 0) {
    const isNew = d.vehicleId === "new" || !hasSavedVehicle;
    if (isNew) {
      if (!d.vehicle.year) e.push("Choose the year.");
      if (!d.vehicle.make) e.push("Choose the make.");
      if (!d.vehicle.model.trim()) e.push("Choose the model.");
      const t = d.vehicle.spec?.transmission;
      if (!d.vehicle.transmission && !(t && t.status !== "needs_confirmation")) e.push("Choose the transmission.");
    }
    if (!d.vehicle.mileage.replace(/[^0-9]/g, "")) e.push("Enter the current mileage (a rough number is fine).");
    if (d.vehicle.vin && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(d.vehicle.vin.trim())) e.push("A VIN is 17 letters and numbers (no I, O or Q). Leave it blank if you're not sure.");
  }
  if (step === 1) {
    if (d.symptomDescription.trim().length < 10) e.push("Tell us what the car is doing, in a sentence or two.");
    if (!d.startsStatus) e.push("Say whether the car starts, or pick what happens when you try.");
  }
  if (step === 2) {
    if (!d.serviceMode) e.push("Choose where the repair should happen.");
    if (!d.area) e.push("Choose the area the car is in.");
  }
  if (step === 3) {
    if (!d.urgency) e.push("Choose how soon you need help.");
  }
  return e;
}
