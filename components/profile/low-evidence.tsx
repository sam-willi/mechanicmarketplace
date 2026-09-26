
import { StarRating } from "@/components/visual/stars";
import type { PublicMechanicProfile } from "@/lib/domain/public-profile";
import { REPAIR_LABEL } from "@/lib/domain/provenance";
import type { EvidenceVariant } from "@/lib/domain/types";
import { rating } from "@/lib/format";
import { PriceLine, RecordHeader } from "./record";
import { QuoteLink } from "./quote-link";

/**
 * Control arm of the trust experiment: the profile as most marketplaces show it
 * — bio, stars, self-reported experience. Same visual world, no provenance.
 */
export function LowEvidenceProfile({ p, quoteHref, variant }: { p: PublicMechanicProfile; quoteHref: string; variant: EvidenceVariant }) {
  const all = [...p.reviews.verified, ...p.reviews.customerConfirmed, ...p.reviews.testimonials];
  const avg = all.length ? all.reduce((a, r) => a + r.overall, 0) / all.length : null;
  const s = p.selfReported;
  return (
    <main className="mx-auto max-w-[760px] space-y-6 px-4 pt-6 pb-32 sm:px-6 sm:pt-10">
      <RecordHeader p={p} />
      {avg !== null && (
        <p className="flex items-center gap-2 text-[1rem] text-ink">
          <StarRating value={avg} size={16} />
          <span className="font-semibold">{rating(avg)}</span>
          <span className="text-ink-2">({all.length} reviews)</span>
        </p>
      )}
      <PriceLine p={p} />
      <div className="border-t-2 border-ink pt-3">
        <h2 className="heading text-[1.375rem]">About {p.firstName}</h2>
        <p className="mt-2 max-w-[65ch] leading-relaxed text-ink-2">{p.bio}</p>
      </div>
      <dl className="grid grid-cols-2 border-t border-rule">
        {s.yearsExperienceClaim ? (
          <div className="border-b border-rule-soft py-2.5">
            <dt className="field-label">Experience</dt>
            <dd className="font-semibold">{s.yearsExperienceClaim} years</dd>
          </div>
        ) : null}
        <div className="border-b border-rule-soft py-2.5">
          <dt className="field-label">Specialties</dt>
          <dd className="font-semibold">{s.declaredCategories.slice(0, 3).map((c) => REPAIR_LABEL[c]).join(", ")}</dd>
        </div>
      </dl>
      {s.claims.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-ink-2">
          {s.claims.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      <ul className="border-t border-rule">
        {all
          .filter((r) => r.comment)
          .slice(0, 5)
          .map((r) => (
            <li key={r.id} className="border-b border-rule-soft py-3">
              <p className="text-[0.9375rem] leading-relaxed">{r.comment}</p>
              <p className="mt-1 text-[0.8125rem] text-ink-3">{r.authorName}</p>
            </li>
          ))}
      </ul>
      <div className="hidden lg:block">
        <QuoteLink href={quoteHref} mechanicId={p.id} variant={variant} />
      </div>
    </main>
  );
}
