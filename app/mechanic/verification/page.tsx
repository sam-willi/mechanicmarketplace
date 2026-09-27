import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Clock, ShieldCheck } from "lucide-react";
import { getRepo } from "@/lib/data";
import { getSession, needs } from "@/lib/session";
import { toPublicProfile } from "@/lib/domain/public-profile";
import { METHOD_LABEL, PROVENANCE, STATUS_LABEL, methodToProvenance } from "@/lib/domain/provenance";
import { screeningItems } from "@/lib/domain/eligibility";
import { effectiveStatus } from "@/lib/verification/lifecycle";
import type { EffectiveStatus, VerificationEvent } from "@/lib/verification/model";
import { CHECK_INFO, type CheckKey } from "@/lib/verification/claims";
import { mechanicMessage } from "@/lib/verification/reasons";
import { identityConfig } from "@/lib/verification/identity/config";
import type { VerificationRecord } from "@/lib/domain/types";
import { monthYear } from "@/lib/format";
import { screeningOpen, screeningProblems } from "@/lib/verification/providers/registry";
import { refreshScreening, resubmitVerification, startIdentity, startScreening, submitCredential, submitEmployment, submitInsurance } from "@/app/actions/mechanic";
import { Field, NeedsPersona, Notice, PageTitle, StatusPill } from "@/components/workspace/ui";
import { EvidenceUpload } from "@/components/mechanic/evidence-upload";

export const metadata: Metadata = { title: "Verification Center" };

type SP = { welcome?: string; identity?: string; error?: string; sent?: string };

const fmt = (d?: string) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");

/** What returning from the identity provider means, in plain words. */
const IDENTITY_RETURN: Record<string, { tone: "ok" | "warn" | "error" | "info"; text: string }> = {
  verified: { tone: "ok", text: "Your identity is verified. Customers now see it on your profile." },
  under_review: { tone: "info", text: "The provider is still checking. This usually takes under a minute; refresh this page shortly." },
  in_progress: { tone: "info", text: "You haven't finished the identity check yet. Continue when you're ready." },
  needs_more_info: { tone: "warn", text: "The provider needs you to try again. See what to change below." },
  not_started: { tone: "info", text: "You left before finishing, so nothing was checked. You can start again any time." },
  failed: { tone: "error", text: "The identity check didn't pass. Contact support if you think this is wrong." },
  unavailable: { tone: "info", text: "Identity verification isn't available yet. Nothing is needed from you for now." },
  outage: { tone: "warn", text: "The identity provider didn't respond. Nothing was lost; try again in a few minutes." },
};

