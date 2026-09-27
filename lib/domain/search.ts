import type { PublicMechanicProfile } from "./public-profile";
import type { MechanicProfile, RepairCategory, VehicleMake } from "./types";
import { findArea, milesBetween, serves } from "./areas";
import { daysUntil, soonest } from "./availability";
import { eligibility, type ScreeningKey } from "./eligibility";
import { fitReasons, dominantReason, rankingFactors, topPicks } from "./recommend";
import { today } from "@/lib/verification/lifecycle";

/**
 * Find-a-mechanic ranking, as one pure function over profiles. The search page renders
 * its result; the database tests run it on the targeted candidate pool and on the whole
 * store and require the same order, picks and explanations.
 *
 * Order: relevant verified experience → vehicle experience → repair experience → full
 * verification → distance → availability → reputation → price (last). Never cheapest-first.
 * Every bookable mechanic is included unless the customer filters on verification.
 */
export type SearchInput = {
  repair?: RepairCategory;
  make?: VehicleMake;
  model?: string;
  area?: ReturnType<typeof findArea>;
  within?: number;
  maxMi?: number;
  lang?: string;
  /** Only mechanics with every applicable check verified. */
  verifiedOnly?: boolean;
  /** Only mechanics with these checks verified (a driving record counts only where it applies). */
  checks?: ScreeningKey[];
};

/** Verified-repair counts for one search context: exact match, repair type, make, model. */
export type EvidenceCounts = { cross: number; cat: number; mk: number; mdl: number };

/**
 * Candidates to rank. Profiles may be lightweight (no repair list: `verifiedWork` empty, with
 * reputation totals filled in) when `counts` carries the numbers ranking needs.
 */
export interface SearchPool {
  profiles: PublicMechanicProfile[];
  counts?: Map<string, EvidenceCounts>;
}

export type SearchFilters = Pick<SearchInput, "area" | "maxMi" | "within" | "lang" | "verifiedOnly" | "checks">;

/** Experience tiers, so a mechanic with 18 vs 17 jobs doesn't outrank on noise alone. */
const tier = (n: number) => (n >= 10 ? 3 : n >= 3 ? 2 : n >= 1 ? 1 : 0);

export function rankSearch(profiles: PublicMechanicProfile[], mechanicOf: (id: string) => MechanicProfile, input: SearchInput, day = today(), counts?: Map<string, EvidenceCounts>) {
  const { repair, make, model } = input;
  const modelMatch = (m: string) => Boolean(model && m.toLowerCase().includes(model.toLowerCase()));
  const countsOf = (p: PublicMechanicProfile): EvidenceCounts => {
    const given = counts?.get(p.id);
    if (given) return given;
    const w = p.verifiedWork;
    return {
      cross: repair && make ? w.filter((x) => x.category === repair && x.make === make).length : 0,
      cat: repair ? w.filter((x) => x.category === repair).length : 0,
      mk: make ? w.filter((x) => x.make === make).length : 0,
      mdl: model ? w.filter((x) => (!make || x.make === make) && modelMatch(x.model)).length : 0,
    };
  };
  const t0 = new Date(day).getTime();
  const evaluate = (f: SearchFilters) =>
    profiles.map((p) => {
      const mech = mechanicOf(p.id);
      const { cross, cat, mk, mdl } = countsOf(p);
      const next = soonest(p.openings);
      const days = next ? Math.max(0, daysUntil(next.on, day)) : Math.max(0, Math.round((new Date(mech.nextAvailableOn).getTime() - t0) / 86_400_000));
      const miles = f.area ? milesBetween(mech, f.area) : undefined;
      // Where, how and who: hard filters. When: a filter too, but a near miss is still worth showing.
      const place =
        (f.area ? serves(mech, f.area) : true) &&
        (!f.maxMi || (miles ?? 0) <= f.maxMi) &&
        (!f.lang || p.languages.includes(f.lang));
      const onTime = !f.within || days <= f.within;
      const e = eligibility(p);
      const bookable = e.eligible;
      const fullyVerified = e.fullyVerified;
      // Verification filters are the customer's choice; by default nobody is hidden for missing checks.
      const checked = (!f.verifiedOnly || fullyVerified) && (f.checks ?? []).every((k) => e.checks.find((c) => c.key === k)?.verified ?? k === "driving_record");
      // Relevant verified experience first; then full verification (a trust advantage, never an exclusion).
      const key = [tier(cross), tier(mdl), tier(mk), tier(cat), fullyVerified ? 1 : 0, -Math.round(miles ?? 0), -days, p.reputation.rating?.average ?? 0, -p.pricing.hourlyRateCents];
      return { p, cross, cat, mk, mdl, days, miles, place: place && checked, onTime, bookable, fullyVerified, key };
    });
  const filters: SearchFilters = { area: input.area, maxMi: input.maxMi, within: input.within, lang: input.lang, verifiedOnly: input.verifiedOnly, checks: input.checks };
  const rows = evaluate(filters);
  rows.sort((a, b) => {
    for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return b.key[i] - a.key[i];
    return 0;
  });
  const open = rows.filter((r) => r.place && r.onTime && r.bookable);
  const relevant = open.filter((r) => (!repair || r.cat > 0) && (!make || r.mk > 0));
  const others = open.filter((r) => !relevant.includes(r));
  const setAside = rows.filter((r) => r.place && (!r.bookable || !r.onTime));
  const hasCtx = Boolean(repair || make);
  const picks = hasCtx ? topPicks(relevant, { repair, make }) : [];
  const rest = [...relevant.filter((r) => !picks.some((t) => t.row === r)), ...others];
  return {
    filters,
    rows,
    open,
    relevant,
    others,
    setAside,
    picks,
    rest,
    /** How many would be open with these filters instead (for "remove this filter"). */
    openCount: (f: SearchFilters) => evaluate(f).filter((r) => r.place && r.onTime && r.bookable).length,
    bookableTotal: profiles.filter((p) => eligibility(p).eligible).length,
    fullyVerifiedTotal: profiles.filter((p) => eligibility(p).eligible && eligibility(p).fullyVerified).length,
    languages: [...new Set(profiles.flatMap((p) => p.languages))].sort(),
  };
}

export type SearchRow = ReturnType<typeof rankSearch>["rows"][number];

/** Everything a customer is told about the result, as plain data: order, picks and the reasons given. For comparing read paths. */
export function explainSearch(r: ReturnType<typeof rankSearch>, input: SearchInput) {
  const ctx = { repair: input.repair, make: input.make, model: input.model };
  const why = (row: SearchRow) => ({ id: row.p.id, dominant: dominantReason(row, ctx), reasons: fitReasons(row, ctx), factors: rankingFactors(row, ctx), checks: eligibility(row.p).checks.map((c) => c.label) });
  return {
    picks: r.picks.map((t) => ({ kind: t.kind, title: t.title, definition: t.definition, ...why(t.row) })),
    rest: r.rest.map(why),
    open: r.open.map((x) => x.p.id),
    bookableTotal: r.bookableTotal,
  };
}
