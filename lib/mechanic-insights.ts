import "server-only";
import type { Repository } from "@/lib/data/repository";
import { findArea, milesBetween, serves } from "@/lib/domain/areas";
import { vehicleEvidence } from "@/lib/domain/vehicle-evidence";
import { REPAIR_LABEL, repairNoun } from "@/lib/domain/provenance";
import type { PublicMechanicProfile } from "@/lib/domain/public-profile";
import type { MechanicProfile, RepairRequest } from "@/lib/domain/types";
import { today } from "@/lib/verification/lifecycle";

export interface Opportunity {
  r: RepairRequest;
  distanceMi?: number;
  makeCount: number;
  categoryCount: number;
  crossCount: number;
  modelCount: number;
  inRadius: boolean;
  reason: string;
  /** Verified experience with this exact car, most specific first. */
  vehicleReasons: string[];
  score: number[];
  state: "new" | "interested" | "draft";
}

/**
 * The mechanic's opportunity feed. Ordered by fit (service radius, vehicle
 * experience, repair experience, timing), and each
 * card says why it matched, in terms of the mechanic's own verified work.
 */
export function opportunities(repo: Repository, m: MechanicProfile, p: PublicMechanicProfile): Opportunity[] {
  const quotes = repo.listQuotesForMechanic(m.id);
  const urgency = { stranded: 4, today: 3, one_two_days: 2, this_week: 1, flexible: 0 } as const;
  return repo
    .listRequestsForMechanic(m.id)
    .filter((r) => (r.status === "open" || r.status === "quoted") && !r.declinedBy.includes(m.id) && !quotes.some((q) => q.requestId === r.id && q.status !== "draft"))
    .map((r) => {
      const v = repo.getVehicle(r.vehicleId)!;
      const area = findArea(r.location.area);
      const w = p.verifiedWork;
      const makeCount = w.filter((x) => x.make === v.make).length;
      const categoryCount = w.filter((x) => x.category === r.repairCategory).length;
      const crossCount = w.filter((x) => x.make === v.make && x.category === r.repairCategory).length;
      const modelCount = w.filter((x) => x.make === v.make && x.model === v.model).length;
      // Most specific verified experience with this exact car (platform, engine, transmission, model).
      const vehicleEv = vehicleEvidence(w, { year: v.year, make: v.make, model: v.model, spec: r.vehicleSpec ?? v.spec }, r.repairCategory);
      const specificity = vehicleEv.filter((e) => e.level !== "model").reduce((n, e) => n + e.n, 0);
      const inRadius = area ? serves(m, area) : true;
      const parts = [
        makeCount ? `${makeCount} verified ${v.make} ${makeCount === 1 ? "repair" : "repairs"}` : null,
        categoryCount ? `${categoryCount} verified ${repairNoun(r.repairCategory, categoryCount)}` : null,
      ].filter(Boolean);
      const reason = parts.length
        ? `Recommended because you have ${parts.join(" and ")}.`
        : r.rebookOf === m.id
          ? "This customer asked for you by name."
          : `Matched on ${REPAIR_LABEL[r.repairCategory].toLowerCase()} work you offer and your service area.`;
      return {
        r,
        distanceMi: area ? milesBetween(m, area) : undefined,
        makeCount,
        categoryCount,
        crossCount,
        modelCount,
        inRadius,
        reason,
        vehicleReasons: vehicleEv.slice(0, 2).map((e) => e.text),
        score: [r.rebookOf === m.id ? 1 : 0, inRadius ? 1 : 0, crossCount, specificity, makeCount + categoryCount, urgency[r.urgency ?? "flexible"]],
        state: quotes.some((q) => q.requestId === r.id && q.status === "draft") ? ("draft" as const) : r.interested.some((i) => i.mechanicId === m.id) ? ("interested" as const) : ("new" as const),
      };
    })
    .sort((a, b) => {
      for (let i = 0; i < a.score.length; i++) if (a.score[i] !== b.score[i]) return b.score[i] - a.score[i];
      return 0;
    });
}

/**
 * Earnings as job-value estimates. Clutch doesn't process payments yet, so
 * these are approved-estimate / final job amounts, never payouts.
 */
export function earnings(repo: Repository, mechanicId: string) {
  const repairs = repo.getMechanicSources(mechanicId).pastRepairs.filter((r) => r.source === "platform" && r.valueCents);
  const customers = repo.listMechanicCustomers(mechanicId);
  const repeatIds = new Set(customers.filter((c) => c.isRepeat).map((c) => c.customer.id));
  const now = today();
  const ym = (d: string) => d.slice(0, 7);
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(`${now.slice(0, 7)}-15T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - (5 - i));
    return d.toISOString().slice(0, 7);
  });
  const byMonth = months.map((m) => ({ month: m, cents: repairs.filter((r) => ym(r.performedOn) === m).reduce((s, r) => s + (r.valueCents ?? 0), 0), jobs: repairs.filter((r) => ym(r.performedOn) === m).length }));
  const total = repairs.reduce((s, r) => s + (r.valueCents ?? 0), 0);
  const repeat = repairs.filter((r) => r.customerId && repeatIds.has(r.customerId)).reduce((s, r) => s + (r.valueCents ?? 0), 0);
  const upcoming = repo
    .listJobsForMechanic(mechanicId)
    .filter((j) => j.status === "scheduled" || j.status === "in_progress" || j.status === "awaiting_customer")
    .map((j) => {
      const q = repo.getQuote(j.quoteId);
      return j.finalAmountCents ?? (q ? q.laborCents + q.diagnosticFeeCents + q.travelFeeCents : 0);
    })
    .reduce((a, b) => a + b, 0);
  return {
    total,
    jobs: repairs.length,
    average: repairs.length ? Math.round(total / repairs.length) : 0,
    thisMonth: byMonth[byMonth.length - 1].cents,
    byMonth,
    repeat,
    repeatShare: total ? Math.round((repeat / total) * 100) : 0,
    upcoming,
  };
}

/** The next reputation milestone per top category/make: "3 more BMW jobs to reach 10". */
export function milestones(p: PublicMechanicProfile) {
  const next = (n: number) => [5, 10, 25, 50, 100].find((t) => t > n) ?? n + 25;
  return [
    ...p.reputation.byCategory.slice(0, 3).map((c) => ({ label: REPAIR_LABEL[c.category], count: c.count, target: next(c.count) })),
    ...p.reputation.byMake.slice(0, 2).map((m) => ({ label: m.make, count: m.count, target: next(m.count) })),
  ];
}
