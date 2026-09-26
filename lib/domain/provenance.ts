import type {
  PastRepairSource,
  ProvenanceSource,
  RepairCategory,
  VerificationCategory,
  VerificationMethod,
  VerificationStatus,
} from "./types";

/**
 * Every public claim carries exactly one provenance source. This file is the
 * single place those sources are named and explained — the "copy" metaphor
 * follows the repair-order world: each source is the copy of the record that
 * proves the claim, and who holds it.
 */
export interface ProvenanceInfo {
  source: ProvenanceSource;
  label: string;
  copy: string; // whose copy of the record proves it
  explanation: string;
  verified: boolean;
}

export const PROVENANCE: Record<ProvenanceSource, ProvenanceInfo> = {
  platform: {
    source: "platform",
    label: "Verified through a Clutch job",
    copy: "Clutch copy",
    explanation:
      "This repair was booked, quoted and completed through Clutch. We hold the job record, the approved estimate and the customer's completion confirmation.",
    verified: true,
  },
  institution: {
    source: "institution",
    label: "Confirmed with the issuer",
    copy: "Issuer copy",
    explanation:
      "This certification was checked against records from the organization that issued it, not just a photo of a certificate.",
    verified: true,
  },
  employer: {
    source: "employer",
    label: "Confirmed by employer",
    copy: "Employer copy",
    explanation:
      "This employment history was confirmed directly with the shop or dealership, or through employer documentation Clutch reviewed.",
    verified: true,
  },
  customer: {
    source: "customer",
    label: "Confirmed by a past customer",
    copy: "Customer copy",
    explanation:
      "A previous customer independently confirmed, through a private link sent to them, that this mechanic performed this repair.",
    verified: true,
  },
  document: {
    source: "document",
    label: "Document reviewed by Clutch",
    copy: "Document on file",
    explanation:
      "The mechanic submitted a document (such as a certificate or policy) and a Clutch reviewer checked it. The issuing organization was not contacted directly.",
    verified: true,
  },
  self: {
    source: "self",
    label: "Not independently verified",
    copy: "Mechanic's own statement",
    explanation:
      "The mechanic entered this and it has not been independently verified. It may well be true — it just isn't proven yet.",
    verified: false,
  },
};

/** Strength ordering, used only for sort order and visual weight — never summed into a score. */
export const PROVENANCE_ORDER: ProvenanceSource[] = [
  "platform",
  "institution",
  "employer",
  "customer",
  "document",
  "self",
];

export function repairSourceToProvenance(source: PastRepairSource): ProvenanceSource {
  return source === "platform" ? "platform" : source === "customer_confirmed" ? "customer" : source === "document" ? "document" : "self";
}

export function methodToProvenance(method: VerificationMethod): ProvenanceSource {
  switch (method) {
    case "platform_job":
      return "platform";
    case "institution_check":
      return "institution";
    case "employer_check":
      return "employer";
    case "customer_confirmation":
      return "customer";
    case "document_review":
    case "vendor_screening":
      return "document";
  }
}

// ---------------------------------------------------------------------------
// Safety screening — public outcome language only.
// ---------------------------------------------------------------------------

export interface SafetyInfo {
  category: "identity" | "background" | "driving_record" | "insurance";
  passLabel: string; // what the public sees when it passed
  shortLabel: string;
  explanation: string;
}

export const SAFETY: Record<SafetyInfo["category"], SafetyInfo> = {
  identity: {
    category: "identity",
    passLabel: "Identity verified",
    shortLabel: "Identity",
    explanation:
      "A government-issued photo ID was matched against a live selfie by an independent identity-verification provider. Clutch never shows the ID itself.",
  },
  background: {
    category: "background",
    passLabel: "Background check passed",
    shortLabel: "Background",
    explanation:
      "A consumer reporting agency ran a criminal background and sex-offender registry check with the mechanic's consent, and it met Clutch's screening criteria. Report details are never shown publicly.",
  },
  driving_record: {
    category: "driving_record",
    passLabel: "Driving record check passed",
    shortLabel: "Driving record",
    explanation:
      "A motor vehicle record check was run because this mechanic may test-drive customer vehicles. Only the pass result is shown.",
  },
  insurance: {
    category: "insurance",
    passLabel: "Insurance verified",
    shortLabel: "Insurance",
    explanation:
      "The mechanic's liability insurance policy document was reviewed by Clutch and was active on the date shown. Policy documents are never shown publicly.",
  },
};

// ---------------------------------------------------------------------------
// Status language
// ---------------------------------------------------------------------------

export const STATUS_LABEL: Record<VerificationStatus, string> = {
  not_submitted: "Not started",
  pending: "Pending",
  verified: "Verified",
  rejected: "Rejected",
  needs_info: "Needs more information",
  expired: "Expired",
  reverification_required: "Needs reverification",
};

export const CATEGORY_LABEL: Record<VerificationCategory, string> = {
  identity: "Identity",
  background: "Background check",
  driving_record: "Driving record",
  insurance: "Insurance",
  credential: "Certification",
  employment: "Employment",
  past_repair: "Previous repair",
};

export const METHOD_LABEL: Record<VerificationMethod, string> = {
  vendor_screening: "Screening provider",
  document_review: "Document review",
  institution_check: "Checked with issuer",
  employer_check: "Checked with employer",
  customer_confirmation: "Customer confirmation",
  platform_job: "Completed on Clutch",
};

export const REPAIR_LABEL: Record<RepairCategory, string> = {
  brakes: "Brakes",
  suspension: "Suspension & steering",
  cooling: "Cooling system",
  starters: "Starters",
  alternators: "Alternators & charging",
  diagnostics: "Diagnostics",
  electrical: "Electrical",
  engine: "Engine repair",
  ac: "A/C & heating",
  maintenance: "Maintenance",
};

/** Short noun used in "18 brake jobs" style sentences. */
export const REPAIR_NOUN: Record<RepairCategory, [string, string]> = {
  brakes: ["brake job", "brake jobs"],
  suspension: ["suspension job", "suspension jobs"],
  cooling: ["cooling repair", "cooling repairs"],
  starters: ["starter job", "starter jobs"],
  alternators: ["charging repair", "charging repairs"],
  diagnostics: ["diagnostic", "diagnostics"],
  electrical: ["electrical repair", "electrical repairs"],
  engine: ["engine repair", "engine repairs"],
  ac: ["A/C repair", "A/C repairs"],
  maintenance: ["service", "services"],
};

export function repairNoun(category: RepairCategory, n: number) {
  const [one, many] = REPAIR_NOUN[category];
  return n === 1 ? one : many;
}
