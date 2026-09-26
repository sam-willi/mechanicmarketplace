import type { RepairCategory } from "@/lib/domain/types";
import { BODY_LABEL, DRIVE_LABEL, ENGINES, TRANSMISSIONS, type CatalogConfig } from "./catalog";
import type { BodyStyle, Drivetrain, EngineSpec, SpecField, SpecStatus, TransmissionSpec, TransmissionType, VehicleSpec, VinInfo } from "./types";

/** What the customer has chosen so far. Ids are catalog ids when the model is in the catalog. */
export interface Selection {
  year?: number;
  make?: string;
  model?: string;
  body?: BodyStyle | "";
  trim?: string;
  engine?: string;
  transmission?: string;
  drivetrain?: Drivetrain | "";
  /** Free text when the car isn't in the factory data. */
  engineText?: string;
}

/** Normalized result of a VIN decode (provider-independent). */
export interface VinDecode {
  ok: boolean;
  vin: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  body?: BodyStyle;
  displacementL?: number;
  cylinders?: number;
  fuel?: string;
  drivetrain?: Drivetrain;
  transmissionType?: TransmissionType;
  transmissionSpeeds?: number;
  engineModel?: string;
  turbo?: boolean;
  /** Everything the decoder returned, for the full spec sheet. */
  raw: Record<string, string>;
  warnings: string[];
}

export const GENERIC_TRANSMISSIONS: { id: TransmissionType; label: string }[] = [
  { id: "manual", label: "Manual" },
  { id: "automatic", label: "Automatic" },
  { id: "cvt", label: "CVT" },
  { id: "dct", label: "Dual-clutch" },
];

/** Configurations still possible after the choices so far. */
export function remaining(configs: CatalogConfig[], sel: Selection) {
  return configs.filter(
    (c) =>
      (!sel.body || c.body === sel.body) &&
      (!sel.trim || (c.trim ?? "") === sel.trim) &&
      (!sel.engine || c.engine === sel.engine) &&
      (!sel.transmission || c.transmissions.includes(sel.transmission)) &&
      (!sel.drivetrain || c.drivetrains.includes(sel.drivetrain)),
  );
}

const uniq = <T,>(xs: T[]) => [...new Set(xs)];

/** The choices to offer at each configuration step, given everything chosen *except* that step. */
export function stepOptions(configs: CatalogConfig[], sel: Selection) {
  const without = (k: keyof Selection) => remaining(configs, { ...sel, [k]: undefined });
  return {
    bodies: uniq(without("body").map((c) => c.body)).map((b) => ({ id: b, label: BODY_LABEL[b] })),
    trims: uniq(without("trim").map((c) => c.trim ?? "")).map((t) => ({ id: t, label: t || "Standard" })),
    engines: uniq(without("engine").map((c) => c.engine)).map((e) => ({ id: e, label: ENGINES[e].label })),
    transmissions: uniq(without("transmission").flatMap((c) => c.transmissions)).map((t) => ({ id: t, label: TRANSMISSIONS[t].label })),
    drivetrains: uniq(without("drivetrain").flatMap((c) => c.drivetrains)).map((d) => ({ id: d, label: DRIVE_LABEL[d] })),
  };
}

/** Drop choices that are no longer possible after an earlier choice changed. */
export function pruneSelection(configs: CatalogConfig[], sel: Selection): Selection {
  const next = { ...sel };
  for (const k of ["body", "trim", "engine", "transmission", "drivetrain"] as const) {
    if (!next[k]) continue;
    const o = stepOptions(configs, next);
    const list = { body: o.bodies, trim: o.trims, engine: o.engines, transmission: o.transmissions, drivetrain: o.drivetrains }[k];
    if (!list.some((x) => x.id === next[k])) next[k] = undefined;
  }
  return next;
}

function field(id: string | undefined, label: string, status: SpecStatus, options?: string[]): SpecField {
  return { id, label, status, ...(options?.length ? { options } : {}) };
}

/**
 * Build the structured spec. For each attribute:
 * chosen → "selected"; one factory option left → "likely" (or "vin_confirmed" with a
 * consistent VIN); several left → "needs_confirmation". VIN disagreements become conflicts.
 */
