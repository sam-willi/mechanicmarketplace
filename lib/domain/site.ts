import type { RepairRequest } from "./types";

/**
 * One normalized reading of "can a mobile mechanic work where this car is?"
 * built from the customer's answers. Every fact is stated once, and each is
 * classified so nobody has to reconcile two lines that seem to disagree.
 */
export type SiteFactKind = "ok" | "missing" | "unsure" | "risk" | "blocker";
export type SiteFact = { kind: SiteFactKind; text: string };
export type SiteStatus = "ok" | "unknown" | "risk" | "blocker" | "conflict";

export interface SiteAssessment {
  status: SiteStatus;
  headline: string;
  facts: SiteFact[];
  /** Answers that disagree with each other. Shown as "confirm with the customer", never as two facts. */
  conflicts: string[];
  /** Things the customer said that reduce a risk ("can move the car to the street"). */
  mitigations: string[];
}

const SLOPE = /\b(slope|sloped|hill|incline|steep|slant|grade)\b/i;
const FLAT = /\bflat\b/i;
const CAN_MOVE = /\b(can|could|able to)\s+(move|push|roll|drive)\b/i;

export function siteAssessment(r: RepairRequest): SiteAssessment {
  const l = r.location;
  const notes = l.notes ?? "";
  const carMoves = !(r.driveability === "no" || r.startsStatus === "no_response" || r.startsStatus === "clicks_no_crank" || r.startsStatus === "cranks_no_start");

  const facts: SiteFact[] = [];
  const conflicts: string[] = [];
  const mitigations: string[] = [];

  // Where it's parked
  if (l.repairsAllowed === "no") facts.push({ kind: "blocker", text: "Repairs aren't allowed where it's parked" });
  else if (l.repairsAllowed === "unsure") facts.push({ kind: "unsure", text: "Customer isn't sure repairs are allowed there" });
  else if (!l.repairsAllowed) facts.push({ kind: "missing", text: "Not asked whether repairs are allowed there" });
  else facts.push({ kind: "ok", text: "Repairs allowed where it's parked" });

  // Ground
  if (l.flatGround === "yes") {
    facts.push({ kind: "ok", text: "On flat ground" });
    if (SLOPE.test(notes)) conflicts.push(`Said the car is on flat ground, but their notes mention a slope ("${notes.trim()}").`);
  } else if (l.flatGround === "no") {
    facts.push({ kind: "risk", text: "On a slope, not flat ground" });
    if (FLAT.test(notes) && !SLOPE.test(notes)) conflicts.push(`Said the car isn't on flat ground, but their notes mention flat ground ("${notes.trim()}").`);
  } else if (l.flatGround === "unsure") facts.push({ kind: "unsure", text: "Customer isn't sure the ground is flat" });
  else facts.push({ kind: "missing", text: "Ground not described" });

  // Space
  if (l.workSpace === "yes") facts.push({ kind: "ok", text: "Room to work around the car" });
  else if (l.workSpace === "limited") facts.push({ kind: "risk", text: "Limited room around the car" });
  else if (l.workSpace === "unsure") facts.push({ kind: "unsure", text: "Customer isn't sure there's room to work" });
  else facts.push({ kind: "missing", text: "Working space not described" });

  // Parking context
  if ((l.parkingType === "street" || l.parkingType === "apartment_garage" || l.parkingType === "parking_structure") && !carMoves)
    facts.push({ kind: "risk", text: "Car can't be moved, and it's parked somewhere tight" });

  if (CAN_MOVE.test(notes)) mitigations.push(`Customer says: "${notes.trim()}"`);

  const has = (k: SiteFactKind) => facts.some((f) => f.kind === k);
  const status: SiteStatus = conflicts.length ? "conflict" : has("blocker") ? "blocker" : has("risk") ? "risk" : has("missing") || has("unsure") ? "unknown" : "ok";
  const headline = {
    conflict: "Answers disagree: confirm the site before quoting",
    blocker: "Mobile repair isn't possible where it's parked",
    risk: mitigations.length ? "Mobile repair possible with some difficulty" : "Mobile repair may be difficult",
    unknown: "Mobile repair likely possible: some details unknown",
    ok: "Mobile repair looks possible",
  }[status];
  return { status, headline, facts, conflicts, mitigations };
}
