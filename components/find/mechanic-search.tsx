import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { repo } from "@/lib/data";
import { REPAIR_LABEL } from "@/lib/domain/provenance";
import { AREAS, findArea, milesBetween, serves } from "@/lib/domain/areas";
import { daysUntil, soonest } from "@/lib/domain/availability";
import { eligibility } from "@/lib/domain/eligibility";
import { contextLabel, topPicks } from "@/lib/domain/recommend";
import { REPAIR_CATEGORIES, VEHICLE_MAKES, type RepairCategory, type Vehicle, type VehicleMake } from "@/lib/domain/types";
import { today } from "@/lib/verification/lifecycle";
import { MechanicCard, RecommendationCard, UnbookableCard } from "./mechanic-card";
import { SearchBar } from "./search-bar";

export type SearchParams = {
  repair?: string;
  make?: string;
  area?: string;
  model?: string;
  mode?: string;
  within?: string;
  vehicle?: string;
  year?: string;
  maxMi?: string;
  lang?: string;
};

/** Experience tiers, so a mechanic with 18 vs 17 jobs doesn't outrank on noise alone. */
const tier = (n: number) => (n >= 10 ? 3 : n >= 3 ? 2 : n >= 1 ? 1 : 0);

/**
 * Find a mechanic. Shared by the public /mechanics page and the customer app.
 * Order: relevant verified experience → vehicle experience → repair experience →
 * distance → availability → reputation → price (last). Never cheapest-first.
 * Only bookable mechanics are offered an estimate; everyone else is set aside.
 */
