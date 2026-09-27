import type { Metadata } from "next";
import { CATEGORY_LABEL, PROVENANCE, PROVENANCE_ORDER, SAFETY, STATUS_LABEL } from "@/lib/domain/provenance";
import { sourceEvidence } from "@/lib/domain/evidence";
import { SiteFooter, SiteHeader } from "@/components/site/site-header";
import { EvidenceProvider } from "@/components/trust/evidence-sheet";
import { ProvenanceMark } from "@/components/trust/provenance-mark";
import { Tick } from "@/components/trust/marks";
import type { VerificationStatus } from "@/lib/domain/types";

export const metadata: Metadata = { title: "How verification works" };

const STATUS_NOTES: Record<VerificationStatus, string> = {
  not_submitted: "The mechanic hasn't provided this. Profiles show the blank instead of hiding it.",
  pending: "Submitted and waiting on a reviewer, the issuer, the employer, a past customer or a screening provider.",
  verified: "Confirmed. The profile shows the source and the date.",
  rejected: "The evidence didn't hold up. The claim isn't shown as verified.",
  needs_info: "The reviewer asked the mechanic for a clearer or more complete document.",
  expired: "Was verified, but the certificate, policy or screening has lapsed. It no longer counts.",
  reverification_required: "Still valid, but expires within 30 days. The mechanic has been asked to renew.",
};

export default function VerificationPage() {
  return (
    <EvidenceProvider>
      <SiteHeader />
      <main className="mx-auto max-w-[1000px] px-4 pt-10 sm:px-6 sm:pt-16">
        <h1 className="display max-w-[18ch] text-[2.5rem] sm:text-[3.5rem]">How Clutch verifies a mechanic.</h1>
        <p className="mt-5 max-w-[60ch] text-[1.0625rem] leading-relaxed text-ink-2">
          Two separate systems. Verification checks tell you what Clutch has confirmed about a mechanic&apos;s identity, background, driving record and insurance. Proven
          experience tells you they&apos;ve actually done your kind of repair. One never implies the other.
        </p>

        <section className="mt-14 space-y-6">
          <div className="border-t-2 border-ink pt-3">
            <h2 className="heading text-[1.75rem]">Verification checks</h2>
            <p className="mt-1 max-w-[62ch] text-ink-2">
              Checks are run with the mechanic&apos;s consent. Mechanics can be booked before every check is verified: each profile, search result and estimate shows every
              check&apos;s own status, and before you book a mechanic Clutch hasn&apos;t fully verified, you see exactly which checks are missing and confirm. Clutch
              hasn&apos;t connected an independent screening company yet, so ID, background and driving record checks currently show as not completed for real mechanics.
            </p>
          </div>
          <ul className="border-t border-rule">
            {Object.values(SAFETY).map((s) => (
              <li key={s.category} className="grid gap-2 border-b border-rule-soft py-4 sm:grid-cols-[15rem_minmax(0,1fr)] sm:gap-8">
                <p className="flex items-center gap-2 font-semibold text-carbon">
                  <Tick size={16} /> {s.passLabel}
                </p>
                <p className="max-w-[68ch] text-[0.9375rem] leading-relaxed text-ink-2">{s.explanation}</p>
              </li>
            ))}
          </ul>
          <p className="sheet px-4 py-3 text-[0.9375rem] text-ink-2">
            <span className="font-semibold text-ink">What&apos;s never public:</span> ID images, background or driving reports, adjudication details, policy
            numbers or documents. Profiles show only the outcome and its date.
          </p>
        </section>

        <section className="mt-16 space-y-6">
          <div className="border-t-2 border-ink pt-3">
            <h2 className="heading text-[1.75rem]">Proven experience and its sources</h2>
            <p className="mt-1 max-w-[62ch] text-ink-2">Every certification, job and repair on a profile carries exactly one source. Tap one to see it as it appears on profiles.</p>
          </div>
          <ul className="border-t border-rule">
            {PROVENANCE_ORDER.map((src) => (
              <li key={src} className="grid gap-2 border-b border-rule-soft py-4 sm:grid-cols-[15rem_minmax(0,1fr)] sm:gap-8">
                <div>
                  <ProvenanceMark detail={sourceEvidence(src)} size="md" />
                  <p className="mt-1 text-[0.8125rem] text-ink-3">{PROVENANCE[src].copy}</p>
                </div>
                <p className={`max-w-[68ch] text-[0.9375rem] leading-relaxed ${src === "self" ? "text-pencil" : "text-ink-2"}`}>{PROVENANCE[src].explanation}</p>
              </li>
            ))}
          </ul>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              ["Past repairs start as self-reported", "A mechanic can list earlier jobs. Each stays self-reported until the customer confirms it through a private link."],
              ["Clutch jobs verify themselves", "When a repair is booked and completed through Clutch, it becomes verified through a Clutch job with no extra step."],
              ["Only real repairs count toward the rating", "The headline rating uses reviews from completed Clutch jobs only. Testimonials are shown separately and labelled."],
            ].map(([t, d]) => (
              <div key={t} className="border-t border-ink pt-3">
                <p className="font-semibold text-ink">{t}</p>
                <p className="mt-1 text-[0.9375rem] text-ink-2">{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-16 space-y-6">
          <div className="border-t-2 border-ink pt-3">
            <h2 className="heading text-[1.75rem]">Everything expires</h2>
            <p className="mt-1 max-w-[62ch] text-ink-2">
              Certifications, insurance and screenings carry a verified date and an expiry date. Background and driving checks are re-run every year. A lapsed item stops
              counting automatically.
            </p>
          </div>
          <dl className="border-t border-rule">
            {(Object.keys(STATUS_NOTES) as VerificationStatus[]).map((k) => (
              <div key={k} className="grid gap-1 border-b border-rule-soft py-3 sm:grid-cols-[15rem_minmax(0,1fr)] sm:gap-8">
                <dt className="font-semibold text-ink">{STATUS_LABEL[k]}</dt>
                <dd className="text-[0.9375rem] text-ink-2">{STATUS_NOTES[k]}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-16">
          <div className="border-t-2 border-ink pt-3">
            <h2 className="heading text-[1.75rem]">Why there&apos;s no trust score</h2>
          </div>
          <p className="mt-3 max-w-[64ch] text-[1.0625rem] leading-relaxed text-ink-2">
            A single number hides the thing you actually need to know. &ldquo;92/100&rdquo; can&apos;t tell you whether someone has replaced BMW brakes before. So Clutch shows the
            evidence itself (what was verified, by whom, and when) and lets you decide. Categories reviewed: {Object.values(CATEGORY_LABEL).join(", ").toLowerCase()}.
          </p>
        </section>
      </main>
      <SiteFooter />
    </EvidenceProvider>
  );
}
