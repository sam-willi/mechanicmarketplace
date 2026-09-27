import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site/site-header";

export const metadata: Metadata = { title: "Privacy" };

/**
 * A plain description of what Clutch actually stores and why, written from the code. It's an
 * MVP draft and says so; the real policy needs legal review before a public launch (README).
 */
const SECTIONS: { title: string; items: string[] }[] = [
  {
    title: "What we collect",
    items: [
      "Your account: name, email address and, if you give it, a phone number (mechanics must). If you sign in with Google, Google shares your name and email with us.",
      "For customers: the cars you add (year, make, model, mileage, VIN if you enter it), your repair requests, the photos, videos, recordings and documents you upload, and where the car is. Your exact address is shared only with the mechanic you book.",
      "For mechanics: your public profile (name, photo, area, services, prices, availability), the repairs and reviews on your record, and the documents you submit for verification. Only each check's status is public, never the documents.",
      "What happens on Clutch: estimates, questions and answers, bookings, job updates, reviews, and payments either side chooses to record. Clutch doesn't process or store any payment card or bank details.",
      "Basic usage events (for example, that a request was started or a profile was viewed) to understand how Clutch is used. These aren't sold or used for advertising.",
    ],
  },
  {
    title: "Cookies",
    items: [
      "Sign-in cookies that keep you logged in, and small cookies that remember whether you're in customer or mechanic mode and whether you're in the demo. No advertising or cross-site tracking cookies.",
    ],
  },
  {
    title: "Who sees what",
    items: [
      "Customers see mechanics' public profiles. Mechanics see the requests sent to them, without your address until you book them. Clutch staff can see records to review verifications and handle support.",
      "Service providers that run Clutch: Supabase (accounts and database), Vercel (hosting) and, if you use it, Google (sign-in). When you enter a car, its details or VIN are looked up with the US government's NHTSA vehicle database.",
      "We don't sell your information.",
    ],
  },
  {
    title: "Messages from Clutch",
    items: ["Account emails (like confirming your address) come from our sign-in provider. Clutch doesn't send marketing email or text messages."],
  },
  {
    title: "Your choices",
    items: [
      "You can edit your profile, cars and requests in the app. To delete your account or get a copy of your data, contact us through Help in the app and we'll handle it.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[760px] px-4 pt-10 sm:px-6 sm:pt-16">
        <h1 className="display text-[2.5rem] sm:text-[3.25rem]">Privacy</h1>
        <p className="mt-4 text-[1.0625rem] leading-relaxed text-ink-2">
          What Clutch stores about you, why, and who can see it, in plain words.
        </p>
        <p className="mt-4 border border-rule bg-sheet px-4 py-3 text-[0.9375rem] text-ink-2">
          Clutch is an early product (MVP). This page describes how it works today and hasn&apos;t yet been reviewed by a lawyer; it will be replaced by a reviewed
          policy before a full public launch.
        </p>
        <div className="mt-10 space-y-10">
          {SECTIONS.map((s) => (
            <section key={s.title} aria-labelledby={`privacy-${s.title}`}>
              <h2 id={`privacy-${s.title}`} className="heading text-[1.375rem]">
                {s.title}
              </h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-[1rem] leading-relaxed text-ink">
                {s.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="mt-10 text-[0.9375rem] text-ink-2">
          Questions? Use{" "}
          <Link href="/help" className="link">
            Help
          </Link>
          .
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