export function MechanicSearch({ sp, action, vehicles = [] }: { sp: SearchParams; action: string; vehicles?: Vehicle[]; savedIds?: string[] }) {
  const pickedVehicle = vehicles.find((v) => v.id === sp.vehicle);
  const repair = REPAIR_CATEGORIES.includes(sp.repair as RepairCategory) ? (sp.repair as RepairCategory) : undefined;
  const make = (pickedVehicle?.make ?? VEHICLE_MAKES.find((m) => m === sp.make)) as VehicleMake | undefined;
  const model = pickedVehicle?.model ?? (sp.model?.trim() || undefined);
  const area = findArea(sp.area);
  const mode = sp.mode === "mobile" || sp.mode === "shop" ? sp.mode : undefined;
  const within = sp.within === "3" || sp.within === "7" ? Number(sp.within) : undefined;
  const maxMi = area && ["5", "10", "15"].includes(sp.maxMi ?? "") ? Number(sp.maxMi) : undefined;
  const lang = sp.lang?.trim() || undefined;
  const modelMatch = (m: string) => Boolean(model && m.toLowerCase().includes(model.toLowerCase()));

  const profiles = repo.listPublicProfiles();
  const t0 = new Date(today()).getTime();
  const rows = profiles.map((p) => {
    const mech = repo.getMechanic(p.id)!;
    const w = p.verifiedWork;
    const cross = repair && make ? w.filter((x) => x.category === repair && x.make === make).length : 0;
    const cat = repair ? w.filter((x) => x.category === repair).length : 0;
    const mk = make ? w.filter((x) => x.make === make).length : 0;
    const mdl = model ? w.filter((x) => (!make || x.make === make) && modelMatch(x.model)).length : 0;
    const next = soonest(p.openings);
    const days = next ? Math.max(0, daysUntil(next.on)) : Math.max(0, Math.round((new Date(mech.nextAvailableOn).getTime() - t0) / 86_400_000));
    const miles = area ? milesBetween(mech, area) : undefined;
    // Where, how and who: hard filters. When: a filter too, but a near miss is still worth showing.
    const place =
      (area ? serves(mech, area) : true) &&
      (!maxMi || (miles ?? 0) <= maxMi) &&
      (!mode || (mode === "mobile" ? mech.workModel !== "shop" : mech.workModel !== "mobile")) &&
      (!lang || p.languages.includes(lang));
    const onTime = !within || days <= within;
    const bookable = eligibility(p).eligible;
    const key = [tier(cross), tier(mdl), tier(mk), tier(cat), -Math.round(miles ?? 0), -days, p.reputation.rating?.average ?? 0, -p.pricing.hourlyRateCents];
    return { p, cross, cat, mk, mdl, days, miles, place, onTime, bookable, key };
  });
  rows.sort((a, b) => {
    for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return b.key[i] - a.key[i];
    return 0;
  });
  const open = rows.filter((r) => r.place && r.onTime && r.bookable);
  const relevant = open.filter((r) => (!repair || r.cat > 0) && (!make || r.mk > 0));
  const others = open.filter((r) => !relevant.includes(r));
  const setAside = rows.filter((r) => r.place && (!r.bookable || !r.onTime));
  const hasCtx = Boolean(repair || make);
  const ctxObj = { repair, make, model };
  const picks = hasCtx ? topPicks(relevant, { repair, make }) : [];
  const rest = [...relevant.filter((r) => !picks.some((t) => t.row === r)), ...others];

  const heading = [make, model, repair ? REPAIR_LABEL[repair].toLowerCase() : null].filter(Boolean).join(" ");
  const ctx = new URLSearchParams({ ...(repair ? { repair } : {}), ...(make ? { make } : {}) }).toString();
  const quoteHref = (slug: string) => `/customer/requests/new?${new URLSearchParams({ mechanic: slug, ...(repair ? { repair } : {}), ...(make ? { make } : {}) })}`;
  const card = (r: (typeof rows)[number]) => ({ fit: r, ctx: ctxObj, profileHref: `/mechanics/${r.p.slug}${ctx ? `?${ctx}` : ""}`, quoteHref: quoteHref(r.p.slug) });
  const languages = [...new Set(profiles.flatMap((p) => p.languages))].sort();

  return (
    <div>
      <h1 className="display text-[2rem] sm:text-[2.5rem]">{heading ? `Mechanics for ${heading}` : "Find a mechanic"}</h1>
      <p className="mt-1.5 text-ink-2">Ranked by verified experience with your job, never by price.</p>

      <div className="mt-5">
        <SearchBar
          action={action}
          initial={{
            vehicle: pickedVehicle?.id,
            year: pickedVehicle ? undefined : sp.year,
            make: pickedVehicle ? undefined : make,
            model: pickedVehicle ? undefined : model,
            repair,
            area: area?.key,
            mode,
            within: within ? String(within) : undefined,
            maxMi: maxMi ? String(maxMi) : undefined,
            lang,
          }}
          vehicles={vehicles.map((v) => ({ id: v.id, label: `${v.year} ${v.make} ${v.model}` }))}
          makes={[...VEHICLE_MAKES]}
          repairs={REPAIR_CATEGORIES.map((c) => ({ id: c, label: REPAIR_LABEL[c] }))}
          areas={AREAS.map((a) => ({ id: a.key, label: a.label }))}
          languages={languages}
        />
      </div>

      {picks.length > 0 && (
        <section aria-labelledby="picks-title" className="mt-8">
          <h2 id="picks-title" className="heading text-[1.25rem]">
            Recommended
          </h2>
          <ul className={`mt-3 grid grid-cols-1 gap-4 ${picks.length > 1 ? "lg:grid-cols-2" : "max-w-[40rem]"}`}>
            {picks.map((t) => (
              <RecommendationCard key={t.row.p.id} {...card(t.row)} kind={t.kind} title={t.title} definition={t.definition} />
            ))}
          </ul>
        </section>
      )}

      {rest.length > 0 && (
        <section aria-labelledby="rest-title" className="mt-10">
          <h2 id="rest-title" className="heading text-[1.25rem]">
            {picks.length ? "More mechanics" : hasCtx && relevant.length ? `With ${contextLabel({ repair, make })} experience` : "Mechanics near you"}
          </h2>
          <ul className="mt-3 grid grid-cols-1 gap-3">
            {rest.map((r) => (
              <MechanicCard key={r.p.id} {...card(r)} />
            ))}
          </ul>
        </section>
      )}

      {open.length === 0 && <p className="mt-8 border-y border-rule py-6 text-ink-2">No bookable mechanics match these filters. Try a wider location or fewer filters.</p>}

      {setAside.length > 0 && (
        <details className="group mt-10 border-t border-rule pt-2">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">
            <ChevronDown size={17} className="transition-transform group-open:rotate-180" aria-hidden />
            Other profiles, not currently bookable ({setAside.length})
          </summary>
          <ul className="mt-2 grid grid-cols-1 gap-2">
            {setAside.map((r) => (
              <UnbookableCard key={r.p.id} fit={r} ctx={ctxObj} profileHref={card(r).profileHref} status={r.bookable ? "Outside selected availability" : undefined} />
            ))}
          </ul>
        </details>
      )}

      <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-6">
        <p className="font-semibold">Not sure who to choose? Get estimates from a few.</p>
        <Link href={`/customer/requests/new${ctx ? `?${ctx}` : ""}`} className="btn btn-line">
          Describe the problem <ArrowRight size={15} aria-hidden />
        </Link>
      </div>
    </div>
  );
}
