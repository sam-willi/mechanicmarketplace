import { catalogModels } from "./catalog";

/**
 * Recorded-shape vPIC responses for tests and the isolated browser run (CLUTCH_VEHICLE_DATA=fixtures).
 * The adapter parses these exactly as it parses the live API. The VINs are FICTIONAL test values
 * (not real cars); anything not listed fails like an outage would, so fallbacks get exercised too.
 */
const MODELS_EXTRA: Record<string, string[]> = {
  "2008:BMW": ["128i", "135i", "328i", "335i", "528i", "535i", "M3", "X3", "X5", "Z4"],
  "2016:BMW": ["228i", "328i", "340i", "428i", "535i", "M3", "X1", "X3", "X5"],
  "2017:BMW": ["230i", "320i", "330i", "340i", "430i", "530i", "M3", "X1", "X3", "X5"],
};

type Vpic = Record<string, string>;
const vin = (v: Vpic) => ({ Count: 1, Message: "Results returned successfully", Results: [{ ErrorCode: "0", ErrorText: "0 - VIN decoded clean.", ...v }] });

export const FIXTURE_VINS: Record<string, ReturnType<typeof vin>> = {
  // 2008 BMW 135i coupe, manual (fictional VIN).
  WBAUC73508VF00135: vin({ ModelYear: "2008", Make: "BMW", Model: "135i", Series: "135i", BodyClass: "Coupe", Doors: "2", DisplacementL: "3.0", EngineCylinders: "6", EngineConfiguration: "In-Line", EngineModel: "N54", Turbo: "Yes", FuelTypePrimary: "Gasoline", DriveType: "RWD/Rear-Wheel Drive", TransmissionStyle: "Manual/Standard", TransmissionSpeeds: "6", PlantCountry: "GERMANY" }),
  // 2017 BMW 330i sedan (fictional VIN).
  WBA8B9G50HNU00330: vin({ ModelYear: "2017", Make: "BMW", Model: "330i", Series: "330i", BodyClass: "Sedan/Saloon", Doors: "4", DisplacementL: "2.0", EngineCylinders: "4", EngineConfiguration: "In-Line", EngineModel: "B46", Turbo: "Yes", FuelTypePrimary: "Gasoline", DriveType: "RWD/Rear-Wheel Drive", TransmissionStyle: "Automatic", TransmissionSpeeds: "8", PlantCountry: "GERMANY" }),
  // 2008 BMW 128i coupe: disagrees with a customer who picked a 135i (fictional VIN).
  WBAUP93558VF00128: vin({ ModelYear: "2008", Make: "BMW", Model: "128i", Series: "128i", BodyClass: "Coupe", Doors: "2", DisplacementL: "3.0", EngineCylinders: "6", EngineConfiguration: "In-Line", EngineModel: "N51", FuelTypePrimary: "Gasoline", DriveType: "RWD/Rear-Wheel Drive", TransmissionStyle: "Automatic", TransmissionSpeeds: "6", PlantCountry: "GERMANY" }),
};

export const fixtureFetch = async (url: string): Promise<unknown> => {
  const m = /GetModelsForMakeYear\/make\/([^/]+)\/modelyear\/(\d{4})\/vehicletype\/(\w+)/.exec(url);
  if (m) {
    const make = decodeURIComponent(m[1]);
    const year = Number(m[2]);
    if (m[3] !== "car") return { Count: 0, Results: [] };
    const names = [...new Set([...(MODELS_EXTRA[`${year}:${make}`] ?? []), ...catalogModels(year, make)])];
    if (!names.length) throw new Error("fixture: no model data for this make and year (behaves like an outage)");
    return { Count: names.length, Results: names.map((n) => ({ Make_Name: make.toUpperCase(), Model_Name: n })) };
  }
  const v = /DecodeVinValues\/([A-HJ-NPR-Z0-9]{17})/.exec(url);
  if (v) {
    const hit = FIXTURE_VINS[v[1]];
    if (hit) return hit;
    return { Count: 1, Results: [{ ErrorCode: "11", ErrorText: "11 - Incorrect Model Year, decoded data may not be accurate", ModelYear: "", Make: "" }] };
  }
  throw new Error("fixture: unknown vPIC request");
};
