import type { ScreeningKind } from "@/lib/domain/types";
import { MockScreeningProvider } from "./mock";
import type { ScreeningProvider } from "./types";

/**
 * Which vendor handles which screening kind. Configure per kind with env vars,
 * e.g. CLUTCH_IDENTITY_PROVIDER=persona, CLUTCH_BACKGROUND_PROVIDER=checkr.
 * Only "mock" is implemented in the MVP; real adapters register here.
 */
const mock = new MockScreeningProvider();

const PROVIDERS: Record<string, ScreeningProvider> = {
  mock,
  // persona: new PersonaIdentityProvider(process.env.PERSONA_API_KEY!),
  // stripe_identity: new StripeIdentityProvider(...),
  // checkr: new CheckrProvider(process.env.CHECKR_API_KEY!),
};

const ENV_KEY: Record<ScreeningKind, string> = {
  identity: "CLUTCH_IDENTITY_PROVIDER",
  background: "CLUTCH_BACKGROUND_PROVIDER",
  driving_record: "CLUTCH_DRIVING_RECORD_PROVIDER",
};

export function getScreeningProvider(kind: ScreeningKind): ScreeningProvider {
  const key = process.env[ENV_KEY[kind]] ?? "mock";
  return PROVIDERS[key] ?? mock;
}

export function getProviderByKey(key: string): ScreeningProvider {
  return PROVIDERS[key] ?? mock;
}
