import type {
  Driveability,
  Onset,
  ParkingType,
  RepairCategory,
  RepairRequest,
  StartsStatus,
  Transmission,
  Urgency,
  Vehicle,
  WorkSpace,
  YesNoUnsure,
} from "./types";

/**
 * Repair-request intake vocabulary and the structured summary mechanics read.
 * Principle: the customer describes evidence, Clutch structures it, the mechanic
 * interprets it and makes the diagnosis.
 */

export const SYMPTOM_EXAMPLES = [
  "Car clicks once when I try to start it but the engine doesn't turn over.",
  "Steering wheel shakes when braking above 50 mph.",
  "Coolant leaks underneath the front of the car after driving.",
  "Check engine light came on and the engine is shaking at idle.",
];

export const OCCURRENCE = [
  "All the time",
  "Intermittently",
  "When cold",
  "When hot",
  "At startup",
  "At idle",
  "While accelerating",
  "While braking",
  "While turning",
  "At highway speed",
  "At low speed",
  "Over bumps",
  "After driving for a while",
  "Other",
];

export const ONSET: { value: Onset; label: string }[] = [
  { value: "today", label: "Just started today" },
  { value: "few_days", label: "Within the last few days" },
  { value: "few_weeks", label: "Within the last few weeks" },
  { value: "over_month", label: "Longer than a month" },
  { value: "unsure", label: "Not sure" },
];

export const STARTS: { value: StartsStatus; label: string }[] = [
  { value: "normal", label: "Yes, normally" },
  { value: "difficult", label: "Yes, but with difficulty" },
  { value: "cranks_no_start", label: "Cranks but won't start" },
  { value: "clicks_no_crank", label: "Clicks but won't crank" },
  { value: "no_response", label: "No response at all" },
  { value: "unsure", label: "Not sure" },
];

export const DRIVEABILITY: { value: Driveability; label: string }[] = [
  { value: "normal", label: "Yes, normally" },
  { value: "short_distance", label: "Yes, but only a short distance" },
  { value: "unsafe", label: "Yes, but I don't think it's safe" },
  { value: "no", label: "No" },
];

export const YNU: { value: YesNoUnsure; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unsure", label: "Not sure" },
];

export const WARNING_LIGHTS = ["Check engine", "Battery", "Oil", "ABS", "Brake", "Airbag", "Temperature", "Tire pressure", "Other", "None"];

export const SOUNDS = ["Clicking", "Grinding", "Squealing", "Knocking", "Rattling", "Humming", "Whining", "Hissing", "Other"];

export const SMELLS = ["Burning", "Fuel", "Sweet / coolant-like", "Sulfur / rotten egg", "Electrical / plastic", "Other", "Not sure"];

export const LEAK_LOCATIONS = ["Front of car", "Middle", "Back", "Near a wheel", "Not sure"];
export const LEAK_COLORS = ["Clear / water-like", "Green, orange or pink", "Brown or black", "Red", "Blue", "Not sure"];
export const LEAK_AMOUNTS = ["A few drops", "A small puddle", "A large puddle", "Not sure"];

export const MODIFICATIONS = ["Engine / tune", "Intake / exhaust", "Suspension", "Wheels / tires", "Electrical", "Stereo / accessories", "Aftermarket alarm", "Other"];

export const PARKING: { value: ParkingType; label: string }[] = [
  { value: "driveway", label: "Driveway" },
  { value: "private_garage", label: "Private garage" },
  { value: "apartment_garage", label: "Apartment garage" },
  { value: "parking_lot", label: "Parking lot" },
  { value: "street", label: "Street parking" },
  { value: "parking_structure", label: "Parking structure" },
  { value: "other", label: "Other" },
];

export const WORK_SPACE: { value: WorkSpace; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "limited", label: "Limited" },
  { value: "unsure", label: "Not sure" },
];

export const URGENCY: { value: Urgency; label: string }[] = [
  { value: "stranded", label: "Urgent: the car is stranded" },
  { value: "today", label: "Today" },
  { value: "one_two_days", label: "Within 1–2 days" },
  { value: "this_week", label: "This week" },
  { value: "flexible", label: "I'm flexible" },
];

