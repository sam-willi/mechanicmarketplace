import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { BadgeCheck, ChevronRight, DollarSign, ExternalLink, FileText, Settings, Star } from "lucide-react";
import { ready, repo } from "@/lib/data";
import { getSession } from "@/lib/session";
import { toPublicProfile } from "@/lib/domain/public-profile";
import { profileSteps } from "@/lib/domain/completeness";
import { PageTitle } from "@/components/workspace/ui";
import { ShareButton } from "@/components/profile/share-button";
import { CopyLink } from "@/components/app/copy-link";
import { LinkBuilder } from "@/components/workspace/link-builder";
import { PhotoPrint } from "@/components/profile/photo";
import { Standing } from "@/components/mechanic/standing";
import { Tick } from "@/components/trust/marks";

export const metadata: Metadata = { title: "Public Profile" };

export default async function PublicProfileTools({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  await ready();
  const s = await getSession();
  if (s.role !== "mechanic") return null;
  const sp = await searchParams;
  const m = repo.getMechanic(s.mechanicId)!;
  const p = toPublicProfile(repo.getMechanicSources(s.mechanicId));
  const a = await repo.analyticsSummary(s.mechanicId);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const url = `${origin}/mechanics/${m.slug}?ref=qr`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 1, color: { dark: "#16181d", light: "#fcfcfa" } });
  const qrDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(qr)}`;
  const steps = profileSteps(p, { hasPhoto: Boolean(m.photoUrl), hasPricing: m.hourlyRateCents > 0, shared: a.profile_share > 0 });

  const more = [
    { href: "/mechanic/quotes", label: "Quotes", icon: FileText },
    { href: "/mechanic/reputation", label: "Reputation", icon: Star },
    { href: "/mechanic/verification", label: "Verification", icon: BadgeCheck },
    { href: "/mechanic/earnings", label: "Earnings", icon: DollarSign },
    { href: "/mechanic/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="space-y-10">
      <PageTitle title="Public Profile" note="Your reputation, ready to share anywhere." />
      {sp.saved ? <p className="border border-ink bg-sheet px-4 py-3 text-[0.9375rem]">Profile saved.</p> : null}

      {/* On phones, everything not in the bottom bar lives here. */}
      <nav aria-label="More" className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:hidden">
        {more.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className="sheet flex items-center gap-2 px-3 py-3 font-semibold">
            <Icon size={17} aria-hidden /> {label}
            <ChevronRight size={16} className="ml-auto text-ink-3" aria-hidden />
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="sheet space-y-5 p-5">
          <div className="flex items-center gap-4">
            <PhotoPrint photoUrl={p.photoUrl} initials={p.initials} name={p.displayName} size={72} />
            <div className="min-w-0">
              <p className="heading text-[1.375rem]">{p.displayName}</p>
              <p className="tnum truncate text-[0.875rem] text-ink-2">
                {origin.replace(/^https?:\/\//, "")}/mechanics/{m.slug}
              </p>
              <p className="text-[0.8125rem] text-ink-3">
                {a.profile_view} views · {a.profile_share} shares
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/mechanics/${m.slug}`} className="btn btn-ink">
              View my public profile <ExternalLink size={15} aria-hidden />
            </Link>
            <CopyLink path={`/mechanics/${m.slug}`} label="Copy link" className="min-h-11" />
            <ShareButton path={`/mechanics/${m.slug}`} title={`${p.displayName} on Clutch`} mechanicId={m.id} />
            <Link href="/mechanic/onboarding?edit=1" className="btn btn-quiet">
              Edit profile
            </Link>
          </div>
          <LinkBuilder slug={m.slug} mechanicId={m.id} origin={origin} />
        </section>

        <section className="sheet flex flex-col items-center p-5 text-center">
          <p className="font-semibold">QR code</p>
          <p className="mt-1 text-[0.875rem] text-ink-2">For your van, invoices, business cards or shop counter.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} alt={`QR code linking to ${p.displayName}'s Clutch profile`} className="mt-4 size-48" />
          <a href={qrDataUrl} download={`clutch-${m.slug}-qr.svg`} className="btn btn-quiet mt-4 min-h-11 text-sm">
            Download QR code
          </a>
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="heading text-[1.25rem]">Account status</h2>
        <Standing p={p} steps={steps} />
        <p className="field-label pt-3">Checklist</p>
        <ul className="grid gap-x-8 sm:grid-cols-2">
          {steps.map((st) => (
            <li key={st.label} className="flex items-start justify-between gap-3 border-b border-rule-soft py-2.5">
              <span className="flex items-start gap-2 text-[0.9375rem]">
                <Tick state={st.done ? "verified" : "blank"} size={15} className="mt-[3px] shrink-0" />
                <span>
                  <span className={st.done ? "text-ink-2" : "font-semibold"}>{st.label}</span>
                  {st.requiredForWork && !st.done ? <span className="ml-2 border border-ink px-1 text-[0.625rem] font-bold uppercase">Required for work</span> : null}
                  {!st.done ? <span className="block text-[0.8125rem] text-ink-2">{st.why}</span> : null}
                </span>
              </span>
              {!st.done ? (
                <Link href={st.href} className="text-[0.8125rem] font-semibold underline decoration-rule underline-offset-2">
                  Finish
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
