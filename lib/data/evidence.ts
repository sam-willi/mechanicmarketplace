import type { DB } from "./mock/seed";

/**
 * Verified-repair counts per mechanic (per "repair type|make" pair, and in total), attached to a
 * write's working set when the store read the numbers instead of the repair documents (targeted
 * live matching, lib/data/normalized/plans.ts). The matching rule prefers these when present and
 * otherwise counts the repairs it holds; both give the same answer.
 */
export interface VerifiedCounts {
  pairs: Map<string, number>;
  total: number;
}

const byDb = new WeakMap<DB, Map<string, VerifiedCounts>>();

export function attachCounts(db: DB, counts: Map<string, VerifiedCounts>) {
  const had = byDb.get(db);
  if (!had) byDb.set(db, counts);
  else for (const [k, v] of counts) had.set(k, v);
}

export function countsFor(db: DB, mechanicId: string): VerifiedCounts | undefined {
  return byDb.get(db)?.get(mechanicId);
}
