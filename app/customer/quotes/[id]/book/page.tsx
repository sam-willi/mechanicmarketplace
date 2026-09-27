import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CircleAlert } from "lucide-react";
import { getRepo } from "@/lib/data";
import { getSession, needs } from "@/lib/session";
import { eligibility, INSURANCE_UNVERIFIED_NOTE } from "@/lib/domain/eligibility";
import { ACK_TEXT, checksNow, DISCLOSURE_VERSION, snapshotKey } from "@/lib/domain/disclosure";
import { quoteTotals } from "@/lib/domain/quote";
import { vehicleLine } from "@/lib/domain/intake";
import { acceptQuote } from "@/app/actions/customer";
import { SubmitButton } from "@/components/auth/submit-button";
import { SCREENING_STYLE } from "@/components/trust/screening-style";

export const metadata: Metadata = { title: "Before you book" };

/**
 * The confirmation step before booking a mechanic Clutch hasn't fully verified: exactly which
 * checks are and aren't verified, and an acknowledgement that starts unticked. The server checks
 * the acknowledgement against the mechanic's checks at the moment of booking, and keeps what
 * was shown with the booking.
 */
export default async function BookWithDisclosure({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "customer") return null;
  const { id } = await params;
  await (await needs(s)).customerQuote(id);
  const sp = await searchParams;
  const q = repo.getQuote(id);
  if (!q || q.status === "draft") notFound();
  const r = repo.getRequest(q.requestId)!;
  if (r.customerId !== s.customerId) notFound();
  if (q.status !== "submitted" || r.status === "booked" || r.status === "completed" || r.status === "cancelled") redirect(`/customer/quotes/${id}`);
  const p = repo.getPublicProfile(repo.getMechanic(q.mechanicId)!.slug)!;
  const e = eligibility(p);
  // Fully verified (or became so since): nothing to acknowledge, book from the estimate.
  if (!e.eligible || e.fullyVerified) redirect(`/customer/quotes/${id}`);
  const v = repo.getVehicle(r.vehicleId)!;
  const checks = checksNow(p);
  const notVerified = checks.filter((c) => !c.verified);
  const verified = checks.filter((c) => c.verified);
  const t = quoteTotals(q);

  return (
    <div className="mx-auto max-w-[680px]">
      <Link href={`/customer/quotes/${id}`} className="inline-flex min-h-11 items-center gap-1.5 text-[0.875rem] text-ink-3 hover:text-ink">
        <ArrowLeft size={14} aria-hidden /> Back to the estimate
      </Link>
      <h1 className="display mt-2 text-[2rem] sm:text-[2.25rem]">Before you book {p.firstName}</h1>
      <p className="mt-1 text-ink-2">
        {vehicleLine(v)} · {q.availableOn} · {t.planFor}
      </p>

      {sp.error ? (
        <p role="alert" className="mt-4 flex gap-2 border-2 border-alert bg-alert-wash px-4 py-3 font-semibold text-alert">
          <CircleAlert size={18} className="mt-0.5 shrink-0" aria-hidden /> {sp.error}
        </p>
      ) : null}

      <section aria-labelledby="not-verified" className="mt-6 border-2 border-amber bg-amber-wash p-4 sm:p-5">
        <h2 id="not-verified" className="heading text-[1.25rem]">
          Clutch has not verified {notVerified.length === checks.length ? "any of these checks" : notVerified.length === 1 ? "this check" : "these checks"}
        </h2>
        <ul className="mt-3 space-y-2">
          {notVerified.map((c) => {
            const S = SCREENING_STYLE[c.state];
            return (
              <li key={c.key} className="flex items-start gap-2">
                <S.icon size={18} className="mt-0.5 shrink-0 text-amber" aria-hidden />
                <span>
                  <span className="font-bold">{c.name}:</span> {c.status}
                </span>
              </li>
            );
          })}
        </ul>
        {notVerified.some((c) => c.key === "insurance") ? <p className="mt-3 text-[0.9375rem]">{INSURANCE_UNVERIFIED_NOTE}</p> : null}
      </section>

      {verified.length ? (
        <section aria-labelledby="verified" className="mt-4 border border-rule bg-sheet p-4 sm:p-5">
          <h2 id="verified" className="heading text-[1.0625rem]">
            Clutch has verified
          </h2>
          <ul className="mt-2 space-y-1">
            {verified.map((c) => (
              <li key={c.key}>
                <span className="font-bold">{c.name}:</span> {c.status}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-4 max-w-[62ch] space-y-2 text-[0.9375rem] text-ink-2">
        <p>
          Clutch doesn&apos;t vouch for checks it hasn&apos;t verified. You can still book {p.firstName}, ask them about these checks first, or{" "}
          <Link href={`/customer/requests/${r.id}`} className="font-semibold text-ink underline decoration-rule underline-offset-2">
            look at other estimates
          </Link>{" "}
          or{" "}
          <Link href="/customer/mechanics?verified=1" className="font-semibold text-ink underline decoration-rule underline-offset-2">
            fully verified mechanics
          </Link>
          .
        </p>
        <p>This confirmation records what you were shown. It doesn&apos;t waive any rights or change anyone&apos;s responsibilities.</p>
      </div>

      <form action={acceptQuote.bind(null, q.id)} className="mt-6 space-y-4 border-t-2 border-ink pt-5">
        <input type="hidden" name="version" value={q.version ?? 1} />
        <input type="hidden" name="from" value="review" />
        <input type="hidden" name="ackVersion" value={DISCLOSURE_VERSION} />
        <input type="hidden" name="ackSnapshot" value={snapshotKey(checks)} />
        <label className="flex cursor-pointer gap-3 border border-rule bg-sheet p-4">
          <input type="checkbox" name="acknowledge" value="yes" required className="mt-0.5 size-5 shrink-0 accent-brand" />
          <span className="font-semibold">{ACK_TEXT}</span>
        </label>
        <SubmitButton className="btn btn-ink min-h-12 w-full text-[1rem]" pending="Booking…">Book {p.firstName} for {q.availableOn}</SubmitButton>
        <p className="text-[0.8125rem] text-ink-3">
          {p.firstName} gets your address and access notes. Other mechanics are told you chose someone else. No payment is taken on Clutch.
        </p>
      </form>
    </div>
  );
}