/** Optional "known repair/service" — only if the customer already knows. */
export const KNOWN_SERVICES: { value: RepairCategory; label: string }[] = [
  { value: "brakes", label: "Brake repair or replacement" },
  { value: "starters", label: "Battery or starter" },
  { value: "alternators", label: "Alternator / charging" },
  { value: "maintenance", label: "Oil change or scheduled service" },
  { value: "suspension", label: "Suspension or steering" },
  { value: "cooling", label: "Cooling system" },
  { value: "ac", label: "A/C or heating" },
  { value: "electrical", label: "Electrical" },
  { value: "engine", label: "Engine repair" },
  { value: "diagnostics", label: "Diagnostic visit" },
];

export const TRANSMISSIONS: { value: Transmission; label: string }[] = [
  { value: "automatic", label: "Automatic" },
  { value: "manual", label: "Manual" },
  { value: "cvt", label: "CVT" },
  { value: "dual_clutch", label: "Dual-clutch" },
  { value: "unsure", label: "Not sure" },
];

/** Model years offered in the intake, newest first. */
export const MODEL_YEARS = Array.from({ length: 2027 - 1985 + 1 }, (_, i) => 2027 - i);

const label = <T extends string>(list: { value: T; label: string }[], v?: string) => list.find((o) => o.value === v)?.label;
export const transmissionLabel = (v?: string) => label(TRANSMISSIONS, v);
export const onsetLabel = (v?: string) => label(ONSET, v);
export const startsLabel = (v?: string) => label(STARTS, v);
export const driveLabel = (v?: string) => label(DRIVEABILITY, v);
export const parkingLabel = (v?: string) => label(PARKING, v);
export const urgencyLabel = (v?: string) => label(URGENCY, v);

// ---------------------------------------------------------------------------
// Diagnostic codes: normalised, never interpreted.
// ---------------------------------------------------------------------------
export function parseCodes(raw: string): string[] {
  return [...new Set(raw.toUpperCase().split(/[\s,;]+/).map((c) => c.replace(/[^A-Z0-9]/g, "")).filter((c) => c.length >= 3 && c.length <= 8))];
}

export const CODE_NOTE = "A diagnostic code can help narrow down the problem, but it does not necessarily identify the failed part.";

