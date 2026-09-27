/**
 * What Clutch may say about each check, generated from the records at read time (never stored).
 * Plain statements that name who checked what and when, a "What this means" line, and exactly
 * what was and wasn't checked. No generic "Trusted" or "Verified" badge anywhere.
 */
export type CheckKey = "identity" | "background" | "driving_record" | "insurance";

export interface CheckInfo {
  name: string;
  /** For the mechanic: why it helps. */
  why: string;
  /** For the mechanic: what they'll need. */
  needs: string;
  /** For the mechanic: what leaves Clutch, and to whom. */
  dataLeaves: string;
  /** For the mechanic: how long it takes. */
  time: string;
  /** For customers, when verified. */
  meaning: string;
  /** For customers: what was checked. */
  checked: string[];
  /** For customers: what this check does NOT cover. */
  notChecked: string;
  /** How long a verification lasts, in months (renewal). */
  validMonths?: number;
}

export const CHECK_INFO: Record<CheckKey, CheckInfo> = {
  identity: {
    name: "Identity",
    why: "Customers are letting you work on their car, often at their home. A verified identity tells them you are who your profile says.",
    needs: "A valid government photo ID (driver's license, state ID or passport) and your phone's camera for a live selfie.",
    dataLeaves:
      "Your ID photo and selfie go straight to Stripe Identity, which checks them and keeps them under its privacy policy. Clutch receives only the result, the date, and whether the name on the ID matches your account. Clutch never receives your ID number, date of birth or photos.",
    time: "About 3 minutes. Most results arrive within a minute.",
    meaning: "A government photo ID was checked, and a live selfie was matched to it.",
    checked: ["Government photo ID is genuine and not expired", "A live selfie matches the ID photo", "The name on the ID matches the Clutch account"],
    notChecked: "It says nothing about criminal history, driving record, insurance or skill.",
    validMonths: 36,
  },
  background: {
    name: "Background check",
    why: "Some customers only book mechanics with a completed background check. It is optional on Clutch.",
    needs: "Your consent to a background check, and the details the screening company asks for.",
    dataLeaves: "Your details go to the screening company named at consent. Clutch receives only the outcome (clear or not) and the date, never the report.",
    time: "Usually 1 to 3 business days.",
    meaning: "A consumer reporting agency ran a criminal records search and Clutch received a clear outcome.",
    checked: ["County, state and national criminal records", "Sex offender registry"],
    notChecked: "Clutch never publishes report details. It says nothing about skill or insurance.",
    validMonths: 12,
  },
  driving_record: {
    name: "Driving record",
    why: "Mobile mechanics drive to customers and sometimes test-drive their cars.",
    needs: "Your consent and your driver's license details.",
    dataLeaves: "Your license details go to the screening company named at consent. Clutch receives only the outcome and the date.",
    time: "Usually 1 to 2 business days.",
    meaning: "A motor vehicle record check came back acceptable under Clutch's policy.",
    checked: ["License is valid and not suspended", "No major violations under Clutch's policy"],
    notChecked: "It says nothing about criminal history, insurance or skill.",
    validMonths: 12,
  },
  insurance: {
    name: "Insurance",
    why: "Customers want to know who covers damage if something goes wrong. Verified insurance answers that before they ask.",
    needs: "Your certificate of insurance: carrier, policy type, the named insured (you or your business), and the effective and expiry dates.",
    dataLeaves: "Nothing leaves Clutch. Your certificate is stored privately and seen only by you and the Clutch reviewer, through links that expire in minutes.",
    time: "Uploading takes 2 minutes. Review is usually within 2 business days.",
    meaning: "Clutch staff reviewed a certificate of insurance naming this mechanic or their business, active on the dates shown.",
    checked: ["The certificate names the mechanic or their business", "The policy was active when reviewed", "The expiry date, after which it stops counting"],
    notChecked: "Clutch doesn't confirm coverage amounts with the insurer or decide what a claim would cover.",
  },
};

// Formatters built once: search builds a statement for every check of every bookable mechanic.
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const fmt = (d?: string) => (d ? DAY.format(new Date(`${d.slice(0, 10)}T12:00:00Z`)) : "");
const month = (d?: string) => (d ? MONTH.format(new Date(`${d.slice(0, 10)}T12:00:00Z`)) : "");

type StatementInput = { state: "verified" | "expiring" | "pending" | "unavailable" | "missing" | "expired" | "rejected"; by?: string; verifiedAt?: string; expiresAt?: string };
// The same few statements repeat across a search's many profiles: remember them (bounded).
const memo = new Map<string, string>();

/** The plain public statement for one check. */
export function statement(key: CheckKey, s: StatementInput) {
  const k = `${key}|${s.state}|${s.by ?? ""}|${s.verifiedAt ?? ""}|${s.expiresAt ?? ""}`;
  const hit = memo.get(k);
  if (hit !== undefined) return hit;
  if (memo.size > 5000) memo.clear();
  const out = build(key, s);
  memo.set(k, out);
  return out;
}

function build(key: CheckKey, s: StatementInput) {
  const name = CHECK_INFO[key].name;
  switch (s.state) {
    case "verified":
      return `${name} verified by ${s.by ?? "Clutch staff"}${s.verifiedAt ? ` on ${fmt(s.verifiedAt)}` : ""}${s.expiresAt && key === "insurance" ? `, valid until ${month(s.expiresAt)}` : ""}`;
    case "expiring":
      return `${name} verified by ${s.by ?? "Clutch staff"}${s.verifiedAt ? ` on ${fmt(s.verifiedAt)}` : ""}; renewal due ${month(s.expiresAt)}`;
    case "pending":
      return `${name}: check in progress, not verified yet`;
    case "unavailable":
      return `${name} not verified by Clutch (the check couldn't be run yet)`;
    case "expired":
      return `${name} expired ${month(s.expiresAt)}, so it's no longer verified`;
    case "rejected":
    case "missing":
      return `${name} not verified by Clutch`;
  }
}
