import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Check, ExternalLink, FileText, MessageCircleQuestion, X } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getRepo } from "@/lib/data";
import { getSession, isStaff, needs } from "@/lib/session";
import { CATEGORY_LABEL, METHOD_LABEL, PROVENANCE, methodToProvenance } from "@/lib/domain/provenance";
import type { VerificationCategory } from "@/lib/domain/types";
import { screeningItems } from "@/lib/domain/eligibility";
import { effectiveStatus } from "@/lib/verification/lifecycle";
import { dayMonth } from "@/lib/format";
import { SiteHeader } from "@/components/site/site-header";
import { NeedsPersona, Notice } from "@/components/workspace/ui";
import { PhotoPrint } from "@/components/profile/photo";
import { SafetyChips, VerdictChip } from "@/components/admin/verdict";

export const metadata: Metadata = { title: "Review evidence" };

/** What a reviewer checks before approving, per kind of evidence. */
const CHECKLIST: Record<VerificationCategory, string[]> = {
  identity: ["Photo ID is valid and not expired", "Selfie matches the photo on the ID", "Name matches the account name"],
  background: ["FCRA consent is recorded", "Provider result is “clear”", "If “consider”: follow adverse-action steps before rejecting"],
  driving_record: ["Consent is recorded", "License is valid, with no suspension", "No major violations under Clutch policy"],
  insurance: [
    "Named insured matches the mechanic or their business",
    "Policy is active today",
    "Coverage fits mobile work at customers' locations",
    "Set “Valid until” to the policy end date",
  ],
  credential: ["Issuer and code match the document", "Name on it matches the mechanic", "Not expired: set “Valid until”", "Confirmed with the issuer where possible"],
  employment: ["Employer and role match the claim", "Dates line up", "Confirmed with the shop, or a letter on letterhead"],
  past_repair: ["Vehicle and repair match the record", "Invoice or photo shows the work", "Customer confirmed, or the document names the mechanic"],
};

