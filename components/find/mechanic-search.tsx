import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { getRepo } from "@/lib/data";
import { REPAIR_LABEL } from "@/lib/domain/provenance";
import { AREAS, findArea } from "@/lib/domain/areas";
import { contextLabel } from "@/lib/domain/recommend";
import { rankSearch, type SearchRow } from "@/lib/domain/search";
import type { ScreeningKey } from "@/lib/domain/eligibility";
import { REPAIR_CATEGORIES, VEHICLE_MAKES, type RepairCategory, type Vehicle, type VehicleMake } from "@/lib/domain/types";
import { MechanicCard, RecommendationCard, UnbookableCard } from "./mechanic-card";
import { SearchBar } from "./search-bar";
import { emailAlertsOn } from "@/lib/notify/config";

export type SearchParams = {
  repair?: string;
  make?: string;
  area?: string;
  model?: string;
  within?: string;
  vehicle?: string;
  year?: string;
  maxMi?: string;
  lang?: string;
  verified?: string;
  check?: string | string[];
};

const CHECK_KEYS: ScreeningKey[] = ["identity", "background", "driving_record", "insurance"];
const CHECK_LABEL: Record<ScreeningKey, string> = { identity: "identity", background: "background check", driving_record: "driving record", insurance: "insurance" };

/** How many not-bookable profiles targeted live search reads for the set-aside list. */
const UNBOOKABLE_SAMPLE = 20;

/**
 * Find a mechanic. Shared by the public /mechanics page and the customer app.
 * Order: relevant verified experience → vehicle experience → repair experience →
 * distance → availability → reputation → price (last). Never cheapest-first.
 * Only bookable mechanics are offered an estimate; everyone else is set aside.
 */
