import type { PublicMechanicProfile } from "./public-profile";

export interface ProfileStep {
  label: string;
  done: boolean;
  /** Must be complete before the mechanic can send estimates for real work. */
  requiredForWork: boolean;
  href: string;
  /** Why this matters to customers, in one line. */
  why: string;
}

const ok = (s: string) => s === "verified" || s === "reverification_required";

/**
 * Onboarding progress. Mechanics can use Clutch before finishing, but identity,
 * background and insurance (plus driving record for mobile work) are required
 * before they can send estimates for real jobs.
 */
export function profileSteps(p: PublicMechanicProfile, extras: { hasPhoto: boolean; hasPricing: boolean; shared: boolean }): ProfileStep[] {
  return [
    { label: "Basic information and bio", why: "Customers read your bio to decide if you're the right person for their car.", done: p.bio.trim().length > 20, requiredForWork: false, href: "/mechanic/onboarding?edit=1" },
    { label: "Profile photo", why: "People book people. A clear photo of you is the first thing customers look for.", done: extras.hasPhoto, requiredForWork: false, href: "/mechanic/onboarding?edit=1" },
    { label: "Service area", why: "Decides which nearby requests you're matched with.", done: p.serviceRadiusMi > 0, requiredForWork: false, href: "/mechanic/onboarding?edit=1" },
    { label: "Services you offer", why: "Tells Clutch which repairs to send you before you have verified jobs.", done: p.selfReported.declaredCategories.length > 0, requiredForWork: false, href: "/mechanic/onboarding?edit=1" },
    { label: "Pricing", why: "Customers see your rate and diagnostic fee before they ask for an estimate.", done: extras.hasPricing, requiredForWork: false, href: "/mechanic/settings" },
    { label: "Verify identity", why: "Customers see whether Clutch has verified who you are. Not required to be booked; verified checks rank you higher at equal experience.", done: ok(p.safety.identity.status), requiredForWork: false, href: "/mechanic/verification" },
    { label: "Pass background check", why: "Customers see whether Clutch has verified a background check before they book. Not required to be booked.", done: ok(p.safety.background.status), requiredForWork: false, href: "/mechanic/verification" },
    ...(p.safety.drivingApplies ? [{ label: "Pass driving record check", why: "You drive to customers and test-drive their cars; customers see whether Clutch has verified your record. Not required to be booked.", done: ok(p.safety.driving_record.status), requiredForWork: false, href: "/mechanic/verification" }] : []),
    { label: "Verify insurance", why: "Customers see whether Clutch has verified active coverage; if not, they're told to ask you for proof. Not required to be booked.", done: ok(p.safety.insurance.status), requiredForWork: false, href: "/mechanic/verification" },
    { label: "Verify a certification", why: "Shows up as verified on your profile, not just something you said.", done: p.credentials.some((c) => c.provenance !== "self" && ok(c.status)), requiredForWork: false, href: "/mechanic/verification" },
    { label: "Verify work history", why: "Customers trust experience they can check, like years at a dealership.", done: p.employment.some((e) => e.provenance !== "self"), requiredForWork: false, href: "/mechanic/verification" },
    { label: "Add proof of past repairs", why: "Verified repairs are what rank you for matching jobs.", done: p.reputation.verifiedRepairs > 0, requiredForWork: false, href: "/mechanic/repairs" },
    { label: "Share your public profile", why: "Your record is yours. Sharing it brings customers who already trust you.", done: extras.shared, requiredForWork: false, href: "/mechanic/profile" },
  ];
}

export function completeness(steps: ProfileStep[]) {
  const done = steps.filter((s) => s.done).length;
  return {
    percent: Math.round((done / steps.length) * 100),
    missing: steps.filter((s) => !s.done),
    blockingWork: steps.filter((s) => s.requiredForWork && !s.done),
  };
}
