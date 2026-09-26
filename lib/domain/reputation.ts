import type { PastRepair, RepairCategory, Review, VehicleMake } from "./types";

/**
 * Reputation is always derived from evidence rows — never stored or typed in by
 * hand — so every completed Clutch job compounds automatically.
 */

export const isVerifiedRepair = (r: PastRepair) => r.source !== "self";

export interface CategoryCount {
  category: RepairCategory;
  count: number;
  platform: number;
  customer: number;
  makes: { make: VehicleMake; count: number }[];
}

export interface MakeCount {
  make: VehicleMake;
  count: number;
}

export function countByCategory(repairs: PastRepair[]): CategoryCount[] {
  const map = new Map<RepairCategory, CategoryCount>();
  for (const r of repairs.filter(isVerifiedRepair)) {
    const c = map.get(r.repairCategory) ?? { category: r.repairCategory, count: 0, platform: 0, customer: 0, makes: [] };
    c.count++;
    if (r.source === "platform") c.platform++;
    else c.customer++;
    const m = c.makes.find((x) => x.make === r.make);
    if (m) m.count++;
    else c.makes.push({ make: r.make, count: 1 });
    map.set(r.repairCategory, c);
  }
  return [...map.values()]
    .map((c) => ({ ...c, makes: c.makes.sort((a, b) => b.count - a.count) }))
    .sort((a, b) => b.count - a.count);
}

export function countByMake(repairs: PastRepair[]): MakeCount[] {
  const map = new Map<VehicleMake, number>();
  for (const r of repairs.filter(isVerifiedRepair)) map.set(r.make, (map.get(r.make) ?? 0) + 1);
  return [...map.entries()].map(([make, count]) => ({ make, count })).sort((a, b) => b.count - a.count);
}

export interface RatingSummary {
  average: number;
  count: number;
  communication: number;
  timeliness: number;
  priceAccuracy: number;
  workmanship: number;
}

/** Only reviews tied to a completed Clutch job count toward the primary rating. */
export function verifiedRating(reviews: Review[]): RatingSummary | null {
  const v = reviews.filter((r) => r.kind === "verified_job");
  if (!v.length) return null;
  const avg = (f: (r: Review) => number | undefined) => {
    const xs = v.map(f).filter((x): x is number => typeof x === "number");
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  };
  return {
    average: avg((r) => r.overall),
    count: v.length,
    communication: avg((r) => r.communication),
    timeliness: avg((r) => r.timeliness),
    priceAccuracy: avg((r) => r.priceAccuracy),
    workmanship: avg((r) => r.workmanship),
  };
}

/** A repeat customer has two or more completed Clutch jobs with this mechanic. */
export function customerRelationships(repairs: PastRepair[]) {
  const map = new Map<string, { customerId: string; jobs: PastRepair[] }>();
  for (const r of repairs) {
    if (r.source !== "platform" || !r.customerId) continue;
    const e = map.get(r.customerId) ?? { customerId: r.customerId, jobs: [] };
    e.jobs.push(r);
    map.set(r.customerId, e);
  }
  return [...map.values()].map((e) => ({
    ...e,
    jobs: e.jobs.sort((a, b) => (a.performedOn < b.performedOn ? 1 : -1)),
    isRepeat: e.jobs.length >= 2,
  }));
}

export function repeatCustomerCount(repairs: PastRepair[]) {
  return customerRelationships(repairs).filter((c) => c.isRepeat).length;
}

export interface ContextMatch {
  repair?: RepairCategory;
  make?: VehicleMake;
  categoryCount: number;
  makeCount: number;
  crossCount: number;
  /** The verified repairs that match both (or whichever was given). */
  entries: PastRepair[];
}

export function matchContext(repairs: PastRepair[], repair?: RepairCategory, make?: VehicleMake): ContextMatch | null {
  if (!repair && !make) return null;
  const v = repairs.filter(isVerifiedRepair);
  const categoryCount = repair ? v.filter((r) => r.repairCategory === repair).length : 0;
  const makeCount = make ? v.filter((r) => r.make === make).length : 0;
  const entries = v
    .filter((r) => (!repair || r.repairCategory === repair) && (!make || r.make === make))
    .sort((a, b) => (a.performedOn < b.performedOn ? 1 : -1));
  return { repair, make, categoryCount, makeCount, crossCount: repair && make ? entries.length : 0, entries };
}

/**
 * Ordering for search results: relevant verified experience first. This is a
 * sort key only — it is never shown, and price is deliberately not an input.
 */
export function relevanceKey(repairs: PastRepair[], repair?: RepairCategory, make?: VehicleMake): number[] {
  const m = matchContext(repairs, repair, make);
  const total = repairs.filter(isVerifiedRepair).length;
  return [m?.crossCount ?? 0, m?.categoryCount ?? 0, m?.makeCount ?? 0, total];
}