export default async function VerificationCenter({ searchParams }: { searchParams: Promise<SP> }) {
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "mechanic") return <NeedsPersona role="mechanic" />;
  await (await needs(s)).ownSources();
  const sp = await searchParams;
  const src = repo.getMechanicSources(s.mechanicId);
  const pub = toPublicProfile(src);
  const items = screeningItems(pub);
  const vers = repo.listVerifications({ mechanicId: s.mechanicId });
  const current = (cat: VerificationRecord["category"]) =>
    vers.filter((v) => v.category === cat && !v.supersededBy).sort((a, b) => ((a.events?.[0]?.at ?? a.submittedAt ?? "") < (b.events?.[0]?.at ?? b.submittedAt ?? "") ? 1 : -1))[0];
  const eff = (v?: VerificationRecord): EffectiveStatus => (v ? effectiveStatus(v.status, v.expiresAt, new Date(), v.method) : "not_started");
  const ver = (subjectId: string) => vers.filter((v) => v.subjectId === subjectId && !v.supersededBy).at(-1);
  const email = current("email");
  const idCfg = identityConfig(repo.scope);
  const screenProblems = repo.scope === "demo" ? [] : screeningProblems();
  const verifiedChecks = items.filter((i) => i.verified).length;
  const identityNote = sp.identity ? IDENTITY_RETURN[sp.identity] : undefined;

  return (
    <div className="space-y-10">
      <PageTitle
        title="Verification"
        note="Optional. Each check shows separately on your profile; none is required to receive requests or be booked. Verified checks build trust and rank you higher at equal experience."
        action={
          <Link href={`/mechanics/${src.mechanic.slug}`} className="btn btn-quiet min-h-11 text-sm">
            See your public profile
          </Link>
        }
      />
      {sp.error ? <Notice tone="error">{sp.error}</Notice> : null}
      {identityNote ? <Notice tone={identityNote.tone}>{identityNote.text}</Notice> : null}
      {sp.sent === "insurance" ? <Notice tone="ok">Insurance submitted. Clutch staff usually review it within 2 business days; you&apos;ll get a notification.</Notice> : null}
      {sp.welcome ? <Notice tone="ok">Your profile is live. Everything you entered shows as self-reported until it&apos;s verified.</Notice> : null}

      <p className="flex items-center gap-2 text-[0.9375rem]">
        <ShieldCheck size={18} className="text-ink-3" aria-hidden />
        <span>
          <span className="font-bold">{verifiedChecks} of {items.length}</span> checks verified. Customers see exactly which, and never your documents or reports.
        </span>
      </p>

      {/* Account */}
      <section aria-labelledby="account-title" className="space-y-2">
        <h2 id="account-title" className="heading text-[1.25rem]">
          Account
        </h2>
        <ul className="sheet divide-y divide-rule-soft">
          <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div>
              <p className="font-semibold">Email</p>
              <p className="text-[0.875rem] text-ink-2">{email && eff(email) === "verified" ? `Confirmed at sign-in on ${fmt(email.verifiedAt)}` : "Confirmed when you created your account"}</p>
            </div>
            <StatusPill status={email ? eff(email) : "verified"} />
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div>
              <p className="font-semibold">Phone</p>
              <p className="text-[0.875rem] text-ink-2">Not available yet: Clutch hasn&apos;t connected a text-message provider. Your number isn&apos;t shown as verified anywhere.</p>
            </div>
            <StatusPill status="not_started" />
          </li>
        </ul>
      </section>

      {/* The four checks */}
      <section aria-labelledby="checks-title" className="space-y-4">
        <h2 id="checks-title" className="heading text-[1.25rem]">
          Checks customers see
        </h2>
        <CheckCard
          k="identity"
          v={current("identity")}
          statement={items.find((i) => i.key === "identity")!.statement}
          status={eff(current("identity"))}
          action={<IdentityAction v={current("identity")} status={eff(current("identity"))} available={Boolean(idCfg.provider)} />}
          unavailable={idCfg.provider ? undefined : "Identity verification isn't available yet: Clutch hasn't connected its identity provider. Nothing is needed from you, and your profile says identity isn't verified."}
        />
        <CheckCard
          k="insurance"
          v={current("insurance")}
          statement={items.find((i) => i.key === "insurance")!.statement}
          status={eff(current("insurance"))}
          action={<InsuranceAction v={current("insurance")} status={eff(current("insurance"))} />}
          extra={pendingRenewal(vers, current("insurance"))}
        />
        {(["background", "driving_record"] as const).map((k) => (
          <CheckCard
            key={k}
            k={k}
            v={current(k)}
            statement={items.find((i) => i.key === k)?.statement ?? `${CHECK_INFO[k].name} not verified by Clutch`}
            status={eff(current(k))}
            unavailable={
              screeningOpen(k, repo.scope)
                ? undefined
                : `Not available yet: Clutch hasn't connected a screening company${screenProblems.some((p) => p.includes("policy")) ? " or approved its screening policy" : ""}. Nothing is needed from you; your profile says it isn't verified.`
            }
            action={screeningOpen(k, repo.scope) ? <ScreeningAction k={k} v={current(k)} status={eff(current(k))} /> : null}
          />
        ))}
      </section>

      {/* Skill evidence */}
      <section aria-labelledby="skill-title" className="space-y-6">
        <div>
          <h2 id="skill-title" className="heading text-[1.25rem]">
            Proof of your skill
          </h2>
          <p className="text-[0.9375rem] text-ink-2">Separate from the checks above. Each item shows who confirmed it; unconfirmed items show as self-reported.</p>
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
                    <p className="font-semibold">
                      {c.issuer} {c.code} <span className="font-normal text-ink-2">· {c.name}</span>
                    </p>
                    <p className="text-[0.8125rem] text-ink-3">
                      {v ? METHOD_LABEL[v.method] : "Self-reported"}
                      {status === "verified" && v ? `, shows as ${PROVENANCE[methodToProvenance(v.method)].label}` : ""}
                      {c.expiresOn ? ` · expires ${monthYear(c.expiresOn)}` : ""}
                      {v && !v.documentIds?.length && status !== "verified" ? " · no document attached yet" : ""}
                    </p>
                    {v && (status === "needs_more_info" || status === "failed") ? <p className="mt-1 text-[0.875rem] text-amber">{mechanicMessage(v.reasonCodes, v.notes)}</p> : null}
                  </div>
                  <div className="space-y-2">
                    <StatusPill status={status} />
                    {v && (status === "needs_more_info" || status === "failed" || status === "expired" || status === "renewal_due" || (status === "submitted" && !v.documentIds?.length)) ? (
                      <ResubmitForm id={v.id} doc />
                    ) : null}
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
              <div className="sm:col-span-4">
                <EvidenceUpload label="Certificate or transcript" hint="A PDF, or a clear photo of the paper. Stored privately; only you and the reviewer can open it." />
              </div>
              <button className="btn btn-ink sm:col-span-4 sm:justify-self-start">Submit for review</button>
            </form>
          </details>
        </div>

        <div className="space-y-3">
          <h3 className="field-label">Where you&apos;ve worked</h3>
          <ul className="border-t border-rule">
            {src.employment.map((e) => {
              const v = ver(e.id);
              const status = eff(v);
              return (
                <li key={e.id} className="grid gap-2 border-b border-rule-soft py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div>
                    <p className="font-semibold">
                      {e.position} <span className="font-normal text-ink-2">· {e.employer}</span>
                    </p>
                    <p className="text-[0.8125rem] text-ink-3">
                      {monthYear(e.startedOn)} to {e.endedOn ? monthYear(e.endedOn) : "present"}
                      {status === "not_started" ? " · shows as self-reported until confirmed" : ""}
                    </p>
                    {v && (status === "needs_more_info" || status === "failed") ? <p className="mt-1 text-[0.875rem] text-amber">{mechanicMessage(v.reasonCodes, v.notes)}</p> : null}
                  </div>
                  <div className="space-y-2">
                    <StatusPill status={status} />
                    {v && (status === "needs_more_info" || status === "failed") ? <ResubmitForm id={v.id} doc /> : null}
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
              <div className="sm:col-span-4">
                <EvidenceUpload label="Letter or pay stub (optional)" hint="Or Clutch contacts the service manager directly." />
              </div>
              <button className="btn btn-ink sm:col-span-4 sm:justify-self-start">Submit for review</button>
            </form>
          </details>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-y border-rule py-3">
          <p className="text-[0.9375rem] text-ink-2">
            <span className="tnum font-semibold text-ink">{pub.reputation.platformRepairs}</span> completed on Clutch ·{" "}
            <span className="tnum font-semibold text-ink">{pub.reputation.customerRepairs}</span> confirmed by customers ·{" "}
            <span className="tnum font-semibold text-pencil">{pub.selfReported.repairs.length}</span> self-reported
          </p>
          <Link href="/mechanic/repairs" className="btn btn-line min-h-11 text-sm">
            Previous repairs
          </Link>
        </div>
      </section>

      <p className="text-[0.875rem] text-ink-2">
        Something wrong or stuck?{" "}
        <Link href="/help" className="font-semibold underline decoration-rule underline-offset-2">
          Contact support
        </Link>
        . Tell us which check; never send ID numbers or documents by message.
      </p>
    </div>
  );
}

/** A renewal waiting for review while the current record is still valid. */
function pendingRenewal(vers: VerificationRecord[], cur?: VerificationRecord) {
  if (!cur) return null;
  const next = vers.find((v) => v.supersedes === cur.id && !v.supersededBy && cur.supersededBy !== v.id);
  if (!next) return null;
  return <p className="text-[0.875rem] text-ink-2">Your renewal (submitted {fmt(next.submittedAt)}) is {STATUS_LABEL[effectiveStatus(next.status, next.expiresAt)].toLowerCase()}. The current policy stays on your profile until it&apos;s approved or expires.</p>;
}

function CheckCard({
  k,
  v,
  status,
  statement,
  action,
  unavailable,
  extra,
}: {
  k: CheckKey;
  v?: VerificationRecord;
  status: EffectiveStatus;
  statement: string;
  action?: React.ReactNode;
  unavailable?: string;
  extra?: React.ReactNode;
}) {
  const info = CHECK_INFO[k];
  const message = v && (status === "needs_more_info" || status === "failed" || status === "revoked") ? mechanicMessage(v.reasonCodes, v.notes) : "";
  return (
    <article id={k === "driving_record" ? "driving" : k} aria-labelledby={`${k}-title`} className="sheet scroll-mt-24">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-rule-soft px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h3 id={`${k}-title`} className="heading text-[1.125rem]">
            {info.name}
          </h3>
          <p className="text-[0.9375rem] text-ink-2">{statement}</p>
        </div>
        <StatusPill status={status} />
      </div>
      <div className="space-y-3 px-4 py-3 sm:px-5">
        {message ? <Notice tone={status === "needs_more_info" ? "warn" : "error"}>{message}</Notice> : null}
        {status === "renewal_due" && v?.expiresAt ? <Notice tone="warn">Expires {fmt(v.expiresAt)}. Renew it to keep it on your profile.</Notice> : null}
        {status === "expired" ? <Notice tone="warn">This expired, so customers no longer see it as verified. Renew it below.</Notice> : null}
        {extra}
        {unavailable ? <p className="text-[0.9375rem] text-ink-2">{unavailable}</p> : action}
        <details className="group">
          <summary className="min-h-11 cursor-pointer content-center text-[0.875rem] font-semibold underline decoration-rule underline-offset-2">About this check</summary>
          <dl className="mt-2 grid gap-2 text-[0.875rem] sm:grid-cols-[9rem_minmax(0,1fr)]">
            <dt className="field-label pt-0.5">Why it helps</dt>
            <dd>{info.why}</dd>
            <dt className="field-label pt-0.5">You&apos;ll need</dt>
            <dd>{info.needs}</dd>
            <dt className="field-label pt-0.5">What leaves Clutch</dt>
            <dd>{info.dataLeaves}</dd>
            <dt className="field-label pt-0.5">Time</dt>
            <dd>{info.time}</dd>
            <dt className="field-label pt-0.5">How long it lasts</dt>
            <dd>{info.validMonths ? `${info.validMonths} months, then renew` : "Until the policy's expiry date"}</dd>
          </dl>
          {v?.events?.length ? <History events={v.events} /> : null}
        </details>
      </div>
    </article>
  );
}

function History({ events }: { events: VerificationEvent[] }) {
  const word: Record<string, string> = {
    created: "Created",
    started: "Started",
    submitted: "Submitted",
    review_started: "Review started",
    provider_update: "Update from the provider",
    approved: "Approved",
    rejected: "Not approved",
    requested_info: "More information requested",
    revoked: "Withdrawn",
    expired: "Expired",
    cancelled: "Cancelled",
    superseded: "Replaced by a newer submission",
    reminded: "Renewal reminder sent",
    migrated: "Recorded before this history existed",
  };
  return (
    <div className="mt-3">
      <p className="field-label">History</p>
      <ol className="mt-1 space-y-1 text-[0.8125rem] text-ink-2">
        {events.map((e, i) => (
          <li key={i} className="flex gap-2">
            <Clock size={13} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              {fmt(e.at)}: {word[e.action] ?? e.action}
              {e.to !== e.from && e.action !== "created" ? ` (${STATUS_LABEL[e.to].toLowerCase()})` : ""}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function IdentityAction({ v, status, available }: { v?: VerificationRecord; status: EffectiveStatus; available: boolean }) {
  if (!available) return null;
  if (status === "verified") return <p className="text-[0.875rem] text-ink-2">Nothing to do. You&apos;ll be reminded before it needs renewing.</p>;
  if (status === "under_review" || status === "submitted") return <p className="text-[0.875rem] text-ink-2">The provider is checking. Results usually arrive within a minute; you&apos;ll get a notification.</p>;
  const label = status === "in_progress" ? "Continue identity check" : status === "needs_more_info" ? "Try again" : status === "renewal_due" || status === "expired" ? "Renew identity" : v && (status === "failed" || status === "revoked") ? "Start a new check" : "Verify your identity";
  return (
    <form action={startIdentity} className="space-y-2">
      <p className="text-[0.875rem] text-ink-2">You&apos;ll go to Stripe Identity&apos;s secure page to photograph your ID and take a selfie with your phone&apos;s camera, then come back here.</p>
      <button className="btn btn-ink min-h-12">
        {label} <ArrowRight size={16} aria-hidden />
      </button>
    </form>
  );
}

function InsuranceAction({ v, status }: { v?: VerificationRecord; status: EffectiveStatus }) {
  if (status === "submitted" || status === "under_review") return <p className="text-[0.875rem] text-ink-2">With Clutch staff for review, usually within 2 business days.</p>;
  if (status === "needs_more_info" && v) return <ResubmitForm id={v.id} doc />;
  const renewing = status === "verified" || status === "renewal_due" || status === "expired";
  if (status === "verified") return <details><summary className="btn btn-quiet min-h-11 cursor-pointer list-none text-sm [&::-webkit-details-marker]:hidden">Upload a renewed policy</summary><InsuranceForm renewing /></details>;
  return <InsuranceForm renewing={renewing} />;
}

function InsuranceForm({ renewing }: { renewing: boolean }) {
  return (
    <form action={submitInsurance} className="mt-2 grid gap-3 sm:grid-cols-2">
      <Field label="Policy type">
        <select name="policyType" className="input" defaultValue="general_liability" required>
          <option value="general_liability">General liability</option>
          <option value="garage_liability">Garage liability</option>
          <option value="garagekeepers">Garagekeepers</option>
          <option value="commercial_auto">Commercial auto</option>
          <option value="other">Other</option>
        </select>
      </Field>
      <Field label="Insurance company">
        <input name="carrier" required className="input" autoComplete="off" />
      </Field>
      <Field label="Named insured" hint="You, or your business, as written on the certificate." className="sm:col-span-2">
        <input name="namedInsured" required className="input" autoComplete="off" />
      </Field>
      <Field label="Effective">
        <input name="effectiveOn" type="date" required className="input" />
      </Field>
      <Field label="Expires">
        <input name="expiresOn" type="date" required className="input" />
      </Field>
      <div className="sm:col-span-2">
        <EvidenceUpload label="Certificate of insurance" required hint="A PDF, or a clear photo. Stored privately; only you and the Clutch reviewer can open it." />
      </div>
      <button className="btn btn-ink min-h-12 sm:col-span-2 sm:justify-self-start">{renewing ? "Submit renewal" : "Submit for review"}</button>
    </form>
  );
}

function ScreeningAction({ k, v, status }: { k: "background" | "driving_record"; v?: VerificationRecord; status: EffectiveStatus }) {
  if (status === "in_progress" || status === "under_review")
    return (
      <form action={refreshScreening.bind(null, k)}>
        <p className="text-[0.875rem] text-ink-2">With the screening company. Results usually take {k === "background" ? "1 to 3" : "1 to 2"} business days.</p>
        <button className="btn btn-quiet mt-2 min-h-11 text-sm">Check for a result</button>
      </form>
    );
  if (status === "verified") return <p className="text-[0.875rem] text-ink-2">Nothing to do. You&apos;ll be reminded before it needs renewing.</p>;
  return (
    <form action={startScreening.bind(null, k)} className="space-y-2">
      <label className="flex items-start gap-2 text-[0.875rem]">
        <input type="checkbox" name="consent" required className="mt-1" />
        <span>I consent to a {k === "background" ? "background check" : "motor vehicle record check"} by the screening company named in the disclosure, and to Clutch receiving only the outcome.</span>
      </label>
      <button className="btn btn-ink min-h-11">{v ? "Run again" : "Start"}</button>
    </form>
  );
}

function ResubmitForm({ id, doc }: { id: string; doc?: boolean }) {
  return (
    <form action={resubmitVerification.bind(null, id)} className="grid gap-2">
      {doc ? <EvidenceUpload label="Updated document" /> : null}
      <Field label="What changed? (optional)">
        <input name="note" className="input" />
      </Field>
      <button className="btn btn-line min-h-11 justify-self-start text-sm">Resubmit</button>
    </form>
  );
}
