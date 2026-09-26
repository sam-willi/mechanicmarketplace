import Link from "next/link";
import { ArrowRight, ClipboardList, Scale, Wrench } from "lucide-react";
import { ready, repo } from "@/lib/data";
import { AREAS } from "@/lib/domain/areas";
import { REPAIR_LABEL } from "@/lib/domain/provenance";
import { REPAIR_CATEGORIES, VEHICLE_MAKES } from "@/lib/domain/types";
import { SiteFooter, SiteHeader } from "@/components/site/site-header";
import { SearchBar } from "@/components/find/search-bar";
import { ExampleCard } from "@/components/find/mechanic-card";

const STEPS = [
  { icon: ClipboardList, title: "Describe your car and problem", body: "Pick your car and what's wrong. Photos help, but they're optional." },
  { icon: Scale, title: "Compare qualified mechanics", body: "See verified experience, screening, availability and price side by side." },
  { icon: Wrench, title: "Choose and book", body: "Approve a written estimate and the job is booked." },
];

export default async function Home() {
  await ready();
  // The example is a demo mechanic; a launch database without demo data skips it.
  const derek = repo.getPublicProfile("derek-hall");
  const w = derek?.verifiedWork ?? [];
  const fit = derek
    ? {
        p: derek,
        cross: w.filter((x) => x.category === "brakes" && x.make === "BMW").length,
        cat: w.filter((x) => x.category === "brakes").length,
        mk: w.filter((x) => x.make === "BMW").length,
        mdl: 0,
      }
    : null;

  return (
    <>
      <SiteHeader />
      <main>
        {/* 1 · Search first */}
        <section className="mx-auto max-w-[1200px] px-4 pt-10 pb-16 sm:px-6 lg:pt-16 lg:pb-20">
          <h1 className="display max-w-[16ch] text-[2.5rem] sm:text-[3.5rem] lg:text-[4rem]">
            Find a mechanic with <span className="text-brand">proven experience</span>
          </h1>
          <p className="mt-4 text-[1.125rem] text-ink-2">See what they&apos;ve actually fixed, on cars like yours.</p>
          <div className="mt-8">
            <SearchBar
              variant="hero"
              action="/mechanics"
              initial={{}}
              makes={[...VEHICLE_MAKES]}
              repairs={REPAIR_CATEGORIES.map((c) => ({ id: c, label: REPAIR_LABEL[c] }))}
              areas={AREAS.map((a) => ({ id: a.key, label: a.label }))}
            />
          </div>
          <Link href="/customer/requests/new" className="mt-4 inline-flex min-h-11 items-center gap-1.5 font-semibold underline decoration-rule underline-offset-[3px] hover:decoration-ink">
            Describe the problem instead <ArrowRight size={15} aria-hidden />
          </Link>
        </section>

        {/* 2 · How it works, in three steps */}
        <section aria-labelledby="how-title" className="border-y border-brand-tint bg-brand-wash">
          <div className="mx-auto max-w-[1200px] px-4 py-14 sm:px-6">
            <h2 id="how-title" className="heading text-[1.5rem] sm:text-[1.75rem]">
              How Clutch helps
            </h2>
            <ol className="mt-6 grid gap-6 md:grid-cols-3 md:gap-8">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex gap-4">
                  <span className="grid size-12 shrink-0 place-items-center bg-brand text-on-brand" aria-hidden>
                    <s.icon size={22} />
                  </span>
                  <div>
                    <p className="font-bold">
                      <span className="tnum text-ink-3">{i + 1}. </span>
                      {s.title}
                    </p>
                    <p className="mt-1 text-[0.9375rem] text-ink-2">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 3 · What a result looks like */}
        {fit ? (
          <section aria-labelledby="proof-title" className="mx-auto grid max-w-[1200px] grid-cols-1 items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:gap-16 lg:py-24">
            <div>
              <h2 id="proof-title" className="display text-[2.25rem] sm:text-[3rem]">
                Proof, not just stars
              </h2>
              <p className="mt-3 max-w-[40ch] text-[1.0625rem] text-ink-2">Every count is a verified repair. Unproven claims are labelled as such.</p>
              <Link href="/verification" className="mt-6 inline-flex min-h-11 items-center gap-1.5 font-semibold underline decoration-rule underline-offset-[3px] hover:decoration-ink">
                See how verification works <ArrowRight size={15} aria-hidden />
              </Link>
            </div>
            <ExampleCard fit={fit} ctx={{ repair: "brakes", make: "BMW" }} profileHref="/mechanics/derek-hall?repair=brakes&make=BMW" />
          </section>
        ) : null}

        {/* For mechanics: one band, the full pitch lives on its own page */}
        <section className="mx-auto max-w-[1200px] px-4 pb-20 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-6 bg-brand-deep px-6 py-8 text-on-brand sm:px-10">
            <div>
              <h2 className="heading text-[1.5rem] text-on-brand sm:text-[1.75rem]">Are you a mechanic?</h2>
              <p className="mt-1 text-on-brand-2">Set your price, prove your work, keep your customers.</p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Link href="/for-mechanics" className="text-on-brand-2 underline decoration-on-brand-2/50 underline-offset-[3px] hover:text-on-brand">
                How it works
              </Link>
              <Link href="/signup?role=mechanic" className="btn bg-sheet text-ink hover:bg-white">
                Join as a mechanic <ArrowRight size={16} aria-hidden />
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
