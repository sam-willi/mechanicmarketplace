import { CHECK_INFO } from "@/lib/verification/claims";
import type { EffectiveStatus } from "@/lib/verification/model";
import { monthYear } from "@/lib/format";
import { INSURANCE_UNVERIFIED_NOTE, screeningItems } from "./eligibility";
import type { PublicCredential, PublicEmployment, PublicRepair, PublicStatus } from "./public-profile";
import { PROVENANCE, REPAIR_LABEL, SAFETY, STATUS_LABEL, type SafetyInfo } from "./provenance";
import type { ProvenanceSource } from "./types";

/**
 * Serializable description of one piece of evidence — what the "copy" sheet
 * shows when a visitor taps a mark. Built on the server from public data only.
 */
export interface EvidenceDetail {
  title: string;
  kind: "provenance" | "safety";
  source: ProvenanceSource;
  status: EffectiveStatus;
  copy: string;
  label: string;
  explanation: string;
  facts: { label: string; value: string }[];
  /** Safety checks: the plain statement, what it means, and exactly what was checked. */
  statement?: string;
  meaning?: string;
  checked?: string[];
  notChecked?: string;
}

const validTo = (d?: string) => (d ? monthYear(d) : "No expiry");

export function safetyEvidence(cat: SafetyInfo["category"], s: PublicStatus, firstName: string): EvidenceDetail {
  const info = SAFETY[cat];
  const passed = s.status === "verified" || s.status === "renewal_due";
  const item = screeningItems({ safety: { identity: s, background: s, insurance: s, driving_record: s, drivingApplies: true } }).find((i) => i.key === cat)!;
  const label = item.label;
  const ci = CHECK_INFO[cat];
  const facts: EvidenceDetail["facts"] = [{ label: "Status", value: STATUS_LABEL[s.status] }];
  if (passed && s.by) facts.push({ label: "Checked by", value: s.by });
  if (s.verifiedAt && passed) facts.push({ label: cat === "insurance" ? "Reviewed" : "Checked", value: monthYear(s.verifiedAt) });
  if (s.expiresAt) facts.push({ label: s.status === "expired" ? "Lapsed" : cat === "insurance" ? "Policy valid to" : "Renew by", value: monthYear(s.expiresAt) });
  let explanation = passed ? ci.meaning : info.explanation;
  if (s.status === "in_progress" || s.status === "submitted" || s.status === "under_review") explanation = `${firstName} has started this check and the result hasn't come back yet, so it isn't verified.`;
  if (s.status === "needs_more_info") explanation = `${firstName} has been asked for more information. Until then it isn't verified.`;
  if (s.status === "expired") explanation = `This was verified before but has lapsed, so Clutch no longer counts it. ${firstName} needs to renew it.`;
  if (s.status === "failed" || s.status === "revoked") explanation = `Clutch hasn't verified this. Clutch doesn't publish screening details, only whether a check is current.`;
  if (s.status === "not_started") explanation = `${firstName} hasn't completed this, so Clutch hasn't verified it. Clutch shows the blank rather than hiding it.`;
  if (s.status === "renewal_due") explanation = `${ci.meaning} It expires soon and ${firstName} has been asked to renew it.`;
  if (s.unavailable) explanation = `${firstName} started this check, but Clutch hasn't connected a provider that can run it yet, so it isn't verified.`;
  if (cat === "insurance" && !passed) explanation = `${explanation} ${INSURANCE_UNVERIFIED_NOTE}`;
  return {
    title: label,
    kind: "safety",
    source: passed ? "document" : "self",
    status: s.status,
    copy: "Screening outcome",
    label,
    explanation,
    facts,
    statement: item.statement,
    meaning: ci.meaning,
    checked: passed ? ci.checked : undefined,
    notChecked: ci.notChecked,
  };
}

export function credentialEvidence(c: PublicCredential): EvidenceDetail {
  const p = PROVENANCE[c.provenance];
  const facts: EvidenceDetail["facts"] = [{ label: "Source", value: p.label }];
  if (c.issuedOn) facts.push({ label: "Issued", value: monthYear(c.issuedOn) });
  if (c.verifiedAt && c.provenance !== "self") facts.push({ label: "Verified", value: monthYear(c.verifiedAt) });
  facts.push({ label: "Valid to", value: validTo(c.expiresAt) });
  if (c.status !== "verified") facts.push({ label: "Status", value: STATUS_LABEL[c.status] });
  return {
    title: `${c.issuer} ${c.code ? `${c.code} · ` : ""}${c.name}`,
    kind: "provenance",
    source: c.provenance,
    status: c.status,
    copy: p.copy,
    label: c.provenance === "institution" ? `Confirmed with ${c.issuer}` : p.label,
    explanation: c.status === "expired" ? "This certification has expired. It was verified before, but Clutch doesn't count lapsed credentials." : p.explanation,
    facts,
  };
}

export function employmentEvidence(e: PublicEmployment): EvidenceDetail {
  const p = PROVENANCE[e.provenance];
  return {
    title: `${e.position}, ${e.employer.replace(" (demo)", "")}`,
    kind: "provenance",
    source: e.provenance,
    status: e.status,
    copy: p.copy,
    label: e.provenance === "employer" ? `Confirmed by ${e.employer.replace(" (demo)", "")}` : p.label,
    explanation: e.status === "under_review" || e.status === "submitted" ? `${p.explanation} Verification with the employer is in progress.` : p.explanation,
    facts: [
      { label: "Source", value: p.label },
      { label: "Dates", value: `${monthYear(e.startedOn)} – ${e.endedOn ? monthYear(e.endedOn) : "present"}` },
      ...(e.verifiedAt && e.provenance !== "self" ? [{ label: "Confirmed", value: monthYear(e.verifiedAt) }] : []),
    ],
  };
}

export function repairEvidence(r: PublicRepair): EvidenceDetail {
  const p = PROVENANCE[r.provenance];
  return {
    title: `${r.year} ${r.make} ${r.model} — ${r.title}`,
    kind: "provenance",
    source: r.provenance,
    status: r.provenance === "self" ? "not_started" : "verified",
    copy: p.copy,
    label: p.label,
    explanation: p.explanation,
    facts: [
      ...(r.ticket ? [{ label: "Record", value: `Job No. ${String(r.ticket).padStart(3, "0")}` }] : []),
      { label: "Verified by", value: r.provenance === "platform" ? "Clutch job record, confirmed by the customer" : r.provenance === "customer" ? "The customer, through a private link" : r.provenance === "document" ? "A Clutch reviewer, from an invoice" : "Nobody yet: the mechanic's own entry" },
      { label: "Repair", value: REPAIR_LABEL[r.category] },
      { label: "Performed", value: monthYear(r.performedOn) },
      ...(r.hasReview ? [{ label: "Review", value: "Customer left a review" }] : []),
    ],
  };
}

export function sourceEvidence(source: ProvenanceSource, title?: string): EvidenceDetail {
  const p = PROVENANCE[source];
  return {
    title: title ?? p.label,
    kind: "provenance",
    source,
    status: source === "self" ? "not_started" : "verified",
    copy: p.copy,
    label: p.label,
    explanation: p.explanation,
    facts: [],
  };
}
