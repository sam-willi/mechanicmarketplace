import "server-only";
import type { Repository } from "@/lib/data/repository";
import { findArea, milesBetween, serves } from "@/lib/domain/areas";
import { daysUntil, soonest } from "@/lib/domain/availability";
import { eligibility } from "@/lib/domain/eligibility";
import { contextLabel, dominantReason, fitReasons, isStrongFit, type FitInput } from "@/lib/domain/recommend";
import type { PublicMechanicProfile } from "@/lib/domain/public-profile";
import type { ID, Quote, RepairRequest } from "@/lib/domain/types";
import { needsNewMechanic } from "@/lib/domain/status";
import { DECLINE_REASON_TEXT } from "@/lib/domain/decline";

export type Suggestion = {
  fit: FitInput;
  strong: boolean;
  dominant: ReturnType<typeof dominantReason>;
  reasons: string[];
};

export type Replacement = {
  /** Who couldn't take it, and what they said. */
  lost: { mechanicId: ID; name: string; firstName: string; reason: string | null; cancelledJob: boolean; at: string };
  /** Estimates the customer already has that are live again. */
  openQuotes: { q: Quote; p: PublicMechanicProfile }[];
  suggestions: Suggestion[];
  /** Qualified mechanics who haven't seen it yet, for "send it to more mechanics". */
  broaden: ID[];
  context: string;
};

const tier = (n: number) => (n >= 10 ? 3 : n >= 3 ? 2 : n >= 1 ? 1 : 0);
const BROADEN_LIMIT = 4;

/**
 * Does this request need a new mechanic? Yes when the one the customer picked
 * declined or cancelled, or when everyone it went to declined — and the
 * customer hasn't already sent it on since.
 */
export async function replacementFor(repo: Repository, r: RepairRequest): Promise<Replacement | null> {
  const quotes = repo.listQuotesForRequest(r.id);
  if (!needsNewMechanic(r, quotes)) return null;
  // Candidates and the numbers to rank them (targeted live mode reads no repair documents here); see Repository.searchPool.
  const v0 = repo.getVehicle(r.vehicleId)!;
  const pool = await repo.searchPool({ repair: r.repairCategory, make: v0.make, model: v0.model });
  const last = r.declines!.at(-1)!;

  const v = repo.getVehicle(r.vehicleId)!;
  const who = repo.getMechanic(last.mechanicId);
  const area = findArea(r.location.area);
  const model = v.model.toLowerCase();
  const ctx = {
    repair: r.repairCategory,
    make: v.make,
    model: v.model,
    vehicle: { year: v.year, make: v.make, model: v.model, spec: r.vehicleSpec ?? v.spec },
  };

  const rows = pool.profiles
    .filter((p) => !r.matchedMechanicIds.includes(p.id) && !r.declinedBy.includes(p.id))
    .map((p) => {
      const m = repo.getMechanic(p.id)!;
      const w = p.verifiedWork;
      const given = pool.counts?.get(p.id);
      const fit: FitInput = {
        p,
        cross: given?.cross ?? w.filter((x) => x.category === r.repairCategory && x.make === v.make).length,
        cat: given?.cat ?? w.filter((x) => x.category === r.repairCategory).length,
        mk: given?.mk ?? w.filter((x) => x.make === v.make).length,
        mdl: given?.mdl ?? w.filter((x) => x.make === v.make && x.model.toLowerCase().includes(model)).length,
        miles: area ? milesBetween(m, area) : undefined,
      };
      const o = soonest(p.openings);
      const days = o ? Math.max(0, daysUntil(o.on)) : 99;
      const reachable = (!area || serves(m, area)) && eligibility(p).eligible;
      return { fit, days, reachable, verified: eligibility(p).fullyVerified, declared: m.declaredRepairCategories.includes(r.repairCategory) };
    })
    .filter((x) => x.reachable);

  // Rank as search does (verified experience first, price never), leaning on what the
  // first mechanic said: booked up → who can come soon; too far → who is close.
  const lean = (x: (typeof rows)[number]) =>
    last.reason === "booked_up" ? (x.days <= 3 ? 1 : 0) : last.reason === "too_far" ? ((x.fit.miles ?? 0) <= 6 ? 1 : 0) : 0;
  const key = (x: (typeof rows)[number]) => [
    tier(x.fit.cross),
    lean(x),
    tier(x.fit.mdl),
    tier(x.fit.mk),
    tier(x.fit.cat),
    // Full verification: a trust advantage at equal experience, never an exclusion.
    x.verified ? 1 : 0,
    -Math.round(x.fit.miles ?? 0),
    -x.days,
    x.fit.p.reputation.rating?.average ?? 0,
  ];
  rows.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return 0;
  });

  const strong = rows.filter((x) => isStrongFit(x.fit, ctx));
  // Without strong fits, offer the closest relevant ones — clearly labelled, never dressed up.
  const shown = (strong.length ? strong : rows.filter((x) => x.fit.cat > 0 || x.fit.mk > 0)).slice(0, 3);
  // The few shown get their full record (reasons about this exact car need the repair list).
  const full = new Map((await repo.publicProfiles(shown.map((x) => x.fit.p.id))).map((p) => [p.id, p]));
  const suggestions = shown.map((x) => {
    const fit = { ...x.fit, p: full.get(x.fit.p.id) ?? x.fit.p };
    return { fit, strong: strong.includes(x), dominant: dominantReason(fit, ctx), reasons: fitReasons(fit, ctx).slice(0, 3) };
  });
  const broaden = rows
    .filter((x) => x.fit.cat > 0 || x.fit.mk > 0 || x.declared)
    .slice(0, BROADEN_LIMIT)
    .map((x) => x.fit.p.id);

  const openQuotes = quotes
    .filter((q) => q.status === "submitted")
    .map((q) => ({ q, p: repo.getPublicProfile(repo.getMechanic(q.mechanicId)!.slug)! }))
    .filter((x) => x.p);

  return {
    lost: {
      mechanicId: last.mechanicId,
      name: who?.displayName ?? "Your mechanic",
      firstName: who?.displayName.split(" ")[0] ?? "Your mechanic",
      reason: last.reason ? DECLINE_REASON_TEXT[last.reason] : null,
      cancelledJob: Boolean(last.cancelledJob),
      at: last.at,
    },
    openQuotes,
    suggestions,
    broaden,
    context: contextLabel({ repair: r.repairCategory, make: v.make }),
  };
}
