import type { RepairRequest, Vehicle } from "./types";
import { siteAssessment } from "./site";

export type ReadinessLevel = "ready" | "range" | "ask";
export interface Readiness {
  level: ReadinessLevel;
  headline: string;
  /** Missing pieces, most important first. `blocks` = likely prevents an accurate estimate. */
  gaps: { text: string; blocks: boolean }[];
}

const PARTS_HEAVY = new Set(["brakes", "suspension", "cooling", "starters", "alternators", "ac", "engine"]);
const DIAGNOSTIC = new Set(["diagnostics", "electrical", "engine"]);

/**
 * Is there enough here to write an estimate? Same rules on both sides:
 * mechanics see it on opportunities, customers see it before they submit.
 */
export function quoteReadiness(r: RepairRequest, v?: Pick<Vehicle, "vin" | "mileage">): Readiness {
  const gaps: Readiness["gaps"] = [];
  const photos = [...r.media, ...r.questions.flatMap((q) => q.attachments)];
  const site = siteAssessment(r);

  if (r.symptomDescription.trim().length < 25) gaps.push({ text: "The problem description is very short", blocks: true });
  if (!r.startsStatus && !r.driveability) gaps.push({ text: "Doesn't say whether the car starts or drives", blocks: true });
  if (site.status === "conflict") gaps.push({ text: "Site answers disagree", blocks: true });
  if (site.status === "blocker") gaps.push({ text: "Repairs aren't allowed where the car is parked", blocks: true });
  if (!v?.vin && PARTS_HEAVY.has(r.repairCategory)) gaps.push({ text: "No VIN, so exact parts can't be confirmed", blocks: false });
  if (!v?.mileage) gaps.push({ text: "No mileage", blocks: false });
  if (!photos.length) gaps.push({ text: "No photos, video or sound yet", blocks: false });
  if (r.warningLights.some((l) => l !== "None") && !photos.some((m) => m.tag === "dashboard")) gaps.push({ text: "Warning light on, but no dashboard photo", blocks: false });
  if (DIAGNOSTIC.has(r.repairCategory) && !r.diagnosticCodes.length) gaps.push({ text: "No trouble codes read yet", blocks: false });
  if (site.status === "unknown") gaps.push({ text: "Some site conditions unknown", blocks: false });
  if (!r.urgency) gaps.push({ text: "No timing given", blocks: false });

  gaps.sort((a, b) => Number(b.blocks) - Number(a.blocks));
  const level: ReadinessLevel = gaps.some((g) => g.blocks) ? "ask" : gaps.length >= 3 ? "range" : "ready";
  const headline = { ready: "Enough to write an estimate", range: "Enough for an estimate range", ask: "Ask before quoting" }[level];
  return { level, headline, gaps };
}
