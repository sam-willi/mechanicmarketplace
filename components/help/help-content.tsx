import Link from "next/link";
import { BadgeCheck, EyeOff, FileText, Flag, MessageSquareWarning, ChevronDown, Star, TriangleAlert } from "lucide-react";

/**
 * What protects you on Clutch, stated as mechanisms that actually exist in the
 * product. What Clutch does not do is said just as plainly.
 */
const PROTECTIONS = [
  { icon: BadgeCheck, title: "Every verification check shown, verified or not", body: "Each mechanic's identity, background check, driving record (if they drive to you) and insurance show with their own status: Verified, Pending, Not completed, Not verified, Expired or Could not be verified. Mechanics can be booked before Clutch has verified every check. If any isn't verified, you see exactly which ones and confirm before booking, and that record stays with the booking. You can search for fully verified mechanics only." },
  { icon: FileText, title: "A written estimate before any work", body: "Every job starts from an estimate you approve, with labor, fees and parts listed. Once you accept it, it can't be changed. Extra work found later needs your approval of the work and its price in the app first." },
  { icon: EyeOff, title: "Your address stays private until you book", body: "Mechanics see your neighborhood while they decide. Your street address and access notes are shared only with the mechanic you book." },
  { icon: Star, title: "Reviews come from real jobs", body: "Only customers who completed a repair through Clutch can leave a rated review. Every repair on a profile shows how it was verified." },
  { icon: Flag, title: "Report a problem to a person", body: "Reports go to Clutch staff, who see the job's estimate, history and photos next to your report and reply on your Help page in the app. There's no set response time." },
];

const LIMITS = [
  "Clutch doesn't process payments in this version. You pay the mechanic directly; amounts you or the mechanic enter are recorded as self-reported.",
  "Clutch can't refund money, charge a mechanic or decide a dispute. Staff can review what happened and reply to you in the app.",
  "Clutch doesn't guarantee repairs or pay for them. Some mechanics offer their own workmanship guarantee; it's shown on their profile as a mechanic-provided guarantee, in their words.",
  "Clutch doesn't vouch for checks it hasn't verified. If a check shows as anything but Verified, ask the mechanic about it, or choose a fully verified mechanic. If insurance isn't verified, ask the mechanic for proof of insurance.",
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
          ["A customer disputes the final price", "The accepted estimate, every earlier version, any extra work the customer approved and the job's history are on the job page. You can also report it with the job attached; Clutch staff can review the record and reply in the app, but can't move money or decide who's right."],
          ["How do I get repairs from before Clutch on my record?", <>Add them in <Link href="/mechanic/repairs" className="link">Repair records</Link> and ask the customer to confirm, or upload an invoice for review.</>],
        ]
      : [
          ["The mechanic wants to do more than the estimate", "Once work has started, they have to ask you to approve the extra work and its price on the repair page first. If you decline, they finish only what you approved."],
          ["I need to cancel", "Before work starts, open the repair in My Repairs and choose Cancel booking; Clutch charges no fee. After work starts it can't be cancelled in Clutch: talk to the mechanic, or report a problem. Talk to the mechanic about any parts they've already bought."],
          ["I need a different time", "Open the repair and suggest a new time. The booking only changes once the mechanic accepts it; until then the original time stands."],
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

/**
 * How to reach Clutch, as it actually works today: an in-app report that staff answer in the
 * app. No email or phone line, and no promised response time.
 */
export function ContactSupport({ signedIn = true }: { signedIn?: boolean }) {
  return (
    <section className="sheet flex flex-wrap items-center gap-4 p-4">
      <MessageSquareWarning size={22} aria-hidden className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-bold">Reaching Clutch</p>
        <p className="text-[0.9375rem] text-ink-2">
          Clutch doesn&apos;t have an email or phone support line yet.{" "}
          {signedIn ? (
            "Report a problem on this page or from a repair; Clutch staff reply here, in the app. There's no set response time."
          ) : (
            <>
              <Link href="/login?next=/customer/help" className="link">
                Log in
              </Link>{" "}
              to report a problem; Clutch staff reply in the app. There&apos;s no set response time.
            </>
          )}{" "}
          In an emergency, call 911.
        </p>
      </div>
    </section>
  );
}
