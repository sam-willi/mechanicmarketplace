import { StripeIdentityProvider } from "./stripe";
import { TestIdentityProvider } from "./test-provider";
import type { IdentityProvider } from "./types";

/**
 * Which identity provider runs for which marketplace, and whether it's ready. Validated here so a
 * half-configured deployment says exactly what's missing instead of failing mid-check.
 *   live: CLUTCH_IDENTITY_PROVIDER=stripe_identity + STRIPE_IDENTITY_SECRET_KEY + STRIPE_IDENTITY_WEBHOOK_SECRET.
 *         "test" only with CLUTCH_TEST_PROVIDERS=on, and never on a Vercel production deployment.
 *   demo: always the test provider (fictional people never go to a real provider).
 */
export interface IdentityConfig {
  provider?: IdentityProvider;
  /** Why it isn't available, for the setup screen (never secret values). */
  problems: string[];
}

const test = new TestIdentityProvider();
let stripe: StripeIdentityProvider | undefined;

export function testProvidersAllowed() {
  return process.env.CLUTCH_TEST_PROVIDERS === "on" && process.env.VERCEL_ENV !== "production";
}

export function identityConfig(scope: "live" | "demo"): IdentityConfig {
  if (scope === "demo") return { provider: test, problems: [] };
  const key = process.env.CLUTCH_IDENTITY_PROVIDER ?? "";
  if (key === "test") return testProvidersAllowed() ? { provider: test, problems: [] } : { problems: ["The test identity provider is refused outside isolated test runs."] };
  if (key !== "stripe_identity") return { problems: [key ? `Unknown identity provider "${key}".` : "No identity provider is configured (CLUTCH_IDENTITY_PROVIDER)."] };
  const problems: string[] = [];
  const secret = process.env.STRIPE_IDENTITY_SECRET_KEY ?? "";
  const hook = process.env.STRIPE_IDENTITY_WEBHOOK_SECRET ?? "";
  if (!/^(rk|sk)_(live|test)_/.test(secret)) problems.push("STRIPE_IDENTITY_SECRET_KEY is missing or not a Stripe secret/restricted key.");
  if (!/^whsec_/.test(hook)) problems.push("STRIPE_IDENTITY_WEBHOOK_SECRET is missing or not a webhook signing secret.");
  if (problems.length) return { problems };
  return { provider: (stripe ??= new StripeIdentityProvider(secret, hook)), problems: [] };
}

/** The provider that owns a session reference (webhooks and returns), whatever is configured now. */
export function identityProviderFor(key: string, scope: "live" | "demo"): IdentityProvider | undefined {
  if (key === "test") return scope === "demo" || testProvidersAllowed() ? test : undefined;
  if (key === "stripe_identity") return identityConfig("live").provider?.key === "stripe_identity" ? identityConfig("live").provider : undefined;
  return undefined;
}

export const testIdentityProvider = test;
