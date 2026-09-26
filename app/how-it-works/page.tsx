import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site/site-header";

export const metadata: Metadata = { title: "How It Works" };

const DRIVER = [
  ["Tell us what's going on", "Describe what your car is doing (no need to know the part) or search for a mechanic by your car and repair."],
  ["Compare evidence, not just price", "Mechanics with relevant verified experience reply with estimates at their own prices. See their verified jobs on cars like yours, their screening and their rating side by side."],
  ["Choose, get it fixed, confirm", "You pick who you trust. When the work is done you confirm it, and it becomes part of that mechanic's verified record."],
];
const MECHANIC = [
  ["Build a profile you own", "Your rates, services and experience at your own link. Verification turns claims into proof customers can check."],
  ["Get matched on what you're good at", "Requests reach you because of your verified experience with that car and that repair. Say you're interested, ask questions, or send an estimate."],
  ["Every job compounds", "Completed Clutch jobs add to your verified record automatically. Customers save and rebook you directly."],
];

function Steps({ items }: { items: string[][] }) {
  return (
    <ol className="border-t border-rule">
      {items.map(([t, d], i) => (
        <li key={t} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3 border-b border-rule-soft py-5">
          <span className="num text-[1.75rem] text-rule">{i + 1}</span>
          <div>
            <p className="heading text-[1.25rem]">{t}</p>
            <p className="mt-1 text-ink-2">{d}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function HowItWorks() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1100px] px-4 pt-10 sm:px-6 sm:pt-16">
        <h1 className="display max-w-[18ch] text-[2.5rem] sm:text-[3.5rem]">One network, two products.</h1>
        <p className="mt-4 max-w-[60ch] text-[1.125rem] text-ink-2">
          Drivers find someone they can trust to fix their car. Mechanics build an independent business on proof of their work. Clutch never decides who is best: it
          shows the evidence and the customer chooses.
        </p>
        <p className="mt-3 max-w-[60ch] text-[0.9375rem] text-ink-2">
          Clutch is launching in Los Angeles and verifying its first mechanics now. Until they&apos;re verified, you can describe a repair and Clutch saves it for them.
        </p>
        <div className="mt-14 grid gap-12 lg:grid-cols-2">
          <section>
            <h2 className="display text-[1.75rem]">If you need a mechanic</h2>
            <div className="mt-5">
              <Steps items={DRIVER} />
            </div>
            <Link href="/customer/mechanics" className="btn btn-ink mt-6">
              Find a Mechanic <ArrowRight size={16} aria-hidden />
            </Link>
          </section>
          <section>
            <h2 className="display text-[1.75rem]">If you&apos;re a mechanic</h2>
            <div className="mt-5">
              <Steps items={MECHANIC} />
            </div>
            <Link href="/signup?role=mechanic" className="btn btn-line mt-6">
              Create a mechanic account <ArrowRight size={16} aria-hidden />
            </Link>
          </section>
        </div>
        <p className="mt-14 border-t border-rule pt-6 text-[0.9375rem] text-ink-2">
          Want the detail on identity, background, insurance and skill checks?{" "}
          <Link href="/verification" className="link text-ink">
            How verification works
          </Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