// ---------------------------------------------------------------------------
// Routing only: infer a category so the request reaches mechanics with relevant
// experience. Never shown to mechanics as "what's wrong".
// ---------------------------------------------------------------------------
const KEYWORDS: [RepairCategory, RegExp][] = [
  ["brakes", /brak|rotor|pad|squeal.*stop|grind.*stop|abs/i],
  ["starters", /won'?t (start|crank)|no.?start|click(s|ing)? (once|when)|starter|dead battery|battery/i],
  ["alternators", /alternator|charging|battery light|dim(s|ming)? lights?/i],
  ["cooling", /coolant|overheat|temperature|radiator|antifreeze|steam|sweet smell/i],
  ["ac", /\ba\/?c\b|air con|blows (warm|hot)|heater/i],
  ["suspension", /clunk|bump|strut|shock|steering|wobble|pulls? to|alignment/i],
  ["engine", /oil leak|knock|misfire|smoke|timing|shak(e|ing) at idle|rough idle/i],
  ["electrical", /window|lights? (don'?t|not)|fuse|drain|electrical|radio|dash(board)? (dead|flicker)/i],
  ["maintenance", /oil change|service due|maintenance|tune.?up/i],
];

export function inferCategory(text: string, codes: string[], lights: string[]): RepairCategory {
  for (const [cat, re] of KEYWORDS) if (re.test(text)) return cat;
  if (lights.includes("Brake") || lights.includes("ABS")) return "brakes";
  if (lights.includes("Battery")) return "alternators";
  if (lights.includes("Temperature")) return "cooling";
  if (codes.length || lights.includes("Check engine")) return "diagnostics";
  return "diagnostics";
}

// ---------------------------------------------------------------------------
// Vehicle: manual values win over decoded ones.
// ---------------------------------------------------------------------------
export function resolvedVehicle(v: Vehicle) {
  const d = v.vinDecoded;
  return {
    year: v.year || d?.year,
    make: v.make || d?.make,
    model: v.model || d?.model,
    trim: v.trim || d?.trim,
    engine: v.engine || d?.engine,
  };
}

export function vehicleLine(v: Vehicle) {
  const r = resolvedVehicle(v);
  return [r.year, r.make, r.model, r.trim].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// The structured summary: what a mechanic needs to understand the job in seconds.
// ---------------------------------------------------------------------------
export type Tone = "stop" | "caution" | "ok" | "neutral";

export interface JobStatus {
  headline: string; // e.g. "NO-START"
  tone: Tone;
  lines: string[];
}

export function jobStatus(r: RepairRequest): JobStatus {
  const lines: string[] = [];
  const s = r.startsStatus;
  const d = r.driveability;
  if (s && s !== "normal") lines.push(startsLabel(s) === "Yes, but with difficulty" ? "Starts, but with difficulty" : (startsLabel(s) ?? ""));
  else if (s === "normal") lines.push("Starts normally");
  if (d === "no") lines.push("Vehicle can't move under its own power");
  else if (d === "short_distance") lines.push("Can only be driven a short distance");
  else if (d === "unsafe") lines.push("Moves, but customer doesn't think it's safe");
  else if (d === "normal") lines.push("Drives normally");
  if (r.safeToDrive === "no") lines.push("Customer says it isn't safe to drive");
  else if (r.safeToDrive === "unsure") lines.push("Customer isn't sure it's safe to drive");

  const noStart = s === "cranks_no_start" || s === "clicks_no_crank" || s === "no_response";
  if (noStart) return { headline: "No-start", tone: "stop", lines };
  if (d === "no") return { headline: "Won't move", tone: "stop", lines };
  if (d === "unsafe" || r.safeToDrive === "no" || d === "short_distance") return { headline: "Not safe to drive", tone: "stop", lines };
  if (s === "difficult" || r.safeToDrive === "unsure") return { headline: "Runs, with caution", tone: "caution", lines };
  if (s === "normal" || d === "normal") return { headline: "Runs and drives", tone: "ok", lines };
  return { headline: "Condition not given", tone: "neutral", lines };
}

export interface Feasibility {
  label: string;
  tone: Tone;
  reasons: string[];
}

/** Can this realistically be done where the car is? Facts only, the mechanic decides. */
export function mobileFeasibility(r: RepairRequest): Feasibility {
  const l = r.location;
  const reasons: string[] = [];
  if (l.flatGround === "no") reasons.push("Not on flat ground");
  if (l.workSpace === "limited") reasons.push("Limited room around the car");
  if (l.repairsAllowed === "no") reasons.push("Repairs not allowed where it's parked");
  const unknowns = [l.flatGround, l.workSpace, l.repairsAllowed].filter((x) => x === "unsure" || x === undefined).length;
  if (reasons.length) return { label: "Mobile repair may be difficult", tone: "stop", reasons };
  if (unknowns) return { label: "Mobile repair likely possible", tone: "caution", reasons: ["Customer unsure about some site conditions"] };
  return { label: "Mobile repair looks possible", tone: "ok", reasons: [] };
}

export function mediaCounts(r: RepairRequest) {
  const all = [...r.media, ...r.questions.flatMap((q) => q.attachments)];
  const n = (k: string) => all.filter((m) => m.kind === k).length;
  const parts = [
    [n("photo"), "photo"],
    [n("video"), "video"],
    [n("audio"), "audio clip"],
    [n("document"), "document"],
  ] as const;
  return parts
    .filter(([c]) => c > 0)
    .map(([c, w]) => `${c} ${w}${c === 1 ? "" : "s"}`)
    .join(" · ");
}

/** First sentence of the symptom description, for the request card. */
export function primarySymptom(r: RepairRequest) {
  const t = r.symptomDescription.trim();
  const m = t.match(/^(.{0,160}?[.!?])(\s|$)/);
  return m ? m[1] : t.length > 160 ? `${t.slice(0, 157)}…` : t;
}
