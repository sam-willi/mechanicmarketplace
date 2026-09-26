import Link from "next/link";
import { BadgeCheck, EyeOff, FileText, Flag, MessageSquareWarning, ChevronDown, Star, TriangleAlert } from "lucide-react";

/**
 * What protects you on Clutch, stated as mechanisms that actually exist in the
 * product. What Clutch does not do is said just as plainly.
 */
const PROTECTIONS = [
  { icon: BadgeCheck, title: "Screened before they can send an estimate", body: "Mechanics must pass an identity check, a background check and an insurance check (plus a driving record check if they drive to you) before they can quote. Checks are repeated on a schedule, and lapsed checks show on the profile." },
  { icon: FileText, title: "A written estimate before any work", body: "Every job starts from an estimate you approve, with labor, fees and parts listed. If the scope changes after diagnosis, the mechanic has to send you a revised estimate." },
  { icon: EyeOff, title: "Your address stays private until you book", body: "Mechanics see your neighborhood while they decide. Your street address and access notes are shared only with the mechanic you book." },
  { icon: Star, title: "Reviews come from real jobs", body: "Only customers who completed a repair through Clutch can leave a rated review. Every repair on a profile shows how it was verified." },
  { icon: Flag, title: "Report a problem to a person", body: "Reports go to the Clutch trust team, who review them against the job's estimate, notes and photos, and follow up with you." },
];

const LIMITS = [
  "Clutch doesn't process payments in this version. You pay the mechanic directly.",
  "Clutch doesn't guarantee repairs or pay for them. Some mechanics offer their own workmanship guarantee; it's shown on their profile as a mechanic-provided guarantee, in their words.",
  "In an emergency or if you feel unsafe, call 911 first.",
];

export function Protections() {
  return (
    <section aria-labelledby="protect-title" className="space-y-4">
      <h2 id="protect-title" className="heading text-[1.375rem]">How you&apos;re protected</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {PROTECTIONS.map((p) => (
          <li key={p.title} className="sheet flex gap-3 p-4">
            <p.icon size={20} className="mt-0.5 shrink-0" aria-hidden />
            <div>
              <p className="font-bold">{p.title}</p>
              <p className="mt-1 text-[0.9375rem] text-ink-2">{p.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="border-t border-rule pt-4">
        <p className="flex items-center gap-2 font-bold">
          <TriangleAlert size={17} aria-hidden /> What Clutch doesn&apos;t do
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-6 text-[0.9375rem] text-ink-2">
          {LIMITS.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export const TOPICS = [
  ["work_quality", "The repair wasn't done right"],
  ["price", "The price was different from the estimate"],
  ["no_show", "The mechanic didn't show up or was very late"],
  ["damage", "Something was damaged"],
  ["safety", "I felt unsafe"],
  ["other", "Something else"],
] as const;

export function CommonAnswers({ area }: { area: "customer" | "mechanic" | "public" }) {
  const qa: [string, React.ReactNode][] =
    area === "mechanic"
      ? [
          ["A check expired. Can I still quote?", <>You can keep working existing jobs. New estimates are paused until the check is renewed in <Link href="/mechanic/verification" className="link">Verification</Link>.</>],
          ["A customer disputes the final price", "Your approved estimate and any revised estimates are on the job page. Send us a report with the job attached and we'll look at both sides."],
          ["How do I get repairs from before Clutch on my record?", <>Add them in <Link href="/mechanic/repairs" className="link">Repair records</Link> and ask the customer to confirm, or upload an invoice for review.</>],
        ]
      : [
          ["The mechanic wants to do more than the estimate", "They have to send a revised estimate first. You can accept it, ask a question, or decline and pay only for what you approved."],
          ["I need to cancel", "Open the repair in My Repairs and choose Cancel booking. Cancelling through Clutch is free; talk to the mechanic about any parts they've already bought."],
          ["Where's my repair record?", <>Every completed repair is on the car&apos;s page in {area === "customer" ? <Link href="/customer/vehicles" className="link">My Vehicles</Link> : "My Vehicles"}, with the estimate, notes and photos.</>],
        ];
  return (
    <section aria-labelledby="faq-title" className="space-y-3">
      <h2 id="faq-title" className="heading text-[1.375rem]">Common questions</h2>
      <ul className="border-t border-rule">
        {qa.map(([q, a]) => (
          <li key={q} className="border-b border-rule-soft">
            <details className="group py-3">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold [&::-webkit-details-marker]:hidden">
                {q}
                <ChevronDown size={16} className="shrink-0 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <p className="mt-2 max-w-[65ch] text-[0.9375rem] text-ink-2">{a}</p>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ContactSupport() {
  return (
    <section className="sheet flex flex-wrap items-center gap-4 p-4">
      <MessageSquareWarning size={22} aria-hidden className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-bold">Contact support</p>
        <p className="text-[0.9375rem] text-ink-2">
          Email <a href="mailto:support@clutch.demo" className="link">support@clutch.demo</a>. A person reads every message, usually within one business day.
        </p>
      </div>
    </section>
  );
}
