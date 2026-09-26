import type { PublicMechanicProfile } from "./public-profile";
import { REPAIR_LABEL, repairNoun } from "./provenance";
import type { RepairCategory, VehicleMake } from "./types";
import { daysUntil, openingLabel, soonest } from "./availability";
import { eligibility, screeningItems } from "./eligibility";
import { vehicleEvidence, type TargetVehicle } from "./vehicle-evidence";

export type FitInput = {
  p: PublicMechanicProfile;
  cross: number;
  cat: number;
  mk: number;
  mdl: number;
  miles?: number;
};
type Ctx = { repair?: RepairCategory; make?: VehicleMake; model?: string; vehicle?: TargetVehicle };

/** The single strongest piece of evidence for this job, shown large. */
export function dominantReason(r: FitInput, ctx: Ctx): { n: number; text: string; exact: boolean } | null {
  if (ctx.repair && ctx.make && r.cross > 0) return { n: r.cross, text: `verified ${ctx.make} ${repairNoun(ctx.repair, r.cross)}`, exact: true };
  if (ctx.repair && r.cat > 0) return { n: r.cat, text: `verified ${repairNoun(ctx.repair, r.cat)}${ctx.make ? `, other makes` : ""}`, exact: !ctx.make };
  if (ctx.make && r.mk > 0) return { n: r.mk, text: `verified ${ctx.make} repairs`, exact: !ctx.repair };
  if (r.p.reputation.verifiedRepairs > 0) return { n: r.p.reputation.verifiedRepairs, text: "verified repairs", exact: false };
  return null;
}

/**
 * Plain-language supporting reasons, each one a fact from the record. The
 * dominant reason is excluded; at most three are shown.
 */
export function fitReasons(r: FitInput, ctx: Ctx) {
  const { p } = r;
  const out: string[] = [];
  const dom = dominantReason(r, ctx);
  // The most specific verified experience with this exact car comes first (platform, engine, transmission).
  if (ctx.vehicle) for (const e of vehicleEvidence(p.verifiedWork, ctx.vehicle, ctx.repair).filter((e) => e.level !== "model").slice(0, 2)) out.push(e.text);
  if (ctx.repair && ctx.make && r.cross > 0 && r.cat > r.cross) out.push(`${r.cat} ${repairNoun(ctx.repair, r.cat)} on any make`);
  if (ctx.model && r.mdl > 0) out.push(`${r.mdl} on a ${ctx.model}`);
  else if (ctx.make && r.mk > 0 && dom?.text !== `verified ${ctx.make} repairs`) out.push(`${r.mk} ${ctx.make} repairs in total`);
  if (p.reputation.rating && p.reputation.rating.count >= 3) out.push(`${p.reputation.rating.average.toFixed(1)} from ${p.reputation.rating.count} verified reviews`);
  if (p.reputation.repeatCustomers >= 3) out.push(`Rebooked by ${p.reputation.repeatCustomers} customers`);
  if (r.miles !== undefined && r.miles <= 6) out.push(`${r.miles < 1 ? "Under a mile" : `${r.miles.toFixed(1)} miles`} away`);
  const o = soonest(p.openings);
  if (o && daysUntil(o.on) <= 2) out.push(openingLabel(o, { prefix: true }));
  return out;
}

/** Minimum evidence to be recommended at all, including being bookable right now. */
export const STRONG_THRESHOLD = { cross: 2, cat: 5, catWithMake: 2, repairOnly: 3, makeOnly: 3, general: 10 };

export function isStrongFit(r: FitInput, ctx: Ctx) {
  const p = r.p;
  if (!eligibility(p).eligible) return false;
  const t = STRONG_THRESHOLD;
  const proof = ctx.repair && ctx.make ? r.cross >= t.cross || (r.cat >= t.cat && r.mk >= t.catWithMake) : ctx.repair ? r.cat >= t.repairOnly : ctx.make ? r.mk >= t.makeOnly : p.reputation.verifiedRepairs >= t.general;
  const rated = !p.reputation.rating || p.reputation.rating.average >= 4.5;
  return proof && rated;
}

export type PickKind = "best" | "soonest" | "both";
export type TopPick<T> = { row: T; kind: PickKind; title: string; definition: string };

export const PICK_COPY: Record<PickKind, { title: string; definition: (c: string) => string }> = {
  best: { title: "Best Fit", definition: (c) => `Most verified experience with ${c || "this job"}.` },
  soonest: { title: "Soonest Strong Fit", definition: (c) => `The earliest opening among mechanics with strong verified ${c || "relevant"} experience.` },
  both: { title: "Best Fit · soonest available", definition: (c) => `Most verified experience with ${c || "this job"}, and no strong fit can come sooner.` },
};

