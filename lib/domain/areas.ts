/**
 * Launch-market areas (Los Angeles) with approximate centre points. Stands in
 * for real geocoding in the MVP; distances are straight-line miles.
 */
export const AREAS = [
  { key: "mid-city", label: "Mid-City", lat: 34.05, lng: -118.35 },
  { key: "koreatown", label: "Koreatown", lat: 34.06, lng: -118.3 },
  { key: "hollywood", label: "Hollywood", lat: 34.1, lng: -118.33 },
  { key: "silver-lake", label: "Silver Lake", lat: 34.087, lng: -118.27 },
  { key: "echo-park", label: "Echo Park", lat: 34.078, lng: -118.26 },
  { key: "downtown", label: "Downtown LA", lat: 34.045, lng: -118.25 },
  { key: "boyle-heights", label: "Boyle Heights", lat: 34.03, lng: -118.21 },
  { key: "glendale", label: "Glendale", lat: 34.14, lng: -118.25 },
  { key: "burbank", label: "Burbank", lat: 34.18, lng: -118.31 },
  { key: "pasadena", label: "Pasadena", lat: 34.15, lng: -118.14 },
  { key: "alhambra", label: "Alhambra", lat: 34.09, lng: -118.13 },
  { key: "sherman-oaks", label: "Sherman Oaks", lat: 34.15, lng: -118.45 },
  { key: "santa-monica", label: "Santa Monica", lat: 34.02, lng: -118.49 },
  { key: "venice", label: "Venice", lat: 33.99, lng: -118.46 },
  { key: "culver-city", label: "Culver City", lat: 34.02, lng: -118.4 },
  { key: "inglewood", label: "Inglewood", lat: 33.96, lng: -118.35 },
  { key: "torrance", label: "Torrance", lat: 33.83, lng: -118.34 },
  { key: "long-beach", label: "Long Beach", lat: 33.77, lng: -118.19 },
] as const;

export type AreaKey = (typeof AREAS)[number]["key"];

export function findArea(key?: string) {
  return AREAS.find((a) => a.key === key);
}

export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Does this mechanic serve that point? Mobile/both use their radius; shop-only allows a 20 mi drive. */
export function serves(m: { lat: number; lng: number; serviceRadiusMi: number; workModel: string }, at: { lat: number; lng: number }) {
  const d = milesBetween(m, at);
  return m.workModel === "shop" ? d <= 20 : d <= m.serviceRadiusMi + 2;
}
