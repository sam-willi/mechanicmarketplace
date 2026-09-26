import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site/site-header";
import { Tick } from "@/components/trust/marks";

export const metadata: Metadata = { title: "For mechanics" };

const STEPS: [string, string][] = [
  ["Create your profile", "Your name, rates, what you work on and where you've worked. It's live at your own link right away."],
  ["Get verified", "Identity, background, driving record and insurance checks each show on your profile with their status. They aren't required to be booked, but verified mechanics rank higher at equal experience."],
  ["Prove your work", "Upload certifications and Clutch staff check them with the issuer. Staff confirm your employment with the shop. Past customers confirm earlier repairs from a link you send them."],
  ["Share it anywhere", "Text it to a lead, post it on Nextdoor or Instagram, put it on your van. Send a link that opens on your BMW brake jobs when that's what they need."],
  ["Every job compounds", "Jobs booked through Clutch are verified automatically and count by repair type and make. Customers save and rebook you directly."],
];

export default function ForMechanics() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1100px] px-4 pt-10 sm:px-6 sm:pt-16">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-16">
          <div>
            <h1 className="display text-[2.75rem] sm:text-[4.25rem]">Your skill. Your proof. Your customers.</h1>
            <p className="mt-5 max-w-[52ch] text-[1.125rem] leading-relaxed text-ink-2">
              Years of good work at a shop or dealership shouldn&apos;t stay with the shop. Clutch turns it into evidence you own, so strangers can trust you on day one of
              going independent.
            </p>
            <ul className="mt-8 space-y-2 text-[1.0625rem] font-semibold">
              {["Set your own price.", "Own your reputation.", "Build repeat customers.", "Get discovered for the work you're actually good at."].map((t) => (
                <li key={t} className="flex items-center gap-2.5">
                  <Tick size={16} /> {t}
                </li>
              ))}
            </ul>
            <Link href="/signup?role=mechanic" className="btn btn-ink mt-8 min-h-12 px-6 text-[1rem]">
              Create a mechanic account <ArrowRight size={16} aria-hidden />
            </Link>
            <p className="mt-3 text-[0.9375rem] text-ink-2">
              Already have a Clutch account?{" "}
              <Link href="/login?next=/mechanic/onboarding" className="font-semibold text-ink underline decoration-rule underline-offset-2">
                Log in
              </Link>{" "}
              and add mechanic mode.
            </p>
          </div>
          <dl className="content-start border-t-2 border-ink">
            {[
              ["You set", "Labor rate, diagnostic fee, travel fee, fixed prices"],
              ["Clutch never", "Ranks you by price or runs a bidding auction"],
              ["You keep", "Your profile link, your repair record, your customer list"],
            ].map(([k, v]) => (
              <div key={k} className="border-b border-rule py-3.5">
                <dt className="field-label">{k}</dt>
                <dd className="mt-1 font-semibold text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <section aria-labelledby="launch-title" className="mt-16 border-l-4 border-brass bg-sheet px-5 py-5 sm:px-6">
          <h2 id="launch-title" className="heading text-[1.5rem]">
            Launching in Los Angeles
          </h2>
          <div className="mt-2 max-w-[68ch] space-y-2 text-ink-2">
            <p>
              Clutch is new, and we&apos;re verifying our first mechanics in Los Angeles now. We can&apos;t promise a number of jobs yet. Customers describe their repair on
              Clutch; once you&apos;re verified, the requests that fit your repairs and area are sent to you, including ones customers saved before you joined.
            </p>
            <p>Joining now means your profile, screening and proof are in place when customers arrive.</p>
          </div>
        </section>

        <ol className="mt-16 border-t border-rule">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="grid gap-2 border-b border-rule-soft py-6 sm:grid-cols-[4rem_16rem_minmax(0,1fr)] sm:gap-6">
              <span className="num text-[2rem] text-rule">{i + 1}</span>
              <p className="heading text-[1.25rem]">{t}</p>
              <p className="max-w-[62ch] text-ink-2">{d}</p>
            </li>
          ))}
        </ol>

        <div className="mt-16 grid gap-6 sm:grid-cols-2">
          <div className="sheet p-5">
            <p className="field-label">What customers see when it&apos;s proven</p>
            <p className="mt-3 flex items-center gap-2 font-semibold text-carbon">
              <Tick size={16} /> ASE A5 Brakes · Confirmed with ASE
            </p>
          </div>
          <div className="border border-dashed border-pencil/60 p-5">
            <p className="field-label">What they see when it&apos;s not</p>
            <p className="mt-3 flex items-center gap-2 font-semibold text-pencil">
              <Tick state="self" size={16} /> &ldquo;Over 100 brake jobs&rdquo; · Self-reported
            </p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