const when = (p: PublicMechanicProfile) => {
  const o = soonest(p.openings);
  return o ? `${o.on}${o.time.padStart(8, "0")}` : "9999";
};

/**
 * Two separately defined picks. Best Fit = the first-ranked strong mechanic
 * (ranked by exact-match, then related, then make experience). Soonest Strong
 * Fit = among strong mechanics, the earliest opening. Same person → one pick.
 */
export function topPicks<T extends FitInput>(ranked: T[], ctx: Ctx): TopPick<T>[] {
  const strong = ranked.filter((r) => isStrongFit(r, ctx));
  if (!strong.length) return [];
  const best = strong[0];
  const soon = [...strong].sort((a, b) => (when(a.p) < when(b.p) ? -1 : when(a.p) > when(b.p) ? 1 : 0))[0];
  const c = contextLabel(ctx);
  const mk = (row: T, kind: PickKind): TopPick<T> => ({ row, kind, title: PICK_COPY[kind].title, definition: PICK_COPY[kind].definition(c) });
  if (soon === best || when(soon.p) === when(best.p)) return [mk(best, "both")];
  return [mk(best, "best"), mk(soon, "soonest")];
}

/**
 * The honest tradeoff between two different picks, comparing the same measure
 * for both: "Derek has more verified BMW brake jobs (6 vs 2). Jess can come
 * sooner (Tomorrow · 7:30 AM vs Sun, Sep 27)."
 */
export function tradeoff<T extends FitInput>(picks: TopPick<T>[], ctx: Ctx): string | null {
  if (picks.length < 2) return null;
  const [b, s] = [picks[0].row, picks[1].row];
  const oB = soonest(b.p.openings);
  const oS = soonest(s.p.openings);
  if (!oS) return null;
  const measures: { name: string; get: (r: FitInput) => number }[] = [
    ...(ctx.repair && ctx.make ? [{ name: `verified ${ctx.make} ${repairNoun(ctx.repair, 2)}`, get: (r: FitInput) => r.cross }] : []),
    ...(ctx.repair ? [{ name: `verified ${repairNoun(ctx.repair, 2)}`, get: (r: FitInput) => r.cat }] : []),
    ...(ctx.make ? [{ name: `verified ${ctx.make} repairs`, get: (r: FitInput) => r.mk }] : []),
    { name: "verified repairs", get: (r: FitInput) => r.p.reputation.verifiedRepairs },
  ];
  const m = measures.find((x) => x.get(b) !== x.get(s));
  const proof = m
    ? m.get(b) > m.get(s)
      ? `${b.p.firstName} has more ${m.name} (${m.get(b)} vs ${m.get(s)}).`
      : `${b.p.firstName} ranks first on the closest match to this job, though ${s.p.firstName} has more ${m.name} (${m.get(s)} vs ${m.get(b)}).`
    : `${b.p.firstName} and ${s.p.firstName} have the same verified experience for this job.`;
  return `${proof} ${s.p.firstName} can come sooner (${openingLabel(oS)}${oB ? ` vs ${openingLabel(oB)}` : ""}).`;
}

/** The ranking factors, in order, for the "Why this recommendation?" disclosure. */
export function rankingFactors(r: FitInput, ctx: Ctx) {
  const f: { label: string; value: string }[] = [];
  if (ctx.repair && ctx.make) f.push({ label: `Verified ${ctx.make} ${repairNoun(ctx.repair, 2)} (exact match)`, value: String(r.cross) });
  if (ctx.model) f.push({ label: `Verified repairs on a ${ctx.model}`, value: String(r.mdl) });
  if (ctx.make) f.push({ label: `Verified ${ctx.make} repairs`, value: String(r.mk) });
  if (ctx.repair) f.push({ label: `Verified ${repairNoun(ctx.repair, 2)}, any make`, value: String(r.cat) });
  f.push({ label: "Distance", value: r.miles !== undefined ? `${r.miles.toFixed(1)} mi` : "Not set" });
  const o = soonest(r.p.openings);
  f.push({ label: "Earliest opening", value: o ? openingLabel(o) : "Not posted" });
  f.push({ label: "Verified rating", value: r.p.reputation.rating ? `${r.p.reputation.rating.average.toFixed(1)} (${r.p.reputation.rating.count})` : "None yet" });
  const checks = screeningItems(r.p);
  f.push({ label: "Checks Clutch verified", value: `${checks.filter((c) => c.verified).length} of ${checks.length}` });
  return f;
}

export function contextLabel(ctx: Ctx) {
  return [ctx.make, ctx.model, ctx.repair ? REPAIR_LABEL[ctx.repair].toLowerCase() : null].filter(Boolean).join(" ");
}