export function buildSpec(sel: Selection, configs: CatalogConfig[], vin?: VinDecode): VehicleSpec {
  const vinOk = Boolean(vin?.ok);
  const conflicts: string[] = [];
  if (vin?.ok) {
    if (vin.year && sel.year && vin.year !== sel.year) conflicts.push(`VIN says ${vin.year}, you selected ${sel.year}.`);
    if (vin.make && sel.make && vin.make.toLowerCase() !== sel.make.toLowerCase()) conflicts.push(`VIN says ${vin.make}, you selected ${sel.make}.`);
    if (vin.model && sel.model && !sameModel(vin.model, sel.model)) conflicts.push(`VIN says ${vin.model}, you selected ${sel.model}.`);
  }
  const identityMatches = vinOk && conflicts.length === 0;
  const left = remaining(configs, sel);
  const implied = (chosen: boolean, count: number): SpecStatus => (chosen ? "selected" : count === 1 ? (identityMatches ? "vin_confirmed" : "likely") : "needs_confirmation");

  const spec: VehicleSpec = { version: 1, market: "US", vin: vinInfo(vin, conflicts), open: [] };

  if (configs.length) {
    const platforms = uniq(left.map((c) => c.platform.code));
    if (platforms.length === 1) spec.platform = field(left[0].platform.code, left[0].platform.label, identityMatches ? "vin_confirmed" : "likely");
    else if (platforms.length > 1) spec.platform = field(undefined, "Depends on body style", "needs_confirmation", uniq(left.map((c) => c.platform.label)));

    const bodies = uniq(left.map((c) => c.body));
    const vinBody = vin?.body && bodies.includes(vin.body) ? vin.body : undefined;
    if (vin?.body && sel.body && vin.body !== sel.body) conflicts.push(`VIN says ${BODY_LABEL[vin.body].toLowerCase()}, you selected ${BODY_LABEL[sel.body].toLowerCase()}.`);
    spec.body =
      bodies.length === 1
        ? field(bodies[0], BODY_LABEL[bodies[0]], sel.body ? "selected" : implied(false, 1))
        : vinBody && !sel.body
          ? field(vinBody, BODY_LABEL[vinBody], "vin_confirmed")
          : field(undefined, "Not confirmed", "needs_confirmation", bodies.map((b) => BODY_LABEL[b]));

    const trims = uniq(left.map((c) => c.trim).filter(Boolean) as string[]);
    if (trims.length === 1) spec.trim = field(trims[0], trims[0], sel.trim ? "selected" : implied(false, 1));
    else if (trims.length > 1) spec.trim = field(undefined, "Not confirmed", "needs_confirmation", trims);

    let engines = uniq(left.map((c) => c.engine));
    // A VIN's displacement and cylinder count can settle the engine among factory options.
    if (vinOk && engines.length > 1 && vin?.displacementL) {
      const fit = engines.filter((e) => Math.abs((ENGINES[e].displacementL ?? 0) - vin.displacementL!) < 0.15 && (!vin.cylinders || ENGINES[e].cylinders === vin.cylinders));
      if (fit.length === 1) engines = fit;
    }
    if (vinOk && sel.engine && vin?.displacementL && Math.abs((ENGINES[sel.engine]?.displacementL ?? 0) - vin.displacementL) >= 0.15)
      conflicts.push(`VIN says a ${vin.displacementL.toFixed(1)}L engine, you selected the ${ENGINES[sel.engine].label}.`);
    spec.engine =
      engines.length === 1
        ? engineField(engines[0], sel.engine ? "selected" : identityMatches ? "vin_confirmed" : "likely")
        : { label: "Not confirmed", status: "needs_confirmation", options: engines.map((e) => ENGINES[e].label) };

    const trans = uniq(left.flatMap((c) => c.transmissions));
    const vinTrans = vin?.transmissionType ? trans.filter((t) => TRANSMISSIONS[t].type === vin.transmissionType) : [];
    if (vin?.transmissionType && sel.transmission && TRANSMISSIONS[sel.transmission]?.type !== vin.transmissionType)
      conflicts.push(`VIN says ${vin.transmissionType}, you selected ${TRANSMISSIONS[sel.transmission].label.toLowerCase()}.`);
    spec.transmission = sel.transmission
      ? transField(sel.transmission, "selected")
      : trans.length === 1
        ? transField(trans[0], implied(false, 1))
        : vinTrans.length === 1
          ? transField(vinTrans[0], "vin_confirmed")
          : { label: "Not confirmed", status: "needs_confirmation", options: trans.map((t) => TRANSMISSIONS[t].label) };

    const drives = uniq(left.flatMap((c) => c.drivetrains));
    spec.drivetrain = sel.drivetrain
      ? field(sel.drivetrain, DRIVE_LABEL[sel.drivetrain], "selected")
      : drives.length === 1
        ? field(drives[0], DRIVE_LABEL[drives[0]], implied(false, 1))
        : vin?.drivetrain && drives.includes(vin.drivetrain)
          ? field(vin.drivetrain, DRIVE_LABEL[vin.drivetrain], "vin_confirmed")
          : field(undefined, "Not confirmed", "needs_confirmation", drives.map((d) => DRIVE_LABEL[d]));

    const fuels = uniq(left.map((c) => ENGINES[c.engine].fuel ?? "gasoline"));
    if (fuels.length === 1) spec.fuel = field(fuels[0], cap(fuels[0]), implied(false, 1));
    if (left.length === 1) spec.configId = left[0].id;
  } else {
    // Not in the factory data: only what the customer or VIN said, labelled as such.
    if (vin?.body) spec.body = field(vin.body, BODY_LABEL[vin.body], "vin_confirmed");
    if (vinOk && vin?.displacementL)
      spec.engine = {
        label: `${vin.displacementL.toFixed(1)}L${vin.cylinders ? ` ${vin.cylinders}-cylinder` : ""}${vin.turbo ? " turbo" : ""}${vin.engineModel ? ` (${vin.engineModel})` : ""}`,
        status: "vin_confirmed",
        code: vin.engineModel,
        displacementL: vin.displacementL,
        cylinders: vin.cylinders,
      };
    else if (sel.engineText) spec.engine = { label: sel.engineText, status: "customer_text" };
    if (sel.transmission) {
      const g = GENERIC_TRANSMISSIONS.find((x) => x.id === sel.transmission);
      if (vin?.transmissionType && g && g.id !== vin.transmissionType) conflicts.push(`VIN says ${vin.transmissionType}, you selected ${g.label.toLowerCase()}.`);
      spec.transmission = { id: sel.transmission, label: g?.label ?? sel.transmission, status: "selected", type: g?.id };
    } else if (vin?.transmissionType) {
      spec.transmission = { id: vin.transmissionType, label: cap(vin.transmissionType), status: "vin_confirmed", type: vin.transmissionType, speeds: vin.transmissionSpeeds };
    }
    if (sel.drivetrain) spec.drivetrain = field(sel.drivetrain, DRIVE_LABEL[sel.drivetrain], "selected");
    else if (vin?.drivetrain) spec.drivetrain = field(vin.drivetrain, DRIVE_LABEL[vin.drivetrain], "vin_confirmed");
    if (vin?.fuel) spec.fuel = field(vin.fuel.toLowerCase(), cap(vin.fuel.toLowerCase()), "vin_confirmed");
  }

  spec.vin = vinInfo(vin, conflicts);
  spec.open = openQuestions(spec);
  return spec;
}