export default async function ReviewDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string; err?: string }> }) {
  const repo = await getRepo();
  const s = await getSession();
  if (!isStaff(s))
    return (
      <>
        <SiteHeader />
        <NeedsPersona role="admin" />
      </>
    );
  const { id } = await params;
  const sp = await searchParams;
  await (await needs(s)).verificationReview(id);
  const v = repo.getVerification(id);
  if (!v) notFound();
  const m = repo.getMechanic(v.mechanicId)!;
  const pub = repo.getPublicProfile(m.slug);
  const subject = repo.describeSubject(v);
  const status = effectiveStatus(v.status, v.expiresAt);
  const reviewer = v.reviewerId ? repo.getUser(v.reviewerId)?.name : undefined;
  const mine = repo.listVerifications({ mechanicId: m.id });
  const others = mine.filter((x) => x.id !== v.id);
  const pendingForMechanic = mine.filter((x) => effectiveStatus(x.status, x.expiresAt) === "pending");
  const isSafety = ["identity", "background", "driving_record", "insurance"].includes(v.category);
  const publicAs = isSafety ? "an outcome status only (never the details)" : `“${PROVENANCE[methodToProvenance(v.method)].label}”`;
  const decided = status === "verified" || status === "rejected";
  // Started before a real screening provider was connected: nothing was checked, so it can't be approved.
  const unrun = repo.unrunScreening(v);

  async function decide(formData: FormData) {
    "use server";
    const decision = String(formData.get("decision")) as "verified" | "rejected" | "needs_info";
    const s2 = await getSession();
    if (!isStaff(s2)) return;
    // This action runs in its own request: read through that request's repository.
    const repo = await getRepo();
    const mechanicId = String(formData.get("mechanicId") ?? "");
    const notes = String(formData.get("notes") ?? "").trim();
    // The mechanic needs to know why: a reason is required for anything but approval.
    if (decision !== "verified" && !notes) redirect(`/admin/reviews/${id}?err=notes#decision`);
    await repo.decideVerification(id, decision, s2.userId, notes, String(formData.get("expiresAt") ?? "") || undefined);
    revalidatePath("/admin");
    // Keep going: this mechanic's next item, then the oldest in the queue (looked up, not loaded).
    const next = await repo.nextPendingVerification(id, mechanicId, new Date().toISOString());
    redirect(next ? `/admin/reviews/${next}?done=${decision}` : `/admin?f=queue&done=${decision}`);
  }

  const DONE: Record<string, { cls: string; icon: typeof Check; text: string }> = {
    verified: { cls: "border-go bg-go-wash text-go", icon: Check, text: "Approved. Here's the next item." },
    rejected: { cls: "border-alert bg-alert-wash text-alert", icon: X, text: "Rejected. Here's the next item." },
    needs_info: { cls: "border-brand-tint bg-brand-wash text-brand-deep", icon: MessageCircleQuestion, text: "Sent back to the mechanic. Here's the next item." },
  };
  const done = sp.done ? DONE[sp.done] : undefined;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1100px] space-y-6 px-4 pt-8 pb-24 sm:px-6">
        <Link href="/admin?f=queue" className="inline-flex items-center gap-1.5 text-[0.875rem] text-ink-3 hover:text-ink">
          <ArrowLeft size={14} aria-hidden /> Queue
        </Link>
        {done ? (
          <p role="status" className={`flex items-center gap-2 border-2 px-4 py-3 font-bold ${done.cls}`}>
            <done.icon size={20} strokeWidth={3} aria-hidden /> {done.text}
          </p>
        ) : null}

        {/* Who */}
        <section aria-label="Mechanic" className="flex flex-wrap items-center gap-4 border-2 border-rule bg-sheet p-4">
          {pub ? <PhotoPrint photoUrl={pub.photoUrl} initials={pub.initials} name={pub.displayName} size={64} /> : null}
          <div className="min-w-0 flex-1">
            <p className="heading text-[1.375rem]">{m.displayName}</p>
            <p className="text-[0.875rem] text-ink-2">
              {pendingForMechanic.length ? `${pendingForMechanic.length} item${pendingForMechanic.length > 1 ? "s" : ""} waiting for review` : "Nothing else waiting"} ·{" "}
              <Link href={`/mechanics/${m.slug}`} className="inline-flex items-center gap-1 underline decoration-rule underline-offset-2">
                Public profile <ExternalLink size={12} aria-hidden />
              </Link>
            </p>
          </div>
          {pub ? <SafetyChips items={screeningItems(pub)} /> : null}
        </section>

        {/* What */}
        <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-ink pb-4">
          <div>
            <p className="field-label">{CATEGORY_LABEL[v.category]} · {METHOD_LABEL[v.method]}</p>
            <h1 className="display mt-1 text-[1.75rem] sm:text-[2.25rem]">{subject.title}</h1>
          </div>
          <VerdictChip status={status} big />
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="space-y-6">
            <div className="border-2 border-brass bg-brass-wash/50">
              <p className="flex items-center gap-2 border-b border-brass/40 px-4 py-2 font-bold">
                <FileText size={17} aria-hidden /> Submitted evidence <span className="font-normal text-ink-2">· private, never shown publicly</span>
              </p>
              <ul className="px-4">
                {subject.detail.map((d) => (
                  <li key={d} className="border-b border-brass/25 py-2.5 text-[1rem] last:border-b-0">
                    {d}
                  </li>
                ))}
                {v.evidenceSummary ? <li className="py-2.5 text-[1rem] text-ink-2">{v.evidenceSummary}</li> : null}
              </ul>
            </div>

            <fieldset className="border border-rule bg-sheet p-4">
              <legend className="px-1 font-bold">Check before approving</legend>
              <ul className="space-y-2">
                {CHECKLIST[v.category].map((c) => (
                  <li key={c}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 border border-rule-soft px-3 py-2 has-[:checked]:border-go has-[:checked]:bg-go-wash">
                      <input type="checkbox" className="size-5 accent-[var(--go)]" />
                      <span className="text-[0.9375rem]">{c}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[0.8125rem] text-ink-3">If approved, it shows publicly as {publicAs}.</p>
            </fieldset>

            <dl className="grid grid-cols-2 gap-px border border-rule bg-rule-soft sm:grid-cols-3">
              {[
                ["Submitted", dayMonth(v.submittedAt) || "–"],
                ["Method", METHOD_LABEL[v.method]],
                ["Provider", v.provider ?? "–"],
                ["Expires", dayMonth(v.expiresAt) || "No expiry"],
                ["Decided", dayMonth(v.verifiedAt) || "–"],
                ["Reviewer", reviewer ?? "–"],
              ].map(([k, val]) => (
                <div key={k} className="bg-sheet px-3 py-2.5">
                  <dt className="field-label">{k}</dt>
                  <dd className="mt-0.5 text-[0.9375rem]">{val}</dd>
                </div>
              ))}
            </dl>
            {v.notes ? (
              <Notice tone="ok">
                <p className="field-label">Notes</p>
                <p className="mt-1 text-[0.9375rem]">{v.notes}</p>
              </Notice>
            ) : null}

            {others.length ? (
              <div>
                <h2 className="heading text-[1.0625rem]">Everything else for {m.firstName}</h2>
                <ul className="mt-2 divide-y divide-rule-soft border-y border-rule">
                  {others.map((o) => (
                    <li key={o.id}>
                      <Link href={`/admin/reviews/${o.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:bg-sheet">
                        <span className="min-w-0 text-[0.9375rem]">
                          <span className="font-semibold">{CATEGORY_LABEL[o.category]}</span>
                          <span className="text-ink-2"> · {o.evidenceSummary?.slice(0, 60)}</span>
                        </span>
                        <VerdictChip status={effectiveStatus(o.status, o.expiresAt)} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          {/* Decide */}
          <aside id="decision" className="scroll-mt-20 lg:sticky lg:top-20 lg:self-start">
            {v.method === "customer_confirmation" && v.status === "pending" ? (
              <Notice>Waiting for the prior customer to respond to their link. You can still decide if needed.</Notice>
            ) : null}
            <form action={decide} className="mt-3 space-y-4 border-2 border-ink bg-sheet p-4">
              <input type="hidden" name="mechanicId" value={m.id} />
              <p className="heading text-[1.25rem]">{decided ? "Change the decision" : "Your decision"}</p>
              {sp.err === "notes" ? (
                <p role="alert" className="border-2 border-alert bg-alert-wash px-3 py-2 text-[0.875rem] font-semibold text-alert">
                  Add a reason so {m.firstName} knows what to fix.
                </p>
              ) : null}
              <label className="block">
                <span className="field-label">Reason or note</span>
                <textarea name="notes" rows={3} className="input mt-1" placeholder={`Required to reject or ask for more. Shown to ${m.firstName}.`} />
              </label>
              <label className="block">
                <span className="field-label">Valid until</span>
                <input name="expiresAt" type="date" defaultValue={v.expiresAt?.slice(0, 10)} className="input mt-1" />
                <span className="mt-1 block text-[0.75rem] text-ink-3">For certifications, insurance and screenings.</span>
              </label>
              <div className="grid gap-2.5">
                {unrun ? (
                  <p className="border-2 border-amber bg-amber-wash px-3 py-2 text-[0.875rem]">
                    No screening provider ran this check, so it can&apos;t be approved. Ask {m.firstName} to run it again once screening opens, or reject it.
                  </p>
                ) : (
                  <button name="decision" value="verified" className="flex min-h-14 items-center justify-center gap-2 border-2 border-go bg-go text-[1.0625rem] font-bold text-white hover:brightness-110">
                    <Check size={22} strokeWidth={3} aria-hidden /> Approve
                  </button>
                )}
                <button name="decision" value="needs_info" className="flex min-h-12 items-center justify-center gap-2 border-2 border-amber bg-amber-wash font-bold text-amber hover:brightness-95">
                  <MessageCircleQuestion size={19} aria-hidden /> Ask for more info
                </button>
                <button name="decision" value="rejected" className="flex min-h-14 items-center justify-center gap-2 border-2 border-alert bg-alert-wash text-[1.0625rem] font-bold text-alert hover:bg-alert hover:text-white">
                  <X size={22} strokeWidth={3} aria-hidden /> Reject
                </button>
              </div>
            </form>
          </aside>
        </div>
      </main>
    </>
  );
}