export async function MechanicSearch({ sp, action, vehicles = [] }: { sp: SearchParams; action: string; vehicles?: Vehicle[]; savedIds?: string[] }) {
  // Only this session's scope: a real visitor never sees a demo mechanic, and vice versa.
  const repo = await getRepo();
  const pickedVehicle = vehicles.find((v) => v.id === sp.vehicle);
  const repair = REPAIR_CATEGORIES.includes(sp.repair as RepairCategory) ? (sp.repair as RepairCategory) : undefined;
  const make = (pickedVehicle?.make ?? VEHICLE_MAKES.find((m) => m === sp.make)) as VehicleMake | undefined;
  const model = pickedVehicle?.model ?? (sp.model?.trim() || undefined);
  const area = findArea(sp.area);
  const within = sp.within === "3" || sp.within === "7" ? Number(sp.within) : undefined;
  const maxMi = area && ["5", "10", "15"].includes(sp.maxMi ?? "") ? Number(sp.maxMi) : undefined;
  const lang = sp.lang?.trim() || undefined;
  const verifiedOnly = sp.verified === "1";
  const checks = verifiedOnly ? [] : CHECK_KEYS.filter((k) => [sp.check ?? []].flat().includes(k));

  // Bookable candidates with their evidence (targeted live mode reads only those, plus a
  // bounded sample of profiles that can't be booked for "not currently bookable").
  const pool = await repo.searchPool({ unbookable: UNBOOKABLE_SAMPLE, repair, make, model });
  const ranked = rankSearch(pool.profiles, (id) => repo.getMechanic(id)!, { repair, make, model, area, within, maxMi, lang, verifiedOnly, checks }, undefined, pool.counts);
  const { filters, open, relevant, picks, rest, setAside, openCount, bookableTotal, languages } = ranked;
  const hasCtx = Boolean(repair || make);
  const ctxObj = { repair, make, model };

  const heading = [make, model, repair ? REPAIR_LABEL[repair].toLowerCase() : null].filter(Boolean).join(" ");
  const ctx = new URLSearchParams({ ...(repair ? { repair } : {}), ...(make ? { make } : {}) }).toString();
  const quoteHref = (slug: string) => `/customer/requests/new?${new URLSearchParams({ mechanic: slug, ...(repair ? { repair } : {}), ...(make ? { make } : {}) })}`;
  const card = (r: SearchRow) => ({ fit: r, ctx: ctxObj, profileHref: `/mechanics/${r.p.slug}${ctx ? `?${ctx}` : ""}`, quoteHref: quoteHref(r.p.slug) });

  // When nothing matches: what the customer asked for, and exactly what dropping each filter would change.
  const without = (keys: string[]) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (!keys.includes(k)) for (const x of [v ?? []].flat()) if (typeof x === "string" && x !== "") q.append(k, x);
    return `${action}${q.size ? `?${q}` : ""}`;
  };
  const active = [
    area ? { label: `in ${area.label}${maxMi ? ` within ${maxMi} mi` : ""}`, drop: ["area", "maxMi"], f: { area: undefined, maxMi: undefined } } : null,
    within ? { label: `available within ${within} days`, drop: ["within"], f: { within: undefined } } : null,
    lang ? { label: `speaks ${lang}`, drop: ["lang"], f: { lang: undefined } } : null,
    verifiedOnly ? { label: "fully verified only", drop: ["verified"], f: { verifiedOnly: undefined } } : null,
    checks.length ? { label: `${checks.map((c) => CHECK_LABEL[c]).join(", ")} verified`, drop: ["check"], f: { checks: undefined } } : null,
  ].filter((x) => x !== null);
  const relaxations = active.map((a) => ({ label: a.label, href: without(a.drop), n: openCount({ ...filters, ...a.f }) }));
  const searched = [
    pickedVehicle ? `${pickedVehicle.year} ${pickedVehicle.make} ${pickedVehicle.model}` : [sp.year, make, model].filter(Boolean).join(" "),
    repair ? REPAIR_LABEL[repair] : "",
    ...active.map((a) => a.label),
  ].filter(Boolean);
  const requestHref = `/customer/requests/new?${new URLSearchParams({
    ...(repair ? { repair } : {}),
    ...(make ? { make } : {}),
    ...(area ? { area: area.key } : {}),
  })}`;

  return (
    <div>
      <h1 className="display text-[2rem] sm:text-[2.5rem]">{heading ? `Mechanics for ${heading}` : "Find a mechanic"}</h1>
      <p className="mt-1.5 text-ink-2">Ranked by verified experience with your job, never by price.</p>
      <p className="mt-1 text-[0.875rem] text-ink-2">
        {verifiedOnly || checks.length
          ? "Filtered on Clutch verification (see More filters)."
          : "Showing every available mechanic. Each card lists which checks Clutch has and hasn't verified; fully verified mechanics rank higher at equal experience."}
      </p>

      <div id="search" className="mt-5 scroll-mt-20">
        <SearchBar
          action={action}
          initial={{
            vehicle: pickedVehicle?.id,
            year: pickedVehicle ? undefined : sp.year,
            make: pickedVehicle ? undefined : make,
            model: pickedVehicle ? undefined : model,
            repair,
            area: area?.key,
            within: within ? String(within) : undefined,
            maxMi: maxMi ? String(maxMi) : undefined,
            lang,
            verified: verifiedOnly ? "1" : undefined,
            check: checks,
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
          {hasCtx && !relevant.length ? (
            <p className="mt-1 text-[0.9375rem] text-ink-2">None of them has verified {contextLabel({ repair, make })} work on Clutch yet. They serve your area and can be booked.</p>
          ) : null}
          <ul className="mt-3 grid grid-cols-1 gap-3">
            {rest.map((r) => (
              <MechanicCard key={r.p.id} {...card(r)} />
            ))}
          </ul>
        </section>
      )}

      {open.length === 0 && (
        <NoMatches searched={searched} bookableTotal={bookableTotal} relaxations={relaxations} clearHref={active.length > 1 ? without(active.flatMap((a) => a.drop)) : undefined} requestHref={requestHref} />
      )}

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

      {open.length > 0 && (
        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-6">
          <p className="font-semibold">Not sure who to choose? Get estimates from a few.</p>
          <Link href={requestHref} className="btn btn-line">
            Describe the problem <ArrowRight size={15} aria-hidden />
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * Nothing bookable matches. Says so plainly, keeps the search visible, explains what
 * widening would change (counted, never guessed), and offers a real next step.
 */
function NoMatches({
  searched,
  bookableTotal,
  relaxations,
  clearHref,
  requestHref,
}: {
  searched: string[];
  bookableTotal: number;
  relaxations: { label: string; href: string; n: number }[];
  clearHref?: string;
  requestHref: string;
}) {
  const helpful = relaxations.filter((x) => x.n > 0);
  return (
    <section aria-labelledby="none-title" className="mt-8 border-y-2 border-ink py-6">
      <h2 id="none-title" className="heading text-[1.375rem]">
        No mechanics match yet
      </h2>
      {searched.length ? (
        <p className="mt-1 text-[0.9375rem] text-ink-2">
          You searched for <span className="font-semibold text-ink">{searched.join(" · ")}</span>.
        </p>
      ) : null}
      <div className="mt-4 max-w-[62ch] space-y-3 text-[0.9375rem]">
        {bookableTotal === 0 ? (
          <p>
            Clutch is launching in Los Angeles, and no mechanic has finished their Clutch profile yet. There&apos;s no one to book for any car, repair or area right
            now, so changing your filters won&apos;t change the results today.
          </p>
        ) : helpful.length ? (
          <>
            <p>
              {bookableTotal === 1 ? "One mechanic can" : `${bookableTotal} mechanics can`} be booked on Clutch, but none match all of your filters. Removing one
              would change this:
            </p>
            <ul className="space-y-1.5">
              {helpful.map((x) => (
                <li key={x.label}>
                  <Link href={x.href} className="font-semibold underline decoration-rule underline-offset-2 hover:decoration-ink">
                    Remove &ldquo;{x.label}&rdquo;
                  </Link>{" "}
                  <span className="text-ink-2">: {x.n === 1 ? "1 mechanic matches" : `${x.n} mechanics match`}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>
            {bookableTotal === 1 ? "One mechanic can" : `${bookableTotal} mechanics can`} be booked on Clutch, but none match your search
            {relaxations.length ? ", and removing any one filter wouldn't change that" : ""}.
            {clearHref ? (
              <>
                {" "}
                <Link href={clearHref} className="font-semibold underline decoration-rule underline-offset-2">
                  Clear all filters
                </Link>
                .
              </>
            ) : null}
          </p>
        )}
        <p className="text-ink-2">
          You can still save a repair request. Clutch keeps it on your Requests page and sends it to a mechanic who fits your car, repair and area once one joins.
          Their reply shows on the request
          {emailAlertsOn() ? ", and you'll get an email alert if alerts are on in your settings." : "; Clutch doesn't send email or text alerts yet."}
        </p>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link href={requestHref} className="btn btn-ink min-h-11">
          Save a repair request <ArrowRight size={15} aria-hidden />
        </Link>
        <a href="#search" className="btn btn-line min-h-11">
          Change your search
        </a>
        <Link href="/customer" className="min-h-11 px-2 py-2.5 text-[0.9375rem] font-semibold text-ink-2 underline decoration-rule underline-offset-2">
          Back to home
        </Link>
      </div>
    </section>
  );
}