function engineField(id: string, status: SpecStatus): EngineSpec {
  const e = ENGINES[id];
  return { id, status, label: e.label, code: e.code, displacementL: e.displacementL, cylinders: e.cylinders, layout: e.layout, aspiration: e.aspiration, fuel: e.fuel };
}

function transField(id: string, status: SpecStatus): TransmissionSpec {
  const t = TRANSMISSIONS[id];
  return { id, label: t.label, status, type: t.type, speeds: t.speeds };
}

function vinInfo(vin: VinDecode | undefined, conflicts: string[]): VinInfo {
  if (!vin) return { status: "none", conflicts };
  return {
    status: vin.ok ? (vin.displacementL || vin.body ? "decoded" : "partial") : "failed",
    decodedAt: new Date().toISOString(),
    last6: vin.vin.slice(-6),
    conflicts,
    decoded: vin.raw,
  };
}

function openQuestions(s: VehicleSpec) {
  const q: string[] = [];
  if (s.vin.conflicts.length) q.push("The VIN and the customer's selections disagree. Confirm which is right.");
  if (s.engine?.status === "needs_confirmation") q.push(`Which engine? ${s.engine.options?.join(" or ")}.`);
  if (s.transmission?.status === "needs_confirmation") q.push(`Which transmission? ${s.transmission.options?.join(", ")}.`);
  if (s.drivetrain?.status === "needs_confirmation") q.push(`Which drivetrain? ${s.drivetrain.options?.join(" or ")}.`);
  if (s.body?.status === "needs_confirmation" && s.platform?.status === "needs_confirmation") q.push(`Body style decides the platform: ${s.body.options?.join(" or ")}.`);
  return q;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function sameModel(a: string, b: string) {
  const n = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  return n(a) === n(b) || n(a).startsWith(n(b)) || n(b).startsWith(n(a));
}

// ---------------------------------------------------------------- display

export const STATUS_LABEL: Record<SpecStatus, string> = {
  vin_confirmed: "VIN confirmed",
  selected: "Customer selected",
  likely: "Needs confirmation",
  needs_confirmation: "Needs confirmation",
  customer_text: "Customer's description",
  mechanic_confirmed: "Mechanic confirmed",
  not_recorded: "Not recorded",
};

const known = (f?: SpecField) => Boolean(f && f.status !== "needs_confirmation" && f.status !== "not_recorded");

/** "2008 BMW 135i · 6-speed manual · 94,000 mi · VIN decoded" */
export function customerSummary(v: { year: number; make: string; model: string; mileage?: number }, s?: VehicleSpec) {
  const parts = [`${v.year} ${v.make} ${v.model}`];
  if (known(s?.transmission)) parts.push(s!.transmission!.label);
  if (v.mileage) parts.push(`${v.mileage.toLocaleString()} mi`);
  parts.push(s?.vin.status === "decoded" || s?.vin.status === "partial" ? "VIN decoded" : "No VIN yet");
  return parts.join(" · ");
}

/** "2008 BMW 135i — 6-speed manual — N54 3.0L twin-turbo inline-six — rear-wheel drive". Unconfirmed attributes are left out. */
export function mechanicHeadline(v: { year: number; make: string; model: string }, s?: VehicleSpec) {
  const parts = [`${v.year} ${v.make} ${v.model}`];
  if (s) {
    if (known(s.transmission)) parts.push(s.transmission!.label);
    if (known(s.engine)) parts.push(s.engine!.label);
    if (known(s.drivetrain)) parts.push(s.drivetrain!.label.toLowerCase());
  }
  return parts.join(" — ");
}

export type SpecKey = "engine" | "transmission" | "drivetrain" | "platform" | "body" | "trim" | "fuel";
/** Attribute order by repair: the ones that change the job come first. */
const RELEVANCE: Record<RepairCategory, SpecKey[]> = {
  engine: ["engine", "fuel", "platform", "transmission", "drivetrain", "body", "trim"],
  cooling: ["engine", "platform", "fuel", "trim", "transmission", "drivetrain", "body"],
  diagnostics: ["engine", "platform", "trim", "fuel", "transmission", "drivetrain", "body"],
  electrical: ["engine", "trim", "platform", "fuel", "drivetrain", "transmission", "body"],
  starters: ["engine", "transmission", "platform", "fuel", "drivetrain", "trim", "body"],
  alternators: ["engine", "platform", "trim", "fuel", "transmission", "drivetrain", "body"],
  brakes: ["trim", "platform", "body", "drivetrain", "engine", "transmission", "fuel"],
  suspension: ["drivetrain", "body", "platform", "trim", "engine", "transmission", "fuel"],
  ac: ["engine", "platform", "trim", "fuel", "body", "drivetrain", "transmission"],
  maintenance: ["engine", "transmission", "drivetrain", "fuel", "platform", "trim", "body"],
};

export const SPEC_LABEL: Record<SpecKey, string> = {
  engine: "Engine",
  transmission: "Transmission",
  drivetrain: "Drivetrain",
  platform: "Chassis / platform",
  body: "Body style",
  trim: "Trim",
  fuel: "Fuel",
};

export function orderedFields(s: VehicleSpec, category: RepairCategory) {
  return RELEVANCE[category].map((k) => ({ key: k, f: s[k] as SpecField | undefined })).filter((x) => x.f);
}
