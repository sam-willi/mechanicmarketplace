import type { BodyStyle, Drivetrain, EngineSpec, TransmissionType } from "./types";

/**
 * Curated factory configuration data (US market) for the models Clutch's
 * launch data covers. It answers "which engines, transmissions, bodies and
 * drivetrains existed for this year and model?" so choices can be filtered.
 *
 * This is deliberately a small, checked dataset behind the VehicleDataProvider
 * interface (lib/vehicles/provider.ts). A licensed YMMT data source can replace
 * it without changing callers. Models not covered here still work: the
 * customer picks generic options, and nothing is shown as a factory fact.
 */

type EngineDef = Omit<EngineSpec, "status" | "label" | "options" | "id"> & { code: string; label: string };
export const ENGINES: Record<string, EngineDef> = {
  N52: { code: "N52", label: "N52 3.0L inline-six", displacementL: 3.0, cylinders: 6, layout: "inline", aspiration: "naturally aspirated", fuel: "gasoline" },
  N54: { code: "N54", label: "N54 3.0L twin-turbo inline-six", displacementL: 3.0, cylinders: 6, layout: "inline", aspiration: "twin-turbo", fuel: "gasoline" },
  N55: { code: "N55", label: "N55 3.0L turbo inline-six", displacementL: 3.0, cylinders: 6, layout: "inline", aspiration: "turbocharged", fuel: "gasoline" },
  N20: { code: "N20", label: "N20 2.0L turbo four", displacementL: 2.0, cylinders: 4, layout: "inline", aspiration: "turbocharged", fuel: "gasoline" },
  B46: { code: "B46", label: "B46 2.0L turbo four", displacementL: 2.0, cylinders: 4, layout: "inline", aspiration: "turbocharged", fuel: "gasoline" },
  B58: { code: "B58", label: "B58 3.0L turbo inline-six", displacementL: 3.0, cylinders: 6, layout: "inline", aspiration: "turbocharged", fuel: "gasoline" },
  "2AR-FE": { code: "2AR-FE", label: "2AR-FE 2.5L four", displacementL: 2.5, cylinders: 4, layout: "inline", aspiration: "naturally aspirated", fuel: "gasoline" },
  "2AR-FXE": { code: "2AR-FXE", label: "2AR-FXE 2.5L four, hybrid", displacementL: 2.5, cylinders: 4, layout: "inline", aspiration: "hybrid", fuel: "hybrid" },
  "2GR-FE": { code: "2GR-FE", label: "2GR-FE 3.5L V6", displacementL: 3.5, cylinders: 6, layout: "V", aspiration: "naturally aspirated", fuel: "gasoline" },
  "2GR-FKS": { code: "2GR-FKS", label: "2GR-FKS 3.5L V6", displacementL: 3.5, cylinders: 6, layout: "V", aspiration: "naturally aspirated", fuel: "gasoline" },
  "A25A-FKS": { code: "A25A-FKS", label: "A25A-FKS 2.5L four", displacementL: 2.5, cylinders: 4, layout: "inline", aspiration: "naturally aspirated", fuel: "gasoline" },
  "A25A-FXS": { code: "A25A-FXS", label: "A25A-FXS 2.5L four, hybrid", displacementL: 2.5, cylinders: 4, layout: "inline", aspiration: "hybrid", fuel: "hybrid" },
  "2ZR-FXE": { code: "2ZR-FXE", label: "2ZR-FXE 1.8L four, hybrid", displacementL: 1.8, cylinders: 4, layout: "inline", aspiration: "hybrid", fuel: "hybrid" },
  "2TR-FE": { code: "2TR-FE", label: "2TR-FE 2.7L four", displacementL: 2.7, cylinders: 4, layout: "inline", aspiration: "naturally aspirated", fuel: "gasoline" },
  "1GR-FE": { code: "1GR-FE", label: "1GR-FE 4.0L V6", displacementL: 4.0, cylinders: 6, layout: "V", aspiration: "naturally aspirated", fuel: "gasoline" },
  "2TR-FKS": { code: "2TR-FKS", label: "2TR-FKS 2.7L four", displacementL: 2.7, cylinders: 4, layout: "inline", aspiration: "naturally aspirated", fuel: "gasoline" },
  K24W: { code: "K24W", label: "K24W 2.4L four", displacementL: 2.4, cylinders: 4, layout: "inline", aspiration: "naturally aspirated", fuel: "gasoline" },
  L15B7: { code: "L15B7", label: "L15B7 1.5L turbo four", displacementL: 1.5, cylinders: 4, layout: "inline", aspiration: "turbocharged", fuel: "gasoline" },
  J35Y6: { code: "J35Y6", label: "J35Y6 3.5L V6", displacementL: 3.5, cylinders: 6, layout: "V", aspiration: "naturally aspirated", fuel: "gasoline" },
};

