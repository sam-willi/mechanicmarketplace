import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ready, repo } from "@/lib/data";
import type { PublicMechanicProfile } from "@/lib/domain/public-profile";
import type { ContextMatch } from "@/lib/domain/reputation";
import { REPAIR_CATEGORIES, VEHICLE_MAKES, type RepairCategory, type VehicleMake } from "@/lib/domain/types";
import { getSession, getSessionId, getVariant } from "@/lib/session";
import { usd, WORK_MODEL_LABEL } from "@/lib/format";
import { Wordmark } from "@/components/brand/wordmark";
import { EvidenceProvider } from "@/components/trust/evidence-sheet";
import { PersonFacts } from "@/components/profile/record";
import { startingPrice } from "@/components/find/mechanic-card";
import { CalendarClock, ChevronDown, Info } from "lucide-react";
import { TrustOverview } from "@/components/profile/overview";
import { SectionNav } from "@/components/profile/section-nav";
import { EligibilityNotice } from "@/components/trust/eligibility-notice";
import { eligibility } from "@/lib/domain/eligibility";
import { openingLabel, soonest } from "@/lib/domain/availability";
import { ProfileGallery } from "@/components/visual/gallery";
import {
  Credentials,
  MakeLedger,
  MatchingWork,
  PricingSection,
  RecentWork,
  RepairLedger,
  Reviews,
  SectionHead,
  SelfReported,
} from "@/components/profile/sections";
import { ContextPicker } from "@/components/profile/context-picker";
import { ShareButton } from "@/components/profile/share-button";
import { QuoteLink } from "@/components/profile/quote-link";
import { LowEvidenceProfile } from "@/components/profile/low-evidence";
import { SaveMechanicButton } from "@/components/profile/save-button";
import { DemoNote } from "@/components/site/demo-note";

type Params = { slug: string };
type Search = { repair?: string; make?: string; variant?: string; ref?: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  await ready();
  const { slug } = await params;
  const p = repo.getPublicProfile(slug);
  if (!p) return {};
  const r = p.reputation;
  const top = r.byCategory[0];
  return {
    title: `${p.displayName}, ${WORK_MODEL_LABEL[p.workModel].toLowerCase()} in ${p.city}`,
    description: `${r.verifiedRepairs} verified repairs${top ? `, including ${top.count} ${top.category}` : ""}. ${usd(p.pricing.hourlyRateCents)}/hr. Every claim shows how it was verified.`,
  };
}

function parseContext(sp: Search) {
  const repair = REPAIR_CATEGORIES.includes(sp.repair as RepairCategory) ? (sp.repair as RepairCategory) : undefined;
  const make = VEHICLE_MAKES.find((m) => m.toLowerCase() === sp.make?.toLowerCase());
  return { repair, make: make as VehicleMake | undefined };
}

function contextMatch(p: PublicMechanicProfile, repair?: RepairCategory, make?: VehicleMake): ContextMatch | null {
  if (!repair && !make) return null;
  const w = p.verifiedWork;
  const entries = w.filter((x) => (!repair || x.category === repair) && (!make || x.make === make));
  return {
    repair,
    make,
    categoryCount: repair ? w.filter((x) => x.category === repair).length : 0,
    makeCount: make ? w.filter((x) => x.make === make).length : 0,
    crossCount: repair && make ? entries.length : 0,
    entries: [],
  };
}

