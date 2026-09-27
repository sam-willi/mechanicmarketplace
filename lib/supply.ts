import "server-only";
import type { Repository } from "@/lib/data/repository";

/**
 * How much real supply this marketplace has right now. Drives honest copy when
 * there's none: Clutch never shows placeholder mechanics or invented rankings.
 * Counted (bookable mechanics are read by the indexed candidate query), never listed.
 */
export async function supply(repo: Repository) {
  const { profiles, bookable } = await repo.supplyCounts();
  return { profiles, bookable, none: bookable === 0 };
}