export const TRANSMISSIONS: Record<string, { id: string; label: string; type: TransmissionType; speeds?: number }> = {
  "5MT": { id: "5MT", label: "5-speed manual", type: "manual", speeds: 5 },
  "6MT": { id: "6MT", label: "6-speed manual", type: "manual", speeds: 6 },
  "4AT": { id: "4AT", label: "4-speed automatic", type: "automatic", speeds: 4 },
  "5AT": { id: "5AT", label: "5-speed automatic", type: "automatic", speeds: 5 },
  "6AT": { id: "6AT", label: "6-speed automatic", type: "automatic", speeds: 6 },
  "8AT": { id: "8AT", label: "8-speed automatic", type: "automatic", speeds: 8 },
  "9AT": { id: "9AT", label: "9-speed automatic", type: "automatic", speeds: 9 },
  "7DCT": { id: "7DCT", label: "7-speed dual-clutch", type: "dct", speeds: 7 },
  CVT: { id: "CVT", label: "CVT (continuously variable)", type: "cvt" },
  eCVT: { id: "eCVT", label: "Hybrid eCVT", type: "ecvt" },
};

export const BODY_LABEL: Record<BodyStyle, string> = {
  sedan: "Sedan",
  coupe: "Coupe",
  convertible: "Convertible",
  hatchback: "Hatchback",
  wagon: "Wagon",
  suv: "SUV",
  truck: "Pickup",
  minivan: "Minivan",
};

export const DRIVE_LABEL: Record<Drivetrain, string> = { FWD: "Front-wheel drive", RWD: "Rear-wheel drive", AWD: "All-wheel drive", "4WD": "Four-wheel drive" };

export interface CatalogConfig {
  id: string;
  make: string;
  /** Model as customers and NHTSA name it, e.g. "135i", "Camry". */
  model: string;
  years: [number, number];
  platform: { code: string; label: string };
  body: BodyStyle;
  trim?: string;
  engine: keyof typeof ENGINES;
  transmissions: (keyof typeof TRANSMISSIONS)[];
  drivetrains: Drivetrain[];
}

const c = (
  id: string,
  make: string,
  model: string,
  years: [number, number],
  platform: [string, string],
  body: BodyStyle,
  engine: string,
  transmissions: string[],
  drivetrains: Drivetrain[],
  trim?: string,
): CatalogConfig => ({ id, make, model, years, platform: { code: platform[0], label: platform[1] }, body, engine, transmissions, drivetrains, trim });

const E82: [string, string] = ["E82", "1 Series coupe (E82)"];
const E88: [string, string] = ["E88", "1 Series convertible (E88)"];
const E9X_S: [string, string] = ["E90", "3 Series sedan (E90)"];
const E92: [string, string] = ["E92", "3 Series coupe (E92)"];
const E93: [string, string] = ["E93", "3 Series convertible (E93)"];
const F30: [string, string] = ["F30", "3 Series sedan (F30)"];
const G20: [string, string] = ["G20", "3 Series sedan (G20)"];
const F32: [string, string] = ["F32", "4 Series coupe (F32)"];
const F33: [string, string] = ["F33", "4 Series convertible (F33)"];
const E60: [string, string] = ["E60", "5 Series sedan (E60)"];
const F10: [string, string] = ["F10", "5 Series sedan (F10)"];
const F25: [string, string] = ["F25", "X3 (F25)"];
const G01: [string, string] = ["G01", "X3 (G01)"];
const E70: [string, string] = ["E70", "X5 (E70)"];
const F15: [string, string] = ["F15", "X5 (F15)"];
const G05: [string, string] = ["G05", "X5 (G05)"];
const XV50: [string, string] = ["XV50", "Camry (XV50)"];
const XV70: [string, string] = ["XV70", "Camry (XV70)"];
const TAC2: [string, string] = ["N200", "Tacoma, 2nd generation"];
const TAC3: [string, string] = ["N300", "Tacoma, 3rd generation"];
const PRI3: [string, string] = ["XW30", "Prius, 3rd generation"];
const PRI4: [string, string] = ["XW50", "Prius, 4th generation"];
const CRV5: [string, string] = ["RW", "CR-V, 5th generation"];
const PIL3: [string, string] = ["YF6", "Pilot, 3rd generation"];

