/**
 * Canonical reason codes for every decision on a verification record: staff actions and provider
 * results map to these, and the mechanic sees the `mechanic` sentence (never provider internals).
 */
export interface Reason {
  code: string;
  /** Short label for staff. */
  label: string;
  /** What the mechanic is told. */
  mechanic: string;
  /** Which decisions it can explain. */
  for: ("approve" | "reject" | "request_info" | "revoke" | "provider")[];
}

export const REASONS: Reason[] = [
  // approvals
  { code: "evidence_matches", label: "Evidence matches the claim", mechanic: "Your evidence was checked and matches.", for: ["approve"] },
  { code: "confirmed_with_source", label: "Confirmed with the issuer or employer", mechanic: "Confirmed with the issuer or employer.", for: ["approve"] },
  { code: "provider_verified", label: "Provider verified", mechanic: "The provider verified it.", for: ["provider"] },
  // more information
  { code: "document_unreadable", label: "Document unreadable or cut off", mechanic: "The document was hard to read or cut off. Please upload a clear, complete copy.", for: ["request_info", "provider"] },
  { code: "document_missing_fields", label: "Missing required details", mechanic: "Some required details weren't on the document (for insurance: carrier, named insured and dates).", for: ["request_info"] },
  { code: "name_mismatch", label: "Name doesn't match the account", mechanic: "The name on the document doesn't match your account. Upload one in your name or your business's, or contact support.", for: ["request_info", "reject", "provider"] },
  { code: "selfie_retake", label: "Selfie couldn't be matched", mechanic: "Your selfie couldn't be matched to your ID. Try again in good light, with your face fully visible.", for: ["provider"] },
  { code: "id_unsupported", label: "ID type not supported", mechanic: "That type of ID isn't supported. Use a driver's license, state ID or passport.", for: ["provider"] },
  { code: "session_cancelled", label: "Mechanic cancelled", mechanic: "You left before finishing. You can start again at any time.", for: ["provider"] },
  { code: "provider_error", label: "Provider couldn't finish", mechanic: "The provider couldn't finish the check. Try again; if it keeps failing, contact support.", for: ["provider"] },
  // rejections and revocations
  { code: "document_expired", label: "Document expired", mechanic: "The document had expired. Upload a current one.", for: ["reject", "request_info", "provider", "revoke"] },
  { code: "not_authentic", label: "Couldn't be authenticated", mechanic: "Clutch couldn't confirm this document is genuine. Contact support if you think this is wrong.", for: ["reject", "revoke", "provider"] },
  { code: "coverage_not_suitable", label: "Coverage doesn't fit mobile work", mechanic: "The policy doesn't cover mobile work at customers' locations.", for: ["reject"] },
  { code: "policy_cancelled", label: "Policy cancelled or lapsed", mechanic: "The policy was cancelled or lapsed.", for: ["revoke", "reject"] },
  { code: "issued_in_error", label: "Approved in error", mechanic: "This was approved in error and has been withdrawn. Contact support if you have questions.", for: ["revoke"] },
  { code: "customer_denied", label: "Customer didn't recognise the repair", mechanic: "The customer you asked didn't recognise this repair.", for: ["provider"] },
  { code: "legacy_unverified_provider", label: "Recorded before a real provider existed", mechanic: "This was recorded before Clutch had a real provider for it, so it doesn't count. Please run it again.", for: ["revoke"] },
  { code: "other", label: "Other (explain in the note)", mechanic: "See the reviewer's note.", for: ["approve", "reject", "request_info", "revoke"] },
];

const BY_CODE = new Map(REASONS.map((r) => [r.code, r]));

export function reason(code: string) {
  return BY_CODE.get(code);
}

export function reasonsFor(action: Reason["for"][number]) {
  return REASONS.filter((r) => r.for.includes(action));
}

/** What the mechanic is told for a set of codes (plus the reviewer's note, if any). */
export function mechanicMessage(codes: string[] | undefined, note?: string) {
  const parts = (codes ?? []).map((c) => BY_CODE.get(c)?.mechanic).filter((x): x is string => Boolean(x) && x !== BY_CODE.get("other")!.mechanic);
  if (note) parts.push(note);
  return parts.join(" ");
}
