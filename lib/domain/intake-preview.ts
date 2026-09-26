import { findArea } from "./areas";
import { inferCategory, parseCodes } from "./intake";
import type { IntakeDraft } from "./intake-draft";
import { REPAIR_CATEGORIES, type RepairCategory, type RepairRequest, type Vehicle, type VehicleMake } from "./types";

/**
 * One translation from the customer's draft to a request, used by both the
 * review step (so the customer sees exactly what mechanics will see) and submit.
 */
export function draftToRequest(draft: IntakeDraft, customerId: string, saved: Vehicle[]) {
  const mileage = Number(draft.vehicle.mileage.replace(/[^0-9]/g, "")) || undefined;
  const vin = draft.vehicle.vin.trim().toUpperCase() || undefined;
  const existing = saved.find((v) => v.id === draft.vehicleId);
  const vehicle: Vehicle = existing
    ? {
        ...existing,
        mileage: mileage ?? existing.mileage,
        vin: existing.vin ?? vin,
        transmission: existing.transmission ?? (draft.vehicle.transmission || undefined),
        spec: existing.spec ?? draft.vehicle.spec,
      }
    : {
        id: "new",
        customerId,
        year: Number(draft.vehicle.year) || 0,
        make: draft.vehicle.make as VehicleMake,
        model: draft.vehicle.model.trim(),
        trim: draft.vehicle.trim.trim() || undefined,
        engine: draft.vehicle.engine.trim() || undefined,
        transmission: draft.vehicle.transmission || undefined,
        vin,
        mileage,
        spec: draft.vehicle.spec,
      };

  const codes = draft.hasCodes === "yes" ? parseCodes(draft.codes) : [];
  const lights = draft.warningLights.includes("None") && draft.warningLights.length > 1 ? draft.warningLights.filter((l) => l !== "None") : draft.warningLights;
  const known = REPAIR_CATEGORIES.includes(draft.knownService as RepairCategory) ? (draft.knownService as RepairCategory) : undefined;
  const text = [draft.symptomDescription, draft.suspectedIssue, draft.soundKinds.join(" "), draft.smells.join(" ")].join(" ");
  const mobile = draft.serviceMode === "mobile";
  const priorPrice = Math.round((Number(draft.priorPrice.replace(/[^0-9.]/g, "")) || 0) * 100) || undefined;
  const yes = (x: string) => x === "yes";

  const fields = {
    repairCategory: known ?? inferCategory(text, codes, lights),
    categorySource: known ? ("customer" as const) : ("inferred" as const),
    symptomDescription: draft.symptomDescription.trim(),
    occurrence: { conditions: draft.occurrence, notes: draft.occurrenceNotes.trim() || undefined },
    onset: { when: draft.onset || undefined, firstNoticed: draft.firstNoticed.trim() || undefined },
    startsStatus: draft.startsStatus || undefined,
    driveability: draft.driveability || undefined,
    safeToDrive: draft.safeToDrive || undefined,
    warningLights: lights,
    diagnosticCodes: codes,
    sounds: draft.soundPresent
      ? { present: draft.soundPresent, kinds: yes(draft.soundPresent) ? draft.soundKinds : [], description: yes(draft.soundPresent) ? draft.soundDescription.trim() || undefined : undefined }
      : undefined,
    smells: draft.smells,
    leaks: draft.leakPresent
      ? {
          present: draft.leakPresent,
          location: yes(draft.leakPresent) ? draft.leakLocation || undefined : undefined,
          color: yes(draft.leakPresent) ? draft.leakColor || undefined : undefined,
          amount: yes(draft.leakPresent) ? draft.leakAmount || undefined : undefined,
        }
      : undefined,
    recentRepairs: yes(draft.hasRecentWork) ? draft.recentRepairs.filter((x) => x.what.trim()) : [],
    modifications: yes(draft.hasMods) ? { kinds: draft.modKinds, notes: draft.modNotes.trim() || undefined } : undefined,
    suspectedIssue: draft.suspectedIssue.trim() || undefined,
    priorDiagnosis:
      yes(draft.hadPriorShop) && draft.priorSaid.trim()
        ? { said: draft.priorSaid.trim(), quotedRepair: draft.priorRepair.trim() || undefined, quotedPriceCents: priorPrice }
        : undefined,
    customerParts: yes(draft.hasParts) ? draft.parts.filter((x) => x.description.trim()) : [],
    location: {
      serviceMode: mobile ? ("mobile" as const) : ("shop" as const),
      area: findArea(draft.area)?.key,
      address: mobile ? draft.address.trim() || undefined : undefined,
      parkingType: mobile ? draft.parkingType || undefined : undefined,
      flatGround: mobile ? draft.flatGround || undefined : undefined,
      workSpace: mobile ? draft.workSpace || undefined : undefined,
      repairsAllowed: mobile ? draft.repairsAllowed || undefined : undefined,
      notes: draft.locationNotes.trim() || undefined,
      accessAvailable: draft.accessAvailable ? yes(draft.accessAvailable) : undefined,
      accessInstructions: mobile ? draft.accessInstructions.trim() || undefined : undefined,
    },
    urgency: draft.urgency || undefined,
    preferredTimes: draft.preferredTimes.trim() || undefined,
    media: draft.media,
  };

  const preview: RepairRequest = {
    id: "preview",
    customerId,
    vehicleId: vehicle.id,
    ...fields,
    vehicleSpec: vehicle.spec,
    status: "draft",
    createdAt: "",
    matchedMechanicIds: [],
    declinedBy: [],
    questions: [],
    interested: [],
  };
  return { fields, vehicle, preview, isNewVehicle: !existing };
}
