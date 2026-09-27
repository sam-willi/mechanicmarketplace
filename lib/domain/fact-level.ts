import type { SpecStatus } from "@/lib/vehicles/types";
import type { PastRepairSource, ProvenanceSource } from "./types";

/**
 * How sure a fact is, in five levels used on every screen (repairs, vehicles, requests, profiles).
 * Only the first two are ever inked as proven.
 *  - verified: proven by a record Clutch holds (a Clutch job, a VIN decode, a reviewed document, an issuer or employer)
 *  - customer_confirmed: a past customer confirmed it through their own link
 *  - self_reported: stated by the person it's about, or by the customer about their own car
 *  - inferred: worked out by Clutch from other facts, not stated by anyone
 *  - unverified: nobody has confirmed it (or it's unknown)
 */
export type FactLevel = "verified" | "customer_confirmed" | "self_reported" | "inferred" | "unverified";

export const FACT_LABEL: Record<FactLevel, string> = {
  verified: "Verified",
  customer_confirmed: "Customer confirmed",
  self_reported: "Self-reported",
  inferred: "Inferred by Clutch",
  unverified: "Unverified",
};

export function levelOfSource(s: ProvenanceSource): FactLevel {
  return s === "self" ? "self_reported" : s === "customer" ? "customer_confirmed" : "verified";
}

export function levelOfPastRepair(s: PastRepairSource): FactLevel {
  return s === "self" ? "self_reported" : s === "customer_confirmed" ? "customer_confirmed" : "verified";
}

export function levelOfSpec(s: SpecStatus): FactLevel {
  switch (s) {
    case "vin_confirmed":
    case "mechanic_confirmed":
      return "verified";
    case "selected":
    case "customer_text":
      return "self_reported";
    case "likely":
      return "inferred";
    default:
      return "unverified";
  }
}

/** The repair type on a request: named by the customer, or worked out from their description. */
export function levelOfCategory(source: "customer" | "inferred"): FactLevel {
  return source === "inferred" ? "inferred" : "self_reported";
}
