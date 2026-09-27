import type { ScreeningKind, VerificationStatus } from "@/lib/domain/types";

/**
 * Provider-agnostic screening contracts. The mechanic model never references a
 * vendor: vendor identity lives only on ScreeningCheck.provider/providerRef.
 * Swap implementations in ./registry.ts (Persona, Stripe Identity, Jumio for
 * identity; Checkr, Sterling for background and driving record).
 */

export interface StartCheckInput {
  mechanicId: string;
  kind: ScreeningKind;
  /** Timestamp the mechanic gave FCRA disclosure consent (background / MVR). */
  consentAt?: string;
}

export interface StartCheckResult {
  provider: string;
  providerRef: string;
  /** Hosted flow the mechanic would be sent to (ID + selfie capture, consent form). */
  hostedUrl?: string;
  status: VerificationStatus; // usually "in_progress"
}

export interface CheckResult {
  providerRef: string;
  status: VerificationStatus;
  /** Raw adjudication. Stored privately; never leaves the server. */
  result?: "clear" | "consider" | "failed";
  completedAt?: string;
  /** Rescreen date the provider or policy dictates. */
  expiresAt?: string;
}

export interface ScreeningProvider {
  readonly key: string;
  readonly kinds: ScreeningKind[];
  startCheck(input: StartCheckInput): Promise<StartCheckResult>;
  getResult(providerRef: string): Promise<CheckResult>;
  /** Normalize a vendor webhook payload into a CheckResult. */
  parseWebhook(payload: unknown): CheckResult | null;
}