export const CATALOG: CatalogConfig[] = [
  // BMW 1 Series
  c("bmw-128i-e82", "BMW", "128i", [2008, 2013], E82, "coupe", "N52", ["6MT", "6AT"], ["RWD"]),
  c("bmw-128i-e88", "BMW", "128i", [2008, 2013], E88, "convertible", "N52", ["6MT", "6AT"], ["RWD"]),
  c("bmw-135i-e82-n54", "BMW", "135i", [2008, 2010], E82, "coupe", "N54", ["6MT", "6AT"], ["RWD"]),
  c("bmw-135i-e88-n54", "BMW", "135i", [2008, 2010], E88, "convertible", "N54", ["6MT", "6AT"], ["RWD"]),
  c("bmw-135i-e82-n55", "BMW", "135i", [2011, 2013], E82, "coupe", "N55", ["6MT", "7DCT"], ["RWD"]),
  c("bmw-135i-e88-n55", "BMW", "135i", [2011, 2013], E88, "convertible", "N55", ["6MT", "7DCT"], ["RWD"]),
  // BMW 3/4/5 Series
  c("bmw-328i-e90", "BMW", "328i", [2007, 2011], E9X_S, "sedan", "N52", ["6MT", "6AT"], ["RWD", "AWD"]),
  c("bmw-328i-e92", "BMW", "328i", [2007, 2013], E92, "coupe", "N52", ["6MT", "6AT"], ["RWD", "AWD"]),
  c("bmw-328i-e93", "BMW", "328i", [2007, 2013], E93, "convertible", "N52", ["6MT", "6AT"], ["RWD"]),
  c("bmw-328i-f30", "BMW", "328i", [2012, 2016], F30, "sedan", "N20", ["6MT", "8AT"], ["RWD", "AWD"]),
  c("bmw-330i-f30", "BMW", "330i", [2017, 2018], F30, "sedan", "B46", ["6MT", "8AT"], ["RWD", "AWD"]),
  c("bmw-330i-g20", "BMW", "330i", [2019, 2024], G20, "sedan", "B46", ["8AT"], ["RWD", "AWD"]),
  c("bmw-428i-f32", "BMW", "428i", [2014, 2016], F32, "coupe", "N20", ["6MT", "8AT"], ["RWD", "AWD"]),
  c("bmw-428i-f33", "BMW", "428i", [2014, 2016], F33, "convertible", "N20", ["8AT"], ["RWD", "AWD"]),
  c("bmw-535i-e60", "BMW", "535i", [2008, 2010], E60, "sedan", "N54", ["6MT", "6AT"], ["RWD", "AWD"]),
  c("bmw-535i-f10", "BMW", "535i", [2011, 2016], F10, "sedan", "N55", ["8AT"], ["RWD", "AWD"]),
  // BMW X3 / X5
  c("bmw-x3-28i-f25-n52", "BMW", "X3", [2011, 2011], F25, "suv", "N52", ["8AT"], ["AWD"], "xDrive28i"),
  c("bmw-x3-28i-f25-n20", "BMW", "X3", [2012, 2017], F25, "suv", "N20", ["8AT"], ["AWD"], "xDrive28i"),
  c("bmw-x3-35i-f25", "BMW", "X3", [2011, 2017], F25, "suv", "N55", ["8AT"], ["AWD"], "xDrive35i"),
  c("bmw-x3-30i-g01", "BMW", "X3", [2018, 2024], G01, "suv", "B46", ["8AT"], ["AWD"], "xDrive30i"),
  c("bmw-x5-35i-e70", "BMW", "X5", [2011, 2013], E70, "suv", "N55", ["8AT"], ["AWD"], "xDrive35i"),
  c("bmw-x5-35i-f15", "BMW", "X5", [2014, 2018], F15, "suv", "N55", ["8AT"], ["RWD", "AWD"], "xDrive35i"),
  c("bmw-x5-40i-g05", "BMW", "X5", [2019, 2023], G05, "suv", "B58", ["8AT"], ["AWD"], "xDrive40i"),
  // Toyota
  c("toy-camry-xv50-i4", "Toyota", "Camry", [2012, 2017], XV50, "sedan", "2AR-FE", ["6AT"], ["FWD"]),
  c("toy-camry-xv50-v6", "Toyota", "Camry", [2012, 2017], XV50, "sedan", "2GR-FE", ["6AT"], ["FWD"]),
  c("toy-camry-xv50-hv", "Toyota", "Camry", [2012, 2017], XV50, "sedan", "2AR-FXE", ["eCVT"], ["FWD"], "Hybrid"),
  c("toy-camry-xv70-i4", "Toyota", "Camry", [2018, 2024], XV70, "sedan", "A25A-FKS", ["8AT"], ["FWD", "AWD"]),
  c("toy-camry-xv70-v6", "Toyota", "Camry", [2018, 2024], XV70, "sedan", "2GR-FKS", ["8AT"], ["FWD"]),
  c("toy-camry-xv70-hv", "Toyota", "Camry", [2018, 2024], XV70, "sedan", "A25A-FXS", ["eCVT"], ["FWD"], "Hybrid"),
  c("toy-tacoma-2-i4", "Toyota", "Tacoma", [2005, 2015], TAC2, "truck", "2TR-FE", ["5MT", "4AT"], ["RWD", "4WD"]),
  c("toy-tacoma-2-v6", "Toyota", "Tacoma", [2005, 2015], TAC2, "truck", "1GR-FE", ["6MT", "5AT"], ["RWD", "4WD"]),
  c("toy-tacoma-3-i4", "Toyota", "Tacoma", [2016, 2023], TAC3, "truck", "2TR-FKS", ["6AT"], ["RWD", "4WD"]),
  c("toy-tacoma-3-v6", "Toyota", "Tacoma", [2016, 2023], TAC3, "truck", "2GR-FKS", ["6MT", "6AT"], ["RWD", "4WD"]),
  c("toy-prius-3", "Toyota", "Prius", [2010, 2015], PRI3, "hatchback", "2ZR-FXE", ["eCVT"], ["FWD"]),
  c("toy-prius-4", "Toyota", "Prius", [2016, 2022], PRI4, "hatchback", "2ZR-FXE", ["eCVT"], ["FWD", "AWD"]),
  // Honda
  c("hon-crv-5-24", "Honda", "CR-V", [2017, 2019], CRV5, "suv", "K24W", ["CVT"], ["FWD", "AWD"], "LX"),
  c("hon-crv-5-15t", "Honda", "CR-V", [2017, 2022], CRV5, "suv", "L15B7", ["CVT"], ["FWD", "AWD"]),
  c("hon-pilot-3", "Honda", "Pilot", [2016, 2022], PIL3, "suv", "J35Y6", ["6AT", "9AT"], ["FWD", "AWD"]),
];

/** "135i Convertible" → "135i", "X3 xDrive30i" → "X3": the base model name, for grouping and matching. */
export function baseModel(model: string) {
  return model
    .replace(/\b(convertible|coupe|sedan|wagon|hatchback|hybrid)\b/gi, "")
    .replace(/\b[xs]Drive\d{2}[a-z]?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function configsFor(year: number, make: string, model: string) {
  const m = baseModel(model).toLowerCase();
  return CATALOG.filter((x) => x.make.toLowerCase() === make.toLowerCase() && x.model.toLowerCase() === m && year >= x.years[0] && year <= x.years[1]);
}

export function catalogModels(year: number, make: string) {
  return [...new Set(CATALOG.filter((x) => x.make.toLowerCase() === make.toLowerCase() && year >= x.years[0] && year <= x.years[1]).map((x) => x.model))].sort();
}

/**
 * Platform for a year + model, only when every factory configuration for it
 * shares one platform. Body-specific platforms stay unresolved without the body.
 */
export function platformFor(year: number, make: string, model: string, body?: string) {
  const all = configsFor(year, make, model).filter((x) => !body || x.body === body);
  const codes = [...new Set(all.map((x) => x.platform.code))];
  return codes.length === 1 ? all[0].platform : undefined;
}
