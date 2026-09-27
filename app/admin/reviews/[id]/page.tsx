import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Check, ExternalLink, FileText, MessageCircleQuestion, X } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getRepo } from "@/lib/data";
import { getSession, isStaff, needs } from "@/lib/session";
import { CATEGORY_LABEL, METHOD_LABEL, PROVENANCE, STATUS_LABEL, methodToProvenance } from "@/lib/domain/provenance";
import type { VerificationCategory } from "@/lib/domain/types";
import { screeningItems } from "@/lib/domain/eligibility";
import { effectiveStatus } from "@/lib/verification/lifecycle";
import { inQueue } from "@/lib/admin-queue";
import { docLink } from "@/lib/verification/doc-links";
import { verifierName } from "@/lib/verification/display";
import { reason, reasonsFor } from "@/lib/verification/reasons";
import { getMedia } from "@/lib/data/mock/media-store";
import { LifecycleError } from "@/lib/domain/transitions";
import type { ReviewAction } from "@/lib/data/repository";
import { dayMonth } from "@/lib/format";
import { SiteHeader } from "@/components/site/site-header";
import { NeedsPersona, Notice } from "@/components/workspace/ui";
import { PhotoPrint } from "@/components/profile/photo";
import { SafetyChips, VerdictChip } from "@/components/admin/verdict";

export const metadata: Metadata = { title: "Review evidence" };

