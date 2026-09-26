import { monthYear } from "@/lib/format";
import { screeningItems } from "./eligibility";
import type { PublicCredential, PublicEmployment, PublicRepair, PublicStatus } from "./public-profile";
import { PROVENANCE, REPAIR_LABEL, SAFETY, STATUS_LABEL, type SafetyInfo } from "./provenance";
import type { ProvenanceSource, VerificationStatus } from "./types";

/**
 * Serializable description of one piece of evidence — what the "copy" sheet
 * shows when a visitor taps a mark. Built on the server from public data only.
 */
export interface EvidenceDetail {
  title: string;
  kind: "provenance" | "safety";
  source: ProvenanceSource;
  status: VerificationStatus;
  copy: string;
  label: string;
  explanation: string;
  facts: { label: string; value: string }[];
}

const validTo = (d?: string) => (d ? monthYear(d) : "No expiry");

export function safetyEvidence(cat: SafetyInfo["category"], s: PublicStatus, firstName: string): EvidenceDetail {
  const info = SAFETY[cat];
  const passed = s.status === "verified" || s.status === "reverification_required";
  const label = screeningItems({ safety: { identity: s, background: s, insurance: s, driving_record: s, drivingApplies: true } })
    .find((i) => i.key === cat)!.label;
  const facts: EvidenceDetail["facts"] = [{ label: "Status", value: STATUS_LABEL[s.status] }];
  if (s.verifiedAt) facts.push({ label: cat === "insurance" ? "Reviewed" : "Checked", value: monthYear(s.verifiedAt) });
  if (s.expiresAt) facts.push({ label: s.status === "expired" ? "Lapsed" : cat === "insurance" ? "Policy valid to" : "Rescreen due", value: monthYear(s.expiresAt) });
  let explanation = info.explanation;
  if (s.status === "pending") explanation = `${firstName} has started this check and the result hasn't come back yet. ${info.explanation}`;
  if (s.status === "expired") explanation = `This was verified before but has lapsed, so Clutch no longer shows it as current. ${firstName} needs to submit an updated document.`;
  if (s.status === "rejected" || s.status === "needs_info") explanation = `This hasn't been verified. Clutch doesn't publish screening details, only whether a check is current.`;
  if (s.status === "not_submitted") explanation = `${firstName} hasn't provided this yet. Clutch shows the blank rather than hiding it.`;
  if (s.status === "reverification_required") explanation = `${info.explanation} It expires soon and ${firstName} has been asked to renew it.`;
  return {
    title: label,
    kind: "safety",
    source: passed ? "document" : "self",
    status: s.status,
    copy: "Screening outcome",
    label,
    explanation,
    facts,
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
    explanation: e.status === "pending" ? `${p.explanation} Verification with the employer is in progress.` : p.explanation,
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
    status: r.provenance === "self" ? "not_submitted" : "verified",
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
    status: source === "self" ? "not_submitted" : "verified",
    copy: p.copy,
    label: p.label,
    explanation: p.explanation,
    facts: [],
  };
}
