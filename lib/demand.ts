import "server-only";
import type { Repository } from "@/lib/data/repository";
import type { RepairCategory, RepairRequest } from "@/lib/domain/types";
import { findArea } from "@/lib/domain/areas";
import { REPAIR_LABEL } from "@/lib/domain/provenance";
import { isWaitingForMatch } from "@/lib/domain/status";
import { supply } from "@/lib/supply";

export type DemandStatus = "waiting" | "all_declined" | "no_reply";
export const DEMAND_STATUS_LABEL: Record<DemandStatus, string> = {
  waiting: "No mechanic fits",
  all_declined: "Every mechanic declined",
  no_reply: "Sent, no reply yet",
};

export interface DemandRow {
  id: string;
  area: string;
  areaKey?: string;
  category: RepairCategory;
  categoryLabel: string;
  vehicle: string;
  make: string;
  ageDays: number;
  status: DemandStatus;
}

/**
 * Requests in this scope that no mechanic has picked up: never matched, turned down by
 * everyone it went to, or sent with no reply yet. No customer names, contact or
 * addresses; staff only need what to recruit for.
 */
/** Open requests the demand view looks at, oldest first. Bounded: the page says when there are more. */
export const DEMAND_LIMIT = 500;

export async function unmatchedDemand(repo: Repository, now = new Date()) {
  const rows: DemandRow[] = [];
  const open = repo
    .listAllRequests()
    .filter((r) => r.status === "open" || r.status === "quoted")
    .reverse();
  const truncated = open.length > DEMAND_LIMIT;
  for (const r of open.slice(0, DEMAND_LIMIT)) {
    const status = demandStatus(repo, r);
    if (!status) continue;
    const v = repo.getVehicle(r.vehicleId);
    const area = findArea(r.location.area);
    rows.push({
      id: r.id,
      area: area?.label ?? "Area not set",
      areaKey: area?.key,
      category: r.repairCategory,
      categoryLabel: REPAIR_LABEL[r.repairCategory],
      vehicle: v ? `${v.year} ${v.make} ${v.model}` : "Vehicle not found",
      make: v?.make ?? "Unknown",
      ageDays: Math.max(0, Math.floor((now.getTime() - new Date(r.createdAt).getTime()) / 86_400_000)),
      status,
    });
  }
  rows.sort((a, b) => b.ageDays - a.ageDays);
  const count = <K extends string>(key: (r: DemandRow) => K) => {
    const m = new Map<K, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  };
  return {
    rows,
    byArea: count((r) => r.area),
    byCategory: count((r) => r.categoryLabel),
    byMake: count((r) => r.make),
    byStatus: count((r) => DEMAND_STATUS_LABEL[r.status]),
    /** Area × repair pairs, the most useful recruiting target. */
    byAreaAndRepair: count((r) => `${r.categoryLabel} · ${r.area}`),
    supply: await supply(repo),
    /** More open requests exist than were looked at (the oldest DEMAND_LIMIT were). */
    truncated,
  };
}

function demandStatus(repo: Repository, r: RepairRequest): DemandStatus | null {
  if (r.status !== "open" && r.status !== "quoted") return null;
  if (isWaitingForMatch(r)) return "waiting";
  const quotes = repo.listQuotesForRequest(r.id).filter((q) => q.status === "submitted" || q.status === "accepted");
  if (quotes.length || r.interested.length) return null;
  const active = r.matchedMechanicIds.filter((m) => !r.declinedBy.includes(m));
  return active.length ? "no_reply" : "all_declined";
}
