import type { Metadata } from "next";
import Link from "next/link";
import { getRepo } from "@/lib/data";
import { getSession, needs } from "@/lib/session";
import { toPublicProfile } from "@/lib/domain/public-profile";
import { METHOD_LABEL, PROVENANCE, SAFETY } from "@/lib/domain/provenance";
import { methodToProvenance } from "@/lib/domain/provenance";
import { effectiveStatus } from "@/lib/verification/lifecycle";
import type { ScreeningKind, VerificationRecord } from "@/lib/domain/types";
import { monthYear } from "@/lib/format";
import { screeningOpen } from "@/lib/verification/providers/registry";
import {
  refreshScreening,
  resubmitVerification,
  startScreening,
  submitCredential,
  submitEmployment,
  submitInsurance,
} from "@/app/actions/mechanic";
import { Field, NeedsPersona, Notice, PageTitle, StatusPill } from "@/components/workspace/ui";

export const metadata: Metadata = { title: "Verification Center" };

export default async function VerificationCenter({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "mechanic") return <NeedsPersona role="mechanic" />;
  await (await needs(s)).ownSources();
  const sp = await searchParams;
  const src = repo.getMechanicSources(s.mechanicId);
  const pub = toPublicProfile(src);
  const vers = repo.listVerifications({ mechanicId: s.mechanicId });
  const latestFor = (cat: VerificationRecord["category"]) =>
    vers.filter((v) => v.category === cat).sort((a, b) => ((a.submittedAt ?? "") < (b.submittedAt ?? "") ? 1 : -1))[0];
  const ver = (subjectId: string) => vers.find((v) => v.subjectId === subjectId);
  const eff = (v?: VerificationRecord) => (v ? effectiveStatus(v.status, v.expiresAt) : "not_submitted");

  const safetyRows: { kind: ScreeningKind | "insurance"; v?: VerificationRecord; applies: boolean }[] = [
    { kind: "identity", v: latestFor("identity"), applies: true },
    { kind: "background", v: latestFor("background"), applies: true },
    { kind: "driving_record", v: latestFor("driving_record"), applies: true },
    { kind: "insurance", v: latestFor("insurance"), applies: true },
  ];

  const tracked = vers.filter((v) => v.category !== "past_repair");
  const totalItems = tracked.length + (safetyRows.filter((r) => r.applies && !r.v).length);
  const verifiedCount = tracked.filter((v) => ["verified", "reverification_required"].includes(effectiveStatus(v.status, v.expiresAt))).length;
  const skillVerified =
    pub.credentials.filter((c) => c.provenance !== "self").length + pub.employment.filter((e) => e.provenance !== "self").length + pub.reputation.verifiedRepairs;

  return (
    <div className="space-y-12">
      <PageTitle
        title="Verification Center"
        note="Verification checks aren't required to be booked: customers see each one's status, and verified checks improve your ranking. Proven experience makes you stand out."
        action={
          <Link href={`/mechanics/${src.mechanic.slug}`} className="btn btn-quiet min-h-11 text-sm">
            See your public profile
          </Link>
        }
      />
      <section className="grid gap-5 border border-ink p-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
        <div>
          <p className="num text-[2.5rem]">{verifiedCount}/{totalItems}</p>
          <p className="text-[0.875rem] text-ink-2">items verified</p>
        </div>
        <div>
          <p className="font-bold">Complete verification to build customer trust.</p>
          <p className="mt-1 text-[0.9375rem] text-ink-2">
            Customers see a check for each thing you prove, and nothing else: never your documents or screening reports.{" "}
            None of these checks is required to send estimates or be booked. Customers see each one&apos;s status, and fully verified mechanics rank higher at equal experience.
          </p>
        </div>
      </section>
      {sp.welcome ? (
        <Notice tone="ok">
          Your profile is live at <span className="tnum font-semibold">/mechanics/{src.mechanic.slug}</span>. Everything you entered shows as self-reported until
          it&apos;s verified. Start with identity and background below, then add proof of your work.
        </Notice>
      ) : null}

      {/* SAFETY TRACK */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="heading text-[1.375rem]">Verification checks</h2>
          <p className="text-[0.8125rem] text-ink-3">Customers see only the outcome, never your documents or reports.</p>
        </div>
        <ul className="border-t border-rule">
          {safetyRows
            .filter((r) => r.applies)
            .map(({ kind, v }) => {
              const status = eff(v);
              const info = SAFETY[kind];
              const canStart = kind !== "insurance" && (status === "not_submitted" || status === "expired" || status === "reverification_required" || status === "rejected");
              const pendingMock = kind !== "insurance" && v?.status === "pending" && v.method === "vendor_screening";
              // Real mechanics: only when a real screening provider is connected for this kind.
              const closed = kind !== "insurance" && !screeningOpen(kind, repo.scope) && status !== "verified";
              return (
                <li key={kind} className="grid gap-3 border-b border-rule-soft py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:gap-8">
                  <div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <p className="font-semibold text-ink">{kind === "identity" || kind === "insurance" ? info.shortLabel : `${info.shortLabel} check`}</p>
                      {status !== "verified" && status !== "reverification_required" ? <span className="border border-ink px-1 text-[0.6875rem] font-bold uppercase">Required for work</span> : null}
                      <StatusPill status={status} />
                    </div>
                    <p className="mt-1 text-[0.875rem] text-ink-2">
                      {v?.verifiedAt ? `Verified ${monthYear(v.verifiedAt)}` : v?.submittedAt ? `Submitted ${monthYear(v.submittedAt)}` : "Not started"}
                      {v?.expiresAt ? ` · ${status === "expired" ? "expired" : kind === "insurance" ? "policy valid to" : "rescreen due"} ${monthYear(v.expiresAt)}` : ""}
                    </p>
                    {v?.provider ? <p className="mt-0.5 text-[0.8125rem] text-ink-3">Screening provider: {v.provider === "mock" ? "Mock provider (demo)" : v.provider}</p> : null}
                    {v?.notes && (status === "needs_info" || status === "rejected") ? <p className="mt-2 text-[0.875rem] text-amber">Reviewer: {v.notes}</p> : null}
                  </div>
                  <div>
                    {kind === "insurance" ? (
                      status === "verified" ? (
                        <p className="text-[0.875rem] text-ink-3">Upload your renewed certificate before it expires to stay verified.</p>
                      ) : status === "pending" ? (
                        <p className="text-[0.875rem] text-ink-3">A Clutch reviewer is checking your certificate.</p>
                      ) : (
                        <form action={submitInsurance} className="grid gap-2 sm:grid-cols-2">
                          <Field label="Insurance carrier">
                            <input name="carrier" required className="input" placeholder="Carrier name" />
                          </Field>
                          <Field label="Policy expires">
                            <input name="expiresOn" type="date" required className="input" />
                          </Field>
                          <Field label="Certificate of insurance" className="sm:col-span-2">
                            <input name="document" type="file" accept=".pdf,image/*" className="block w-full text-[0.875rem]" />
                          </Field>
                          <button className="btn btn-ink sm:col-span-2 sm:justify-self-start">
                            {status === "expired" || status === "reverification_required" ? "Upload renewal" : "Submit for review"}
                          </button>
                        </form>
                      )
                    ) : closed ? (
                      <p className="border-l border-rule pl-3 text-[0.875rem] text-ink-2">
                        <span className="font-semibold text-ink">Opens soon.</span> Clutch is connecting an independent screening company. Until then no one can complete
                        this check. Customers see it as {v?.status === "pending" ? "could not be verified" : "not completed"}, and you can still be booked once your profile is complete.{" "}
                        {v?.status === "pending" ? "The check you started earlier will need to be run again then." : ""}
                      </p>
                    ) : pendingMock ? (
                      <form action={refreshScreening.bind(null, kind)} className="flex flex-wrap items-center gap-3">
                        <p className="text-[0.875rem] text-ink-2">Waiting on the screening provider.</p>
                        <button className="btn btn-quiet min-h-11 text-sm">Check for result (demo)</button>
                      </form>
                    ) : canStart ? (
                      <form action={startScreening.bind(null, kind)} className="space-y-2">
                        {kind === "identity" ? (
                          <p className="text-[0.875rem] text-ink-2">You&apos;ll photograph a government ID and take a live selfie with our identity provider.</p>
                        ) : (
                          <label className="flex items-start gap-2 text-[0.875rem] text-ink-2">
                            <input type="checkbox" name="consent" required className="mt-1 accent-[var(--carbon)]" />
                            <span>
                              I&apos;ve read the disclosure and authorize a {kind === "background" ? "background" : "motor vehicle record"} check by a consumer reporting agency.
                            </span>
                          </label>
                        )}
                        <button className="btn btn-ink min-h-11 text-sm">
                          {status === "not_submitted" ? `Start ${kind === "identity" ? "identity verification" : "check"}` : "Re-run check"}
                        </button>
                      </form>
                    ) : status === "verified" ? (
                      <p className="text-[0.875rem] text-ink-3">Nothing to do. Clutch will ask you to rescreen before it expires.</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
        </ul>
      </section>

      {/* SKILL TRACK */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="heading text-[1.375rem]">Proven experience</h2>
          <p className="text-[0.8125rem] text-ink-3">{skillVerified} verified items on your profile</p>
        </div>

        <div className="space-y-3">
          <h3 className="field-label">Certifications</h3>
          <ul className="border-t border-rule">
            {src.credentials.map((c) => {
              const v = ver(c.id);
              const status = eff(v);
              return (
                <li key={c.id} className="grid gap-2 border-b border-rule-soft py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div>
                    <p className="font-semibold text-ink">
                      {c.issuer} {c.code} <span className="font-normal text-ink-2">· {c.name}</span>
                    </p>
                    <p className="text-[0.8125rem] text-ink-3">
                      {v ? `${METHOD_LABEL[v.method]}` : ""}
                      {status === "verified" && v ? ` → shows as ${PROVENANCE[methodToProvenance(v.method)].label}` : ""}
                      {c.expiresOn ? ` · expires ${monthYear(c.expiresOn)}` : ""}
                    </p>
                    {v?.notes && status === "needs_info" ? <p className="mt-1 text-[0.875rem] text-amber">Reviewer: {v.notes}</p> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <StatusPill status={status} />
                    {v && (status === "needs_info" || status === "rejected" || status === "expired") && (
                      <form action={resubmitVerification.bind(null, v.id)} className="flex gap-2">
                        <input name="note" placeholder="What changed?" className="input min-h-11 w-44 py-1 text-sm" />
                        <button className="btn btn-quiet min-h-11 text-sm">Resubmit</button>
                      </form>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <details className="group">
            <summary className="btn btn-quiet min-h-11 cursor-pointer list-none text-sm [&::-webkit-details-marker]:hidden">Add a certification</summary>
            <form action={submitCredential} className="sheet mt-3 grid gap-3 p-4 sm:grid-cols-4">
              <Field label="Issuer">
                <select name="issuer" className="input" defaultValue="ASE">
                  {["ASE", "EPA", "BMW Group", "Mercedes-Benz", "Toyota", "Honda", "Ford", "GM", "I-CAR", "Other"].map((i) => (
                    <option key={i}>{i}</option>
                  ))}
                </select>
              </Field>
              <Field label="Code">
                <input name="code" className="input" placeholder="A5" />
              </Field>
              <Field label="Name" className="sm:col-span-2">
                <input name="name" required className="input" placeholder="Brakes" />
              </Field>
              <Field label="Issued">
                <input name="issuedOn" type="date" className="input" />
              </Field>
              <Field label="Expires">
                <input name="expiresOn" type="date" className="input" />
              </Field>
              <Field label="Certificate or transcript" className="sm:col-span-2">
                <input name="document" type="file" accept=".pdf,image/*" className="block w-full py-2 text-[0.875rem]" />
              </Field>
              <button className="btn btn-ink sm:col-span-4 sm:justify-self-start">Submit for verification</button>
            </form>
          </details>
        </div>

        <div className="space-y-3 pt-4">
          <h3 className="field-label">Employment history</h3>
          <ul className="border-t border-rule">
            {src.employment.map((e) => {
              const v = ver(e.id);
              const status = eff(v);
              return (
                <li key={e.id} className="grid gap-2 border-b border-rule-soft py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div>
                    <p className="font-semibold text-ink">
                      {e.position} <span className="font-normal text-ink-2">· {e.employer}</span>
                    </p>
                    <p className="text-[0.8125rem] text-ink-3">
                      {monthYear(e.startedOn)} – {e.endedOn ? monthYear(e.endedOn) : "present"}
                      {status === "not_submitted" ? " · shows as self-reported until verified" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusPill status={status} />
                    {status === "not_submitted" && v ? (
                      <form action={resubmitVerification.bind(null, v.id)}>
                        <input type="hidden" name="note" value="Requesting employer verification" />
                        <button className="btn btn-quiet min-h-11 text-sm">Request verification</button>
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <details>
            <summary className="btn btn-quiet min-h-11 cursor-pointer list-none text-sm [&::-webkit-details-marker]:hidden">Add a job</summary>
            <form action={submitEmployment} className="sheet mt-3 grid gap-3 p-4 sm:grid-cols-4">
              <Field label="Shop or dealership" className="sm:col-span-2">
                <input name="employer" required className="input" />
              </Field>
              <Field label="Position" className="sm:col-span-2">
                <input name="position" required className="input" placeholder="Technician" />
              </Field>
              <Field label="Started">
                <input name="startedOn" type="date" required className="input" />
              </Field>
              <Field label="Ended">
                <input name="endedOn" type="date" className="input" />
              </Field>
              <Field label="Letter or pay stub (optional)" className="sm:col-span-2" hint="Or we contact the service manager directly.">
                <input name="document" type="file" accept=".pdf,image/*" className="block w-full py-2 text-[0.875rem]" />
              </Field>
              <button className="btn btn-ink sm:col-span-4 sm:justify-self-start">Submit for verification</button>
            </form>
          </details>
        </div>

        <div className="space-y-3 pt-4">
          <h3 className="field-label">Previous repairs</h3>
          <div className="flex flex-wrap items-center justify-between gap-3 border-y border-rule py-3">
            <p className="text-[0.9375rem] text-ink-2">
              <span className="tnum font-semibold text-ink">{pub.reputation.platformRepairs}</span> completed on Clutch ·{" "}
              <span className="tnum font-semibold text-ink">{pub.reputation.customerRepairs}</span> confirmed by customers ·{" "}
              <span className="tnum font-semibold text-pencil">{pub.selfReported.repairs.length}</span> self-reported
            </p>
            <Link href="/mechanic/repairs" className="btn btn-line min-h-11 text-sm">
              Manage repair record
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
