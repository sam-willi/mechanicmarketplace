import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ready, repo } from "@/lib/data";
import { getSession } from "@/lib/session";
import { CATEGORY_LABEL, METHOD_LABEL, PROVENANCE, methodToProvenance } from "@/lib/domain/provenance";
import { effectiveStatus } from "@/lib/verification/lifecycle";
import { dayMonth } from "@/lib/format";
import { SiteHeader } from "@/components/site/site-header";
import { Field, NeedsPersona, Notice, StatusPill } from "@/components/workspace/ui";

export const metadata: Metadata = { title: "Review evidence" };

export default async function ReviewDetail({ params }: { params: Promise<{ id: string }> }) {
  await ready();
  const s = await getSession();
  if (s.role !== "admin")
    return (
      <>
        <SiteHeader />
        <NeedsPersona role="admin" />
      </>
    );
  const { id } = await params;
  const v = repo.getVerification(id);
  if (!v) notFound();
  const m = repo.getMechanic(v.mechanicId)!;
  const subject = repo.describeSubject(v);
  const status = effectiveStatus(v.status, v.expiresAt);
  const reviewer = v.reviewerId ? repo.getUser(v.reviewerId)?.name : undefined;
  const others = repo.listVerifications({ mechanicId: m.id }).filter((x) => x.id !== v.id).slice(0, 8);
  const isSafety = ["identity", "background", "driving_record", "insurance"].includes(v.category);
  const publicAs = isSafety ? "an outcome status only" : `“${PROVENANCE[methodToProvenance(v.method)].label}”`;

  async function decide(formData: FormData) {
    "use server";
    const decision = String(formData.get("decision")) as "verified" | "rejected" | "needs_info";
    const s2 = await getSession();
    if (s2.role !== "admin") return;
    await repo.decideVerification(id, decision, s2.userId, String(formData.get("notes") ?? ""), String(formData.get("expiresAt") ?? "") || undefined);
    revalidatePath("/admin");
    redirect("/admin?f=queue");
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1100px] space-y-8 px-4 pt-8 pb-24 sm:px-6">
        <Link href="/admin" className="inline-flex items-center gap-1.5 text-[0.875rem] text-ink-3 hover:text-ink">
          <ArrowLeft size={14} aria-hidden /> Queue
        </Link>
        <div className="border-b-2 border-ink pb-4">
          <p className="text-ink-2">
            {m.displayName} · {CATEGORY_LABEL[v.category]}
          </p>
          <h1 className="display mt-1 text-[1.75rem] sm:text-[2.25rem]">{subject.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <StatusPill status={status} />
            <span className="text-[0.875rem] text-ink-3">If approved, shows publicly as {publicAs}</span>
          </div>
        </div>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="space-y-6">
            <div>
              <p className="field-label">Submitted evidence · private</p>
              <ul className="mt-2 border-t border-rule">
                {subject.detail.map((d) => (
                  <li key={d} className="border-b border-rule-soft py-2.5 text-[0.9375rem]">
                    {d}
                  </li>
                ))}
                {v.evidenceSummary ? <li className="border-b border-rule-soft py-2.5 text-[0.9375rem] text-ink-2">{v.evidenceSummary}</li> : null}
              </ul>
              <p className="mt-2 text-[0.8125rem] text-ink-3">Demo: documents are represented by file names. No files are stored.</p>
            </div>
            <dl className="grid grid-cols-2 border-t border-rule sm:grid-cols-3">
              {[
                ["Method", METHOD_LABEL[v.method]],
                ["Provider", v.provider ?? "—"],
                ["Submitted", dayMonth(v.submittedAt) || "—"],
                ["Verified", dayMonth(v.verifiedAt) || "—"],
                ["Expires", dayMonth(v.expiresAt) || "No expiry"],
                ["Reviewer", reviewer ?? "—"],
              ].map(([k, val]) => (
                <div key={k} className="border-b border-rule-soft py-2.5 pr-3">
                  <dt className="field-label">{k}</dt>
                  <dd className="mt-0.5 text-[0.9375rem]">{val}</dd>
                </div>
              ))}
            </dl>
            {v.notes ? (
              <div>
                <p className="field-label">Notes</p>
                <p className="mt-1 text-[0.9375rem] text-ink-2">{v.notes}</p>
              </div>
            ) : null}
            <div>
              <p className="field-label">Other items for {m.firstName}</p>
              <ul className="mt-2 border-t border-rule">
                {others.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 border-b border-rule-soft py-2 text-[0.875rem]">
                    <Link href={`/admin/reviews/${o.id}`} className="text-ink-2 hover:text-ink">
                      {CATEGORY_LABEL[o.category]} · {o.evidenceSummary?.slice(0, 60)}
                    </Link>
                    <StatusPill status={effectiveStatus(o.status, o.expiresAt)} />
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <aside>
            {v.method === "customer_confirmation" && v.status === "pending" ? (
              <Notice>Waiting for the prior customer to respond to their confirmation link. Reviewers can still decide below if needed.</Notice>
            ) : null}
            <form action={decide} className="sheet mt-3 space-y-3 p-4">
              <p className="heading text-[1.125rem]">Decision</p>
              <Field label="Notes (shown to the mechanic on rejection or info request)">
                <textarea name="notes" rows={3} className="input" />
              </Field>
              <Field label="Valid until" hint="Set for certifications, insurance and screenings.">
                <input name="expiresAt" type="date" defaultValue={v.expiresAt?.slice(0, 10)} className="input" />
              </Field>
              <div className="grid gap-2">
                <button name="decision" value="verified" className="btn btn-ink">
                  Approve
                </button>
                <button name="decision" value="needs_info" className="btn btn-quiet">
                  Request more information
                </button>
                <button name="decision" value="rejected" className="btn btn-quiet text-alert">
                  Reject
                </button>
              </div>
            </form>
          </aside>
        </div>
      </main>
    </>
  );
}