/** What a reviewer checks before approving, per kind of evidence. */
const CHECKLIST: Record<VerificationCategory, string[]> = {
  email: ["Confirmed by the sign-in provider (no review needed)"],
  phone: ["Confirmed by a text-message code (no review needed)"],
  identity: ["Photo ID is valid and not expired", "Selfie matches the photo on the ID", "Name matches the account name"],
  background: ["FCRA consent is recorded", "Provider result is “clear”", "If “consider”: follow adverse-action steps before rejecting"],
  driving_record: ["Consent is recorded", "License is valid, with no suspension", "No major violations under Clutch policy"],
  insurance: [
    "The stored certificate is readable and complete",
    "Carrier, policy type and named insured on the certificate match what was entered",
    "Named insured is the mechanic or their business",
    "Effective and expiry dates match; the policy is active today",
    "Coverage fits mobile work at customers' locations",
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
  const status = effectiveStatus(v.status, v.expiresAt, new Date(), v.method);
  const reviewer = v.reviewerId ? repo.getUser(v.reviewerId)?.name : undefined;
  const mine = repo.listVerifications({ mechanicId: m.id });
  const others = mine.filter((x) => x.id !== v.id);
  const pendingForMechanic = mine.filter((x) => inQueue("queue", effectiveStatus(x.status, x.expiresAt, new Date(), x.method), x.method));
  const isSafety = ["identity", "background", "driving_record", "insurance"].includes(v.category);
  const publicAs = isSafety ? "an outcome status only (never the details)" : `“${PROVENANCE[methodToProvenance(v.method)].label}”`;
  // Started before a real screening provider was connected: nothing was checked, so it can't be approved.
  const unrun = repo.unrunScreening(v);
  const own = m.userId === s.userId;
  const providerDecided = v.method === "hosted_identity" || v.method === "vendor_screening" || v.method === "email_link" || v.method === "sms_code";
  const open = status === "submitted" || status === "under_review" || status === "needs_more_info";
  const revocable = (status === "verified" || status === "renewal_due") && !v.supersededBy;
  // Evidence files: only ones attached to THIS record and uploaded by THIS mechanic, each behind a
  // link bound to this reviewer that expires in minutes.
  const docs = (
    await Promise.all(
      (v.documentIds ?? []).map(async (docId) => {
        const d = await getMedia(repo.scope, docId);
        return d && d.ownerId === m.userId && d.meta.tag === "verification_doc" ? { id: docId, name: d.meta.name, kind: d.meta.kind, href: docLink(docId, s.userId) } : null;
      }),
    )
  ).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const ins = v.category === "insurance" ? repo.getMechanicSources(m.id).insurance.find((x) => x.id === v.subjectId) : undefined;
  const conflicts = [
    v.legacy?.unbacked ? "Approved before documents were kept: only a file name was recorded. It doesn't count publicly until resubmitted." : "",
    v.legacy && !v.legacy.unbacked ? `Legacy record: ${v.legacy.note}` : "",
    v.nameMatches === false ? "The name on the ID doesn't match the account name." : "",
    ins && ins.effectiveOn && ins.expiresOn && ins.expiresOn <= ins.effectiveOn ? "The expiry date is on or before the effective date." : "",
    ins && ins.expiresOn && ins.expiresOn < new Date().toISOString().slice(0, 10) ? "The policy's expiry date has passed." : "",
    ins && !ins.namedInsured ? "No named insured was recorded (older submission)." : "",
    (v.category === "insurance" || (v.method === "document_review" && (v.category === "credential" || v.category === "past_repair"))) && !docs.length ? "No stored document. Request more information; a file name alone can't be approved." : "",
    ...others.filter((o) => o.category === v.category && !o.supersededBy && o.id !== v.supersedes && ["submitted", "under_review", "in_progress"].includes(o.status)).map((o) => `Another ${CATEGORY_LABEL[o.category].toLowerCase()} submission is also open (${o.id}).`),
  ].filter(Boolean);
  const who = (a?: { kind: string; id: string }) => (!a ? "" : a.kind === "staff" ? (repo.getUser(a.id)?.name ?? "Staff") : a.kind === "provider" ? verifierName(a.id.split(":")[0], v.method) : a.kind === "mechanic" ? m.displayName : a.kind === "customer" ? "The prior customer" : "Clutch (automatic)");

  async function decide(formData: FormData) {
    "use server";
    const action = String(formData.get("action")) as ReviewAction;
    const s2 = await getSession();
    if (!isStaff(s2)) return;
    // This action runs in its own request: read through that request's repository.
    const repo = await getRepo();
    await (await needs(s2)).verificationReview(id);
    const mechanicId = String(formData.get("mechanicId") ?? "");
    try {
      await repo.decideVerification(id, action, s2.userId, {
        reasonCode: String(formData.get("reasonCode") ?? ""),
        note: String(formData.get("note") ?? ""),
        expiresAt: String(formData.get("expiresAt") ?? "") || undefined,
      });
    } catch (e) {
      if (e instanceof LifecycleError || e instanceof Error) redirect(`/admin/reviews/${id}?err=${encodeURIComponent(e.message)}#decision`);
      throw e;
    }
    revalidatePath("/admin");
    // Keep going: this mechanic's next item, then the oldest in the queue (looked up, not loaded).
    const next = await repo.nextPendingVerification(id, mechanicId, new Date().toISOString());
    redirect(next ? `/admin/reviews/${next}?done=${action}` : `/admin?f=queue&done=${action}`);
  }

  const DONE: Record<string, { cls: string; icon: typeof Check; text: string }> = {
    approve: { cls: "border-go bg-go-wash text-go", icon: Check, text: "Approved. Here's the next item." },
    reject: { cls: "border-alert bg-alert-wash text-alert", icon: X, text: "Rejected. Here's the next item." },
    request_info: { cls: "border-brand-tint bg-brand-wash text-brand-deep", icon: MessageCircleQuestion, text: "Sent back to the mechanic. Here's the next item." },
    revoke: { cls: "border-alert bg-alert-wash text-alert", icon: X, text: "Revoked. Here's the next item." },
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
              {docs.length ? (
                <ul className="border-t border-brass/40 px-4 py-2">
                  {docs.map((d) => (
                    <li key={d.id} className="py-1">
                      <a href={d.href} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center gap-2 font-semibold underline decoration-rule underline-offset-2">
                        <FileText size={16} aria-hidden /> Open {d.name} <span className="font-normal text-ink-3">(private link, expires in 5 minutes)</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {conflicts.length ? (
              <Notice tone="warn">
                <p className="font-semibold">Check before deciding</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[0.9375rem]">
                  {conflicts.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </Notice>
            ) : null}

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
                ["Checked by", verifierName(v.provider, v.method)],
                ["Expires", dayMonth(v.expiresAt) || "No expiry"],
                ["Decided", dayMonth(v.reviewedAt ?? v.verifiedAt) || "–"],
                ["Reviewer", reviewer ?? "–"],
              ].map(([k, val]) => (
                <div key={k} className="bg-sheet px-3 py-2.5">
                  <dt className="field-label">{k}</dt>
                  <dd className="mt-0.5 text-[0.9375rem]">{val}</dd>
                </div>
              ))}
            </dl>
            <div>
              <h2 className="heading text-[1.0625rem]">History</h2>
              <ol className="mt-2 divide-y divide-rule-soft border-y border-rule text-[0.9375rem]">
                {(v.events ?? []).map((e, i) => (
                  <li key={i} className="grid gap-0.5 py-2 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
                    <span className="tnum text-ink-3">{e.at.slice(0, 16).replace("T", " ")}</span>
                    <span>
                      <span className="font-semibold">{e.action.replace(/_/g, " ")}</span>
                      {e.to !== e.from ? <span className="text-ink-2"> → {STATUS_LABEL[e.to].toLowerCase()}</span> : null}
                      <span className="text-ink-2"> · {who(e.actor)}</span>
                      {e.reasonCodes?.length ? <span className="block text-[0.8125rem] text-ink-2">Reason: {e.reasonCodes.map((c) => reason(c)?.label ?? c).join(", ")}</span> : null}
                      {e.note ? <span className="block text-[0.8125rem] text-ink-2">{e.note}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
              {v.supersedes || v.supersededBy ? (
                <p className="mt-2 text-[0.875rem] text-ink-2">
                  {v.supersedes ? <>Replaces <Link className="underline" href={`/admin/reviews/${v.supersedes}`}>an earlier submission</Link>. </> : null}
                  {v.supersededBy ? <>Replaced by <Link className="underline" href={`/admin/reviews/${v.supersededBy}`}>a newer submission</Link>.</> : null}
                </p>
              ) : null}
            </div>

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
            {sp.err ? <Notice tone="error">{sp.err}</Notice> : null}
            {own ? (
              <Notice tone="warn">This is your own record. Someone else on staff has to review it.</Notice>
            ) : providerDecided && !revocable ? (
              <Notice>{verifierName(v.provider, v.method)} decides this check; staff can&apos;t approve or reject it by hand. If it&apos;s verified, you can revoke it.</Notice>
            ) : !open && !revocable ? (
              <Notice>This record is closed ({STATUS_LABEL[status].toLowerCase()}). A resubmission arrives as a new record.</Notice>
            ) : (
              <form action={decide} className="mt-3 space-y-4 border-2 border-ink bg-sheet p-4">
                <input type="hidden" name="mechanicId" value={m.id} />
                <p className="heading text-[1.25rem]">{revocable ? "Revoke this verification" : "Your decision"}</p>
                <fieldset className="space-y-1.5">
                  <legend className="field-label">Action</legend>
                  {(revocable
                    ? ([["revoke", "Revoke (it stops counting at once)"]] as const)
                    : ([
                        ...(unrun ? [] : ([["approve", "Approve"]] as const)),
                        ["request_info", "Ask for more information"],
                        ["reject", "Reject"],
                      ] as const)
                  ).map(([val, label], i2) => (
                    <label key={val} className="flex min-h-11 cursor-pointer items-center gap-3 border border-rule-soft px-3 has-[:checked]:border-ink">
                      <input type="radio" name="action" value={val} required defaultChecked={i2 === 0 && revocable} /> {label}
                    </label>
                  ))}
                </fieldset>
                <label className="block">
                  <span className="field-label">Reason (required)</span>
                  <select name="reasonCode" required defaultValue="" className="input mt-1">
                    <option value="" disabled>
                      Choose a reason
                    </option>
                    {(revocable ? reasonsFor("revoke") : [...reasonsFor("approve"), ...reasonsFor("request_info"), ...reasonsFor("reject")])
                      .filter((r, i2, a) => a.findIndex((x) => x.code === r.code) === i2)
                      .map((r) => (
                        <option key={r.code} value={r.code}>
                          {r.label} ({r.for.filter((f) => f !== "provider").join(" / ").replace(/_/g, " ")})
                        </option>
                      ))}
                  </select>
                </label>
                <label className="block">
                  <span className="field-label">Note to {m.firstName}</span>
                  <textarea name="note" rows={3} className="input mt-1" placeholder={`Required for anything but approval. ${m.firstName} sees it.`} />
                </label>
                {!revocable ? (
                  <label className="block">
                    <span className="field-label">Valid until</span>
                    <input name="expiresAt" type="date" defaultValue={(ins?.expiresOn ?? v.expiresAt)?.slice(0, 10)} className="input mt-1" />
                    <span className="mt-1 block text-[0.75rem] text-ink-3">Insurance uses the policy&apos;s expiry date.</span>
                  </label>
                ) : null}
                {unrun ? (
                  <p className="border border-amber/50 bg-amber-wash px-3 py-2 text-[0.875rem]">No screening provider ran this check, so it can&apos;t be approved.</p>
                ) : null}
                <button className="btn btn-ink min-h-12 w-full">Record decision</button>
                <p className="text-[0.75rem] text-ink-3">Every decision is added to the record&apos;s history with your name. It shows publicly as {publicAs}.</p>
              </form>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}