export default async function MechanicProfilePage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  await ready();
  const { slug } = await params;
  const sp = await searchParams;
  const p = repo.getPublicProfile(slug);
  if (!p) notFound();

  const variant = await getVariant(sp.variant);
  const session = await getSession();
  const { repair, make } = parseContext(sp);
  const match = contextMatch(p, repair, make);
  const w = p.verifiedWork;
  const fit = {
    p,
    cross: repair && make ? w.filter((x) => x.category === repair && x.make === make).length : 0,
    cat: repair ? w.filter((x) => x.category === repair).length : 0,
    mk: make ? w.filter((x) => x.make === make).length : 0,
    mdl: 0,
  };
  const elig = eligibility(p);
  const hasMatchingWork = Boolean(match && w.some((x) => (!repair || x.category === repair) && (!make || x.make === make)));
  const nav = [
    { id: "overview", label: "Overview" },
    ...(hasMatchingWork ? [{ id: "matching-work", label: "Matching work" }] : []),
    { id: "gallery", label: "Work gallery" },
    { id: "reviews", label: "Reviews" },
    { id: "pricing", label: "Pricing" },
    { id: "more", label: "More" },
  ];
  const price = startingPrice(p, repair);
  const nextOpen = soonest(p.openings);
  const nextLabel = nextOpen ? openingLabel(nextOpen, { prefix: true }) : `Next opening ${p.nextAvailable}`;

  repo.track("profile_view", {
    mechanicId: p.id,
    variant,
    ref: sp.ref,
    contextual: Boolean(match),
    session: await getSessionId(),
  });

  const qs = new URLSearchParams({ mechanic: p.slug, ...(repair ? { repair } : {}), ...(make ? { make } : {}) }).toString();
  const quoteHref = `/customer/requests/new?${qs}`;
  const sharePath = `/mechanics/${p.slug}${repair || make ? `?${new URLSearchParams({ ...(repair ? { repair } : {}), ...(make ? { make } : {}) })}` : ""}`;
  const saved = session.role === "customer" ? repo.listSaved(session.customerId).includes(p.id) : false;

  return (
    <EvidenceProvider mechanicId={p.id} variant={variant}>
      <header className="sticky top-0 z-30 border-b border-rule bg-paper/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center justify-between px-4 sm:px-6">
          <Wordmark />
          <div className="flex items-center gap-2">
            {session.role === "customer" && <SaveMechanicButton mechanicId={p.id} saved={saved} />}
            <ShareButton path={sharePath} title={`${p.displayName} on Clutch`} mechanicId={p.id} variant={variant} compact />
          </div>
        </div>
      </header>

      {variant === "low" ? (
        <LowEvidenceProfile p={p} quoteHref={quoteHref} variant={variant} />
      ) : (
        <main className="mx-auto grid max-w-[1120px] gap-x-10 px-4 pt-6 pb-32 sm:px-6 sm:pt-10 lg:grid-cols-[minmax(0,1fr)_18.5rem] lg:pb-20">
          <div className="min-w-0 space-y-6">
            <TrustOverview p={p} fit={fit} ctx={{ repair, make }} />
            {!match ? <ContextPicker slug={p.slug} firstName={p.firstName} /> : null}
            <SectionNav items={nav} />

            <div className="space-y-12 pt-2 sm:space-y-14">
              {match ? <MatchingWork p={p} category={repair} make={make} /> : null}

              <section aria-labelledby="gallery-title" className="space-y-4">
                <SectionHead id="gallery" title="Work gallery" />
                <ProfileGallery repairs={w} firstName={p.firstName} />
              </section>

              <Reviews p={p} prefer={{ repair, make }} />
              <PricingSection p={p} />

              {/* Everything a minority of visitors want, one tap away. */}
              <details id="more" className="group scroll-mt-20 border-t-2 border-ink">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 pt-3 [&::-webkit-details-marker]:hidden">
                  <span className="heading text-[1.375rem] sm:text-[1.5rem]">More about {p.firstName}</span>
                  <ChevronDown size={20} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <p className="text-[0.875rem] text-ink-2">Full repair record, vehicles, certifications, work history and what {p.firstName} says about themselves.</p>
                <div className="mt-8 space-y-12">
                  <RepairLedger p={p} highlight={repair} highlightMake={make} />
                  <MakeLedger p={p} highlightMake={make} />
                  <RecentWork p={p} exclude={match ? { category: repair, make } : undefined} />
                  <Credentials p={p} />
                  <div className="border-t border-rule-soft pt-4">
                    <PersonFacts p={p} />
                  </div>
                  <SelfReported p={p} />
                </div>
              </details>

              <footer className="border-t border-rule pt-4 text-[0.8125rem] text-ink-3">
                <p>
                  On Clutch since {new Date(p.joinedAt).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}.{" "}
                  <Link href="/verification" className="link text-ink-2">
                    How Clutch verifies claims
                  </Link>
                </p>
                <DemoNote className="mt-2" />
              </footer>
            </div>
          </div>

          {/* Desktop estimate card */}
          <aside className="hidden lg:block">
            <div className="sheet perf-left sticky top-20 space-y-4 py-5 pr-5 pl-9">
              <p>
                <span className="text-[0.8125rem] text-ink-3">From </span>
                <span className="num text-[2rem]">{price.amount}</span>
                <span className="text-[0.875rem] text-ink-2"> {price.unit}</span>
              </p>
              <p className="flex items-center gap-2 text-[0.9375rem] font-semibold">
                <CalendarClock size={16} className="text-ink-3" aria-hidden /> {nextLabel}
              </p>
              {elig.eligible ? <QuoteLink href={quoteHref} mechanicId={p.id} variant={variant} className="w-full" /> : <EligibilityNotice e={elig} />}
              <details className="text-[0.8125rem] text-ink-2">
                <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 font-semibold text-ink">
                  <Info size={14} aria-hidden /> How estimates work
                </summary>
                <p className="leading-snug">
                  {p.firstName} sends a written estimate with the full price. Nothing is booked until you approve it, and any change of scope needs your OK.
                </p>
              </details>
            </div>
          </aside>
        </main>
      )}

      {/* Mobile stub */}
      <div className="perf-top fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-sheet pt-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
        <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-3 px-4 pt-2">
          <div className="min-w-0">
            <p className="num text-[1.5rem] text-ink">
              {price.amount}
              <span className="ml-1 text-[0.875rem] font-normal text-ink-2">{price.unit}</span>
            </p>
            <p className="truncate text-[0.8125rem] text-ink-3">{nextLabel}</p>
          </div>
          {elig.eligible ? <QuoteLink href={quoteHref} mechanicId={p.id} variant={variant} /> : <span className="max-w-[11rem] text-right text-[0.8125rem] font-semibold text-alert">Can&apos;t be booked right now</span>}
        </div>
      </div>
    </EvidenceProvider>
  );
}
