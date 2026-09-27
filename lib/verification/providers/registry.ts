import type { ScreeningKind } from "@/lib/domain/types";
import { MockScreeningProvider } from "./mock";
import type { ScreeningProvider } from "./types";

/**
 * Background check and driving record: an external consumer-reporting provider (e.g. Checkr),
 * with FCRA disclosure and consent captured first. Identity is NOT here: it's a hosted
 * ID + selfie flow (lib/verification/identity).
 *
 * No real adapter ships yet. Real mechanics see a setup state until BOTH a provider is configured
 * (CLUTCH_BACKGROUND_PROVIDER) and the adjudication policy is approved
 * (CLUTCH_BACKGROUND_POLICY_APPROVED=yes); a result is never invented. The mock runs only for the
 * fictional demo.
 */
const mock = new MockScreeningProvider();

const PROVIDERS: Record<string, ScreeningProvider> = {
  mock,
  // checkr: new CheckrProvider(process.env.CHECKR_API_KEY!),  // not implemented: needs an approved policy first
};

export function getScreeningProvider(kind: ScreeningKind, scope: "live" | "demo" = "live"): ScreeningProvider {
  if (scope === "demo") return mock;
  const key = process.env.CLUTCH_BACKGROUND_PROVIDER ?? "";
  return PROVIDERS[key] && key !== "mock" ? PROVIDERS[key] : mock;
}

export function getProviderByKey(key: string): ScreeningProvider {
  return PROVIDERS[key] ?? mock;
}

/** Why background/driving checks can't run for real mechanics yet (setup screen; no secrets). */
export function screeningProblems(): string[] {
  const problems: string[] = [];
  const key = process.env.CLUTCH_BACKGROUND_PROVIDER ?? "";
  if (!key || key === "mock") problems.push("No background-check provider is configured (CLUTCH_BACKGROUND_PROVIDER).");
  else if (!PROVIDERS[key]) problems.push(`"${key}" has no adapter in this version.`);
  if (process.env.CLUTCH_BACKGROUND_POLICY_APPROVED !== "yes") problems.push("The adjudication policy hasn't been approved (CLUTCH_BACKGROUND_POLICY_APPROVED).");
  return problems;
}

/**
 * Whether a check of this kind can actually be run for someone in this marketplace. Identity is
 * decided by lib/verification/identity/config.ts. The mock only stands in for fictional (demo)
 * people; for real mechanics a check that no real provider runs is never started or approved.
 */
export function screeningOpen(kind: ScreeningKind, scope: "live" | "demo") {
  if (scope === "demo") return true;
  if (kind === "identity") return false;
  return screeningProblems().length === 0;
}
