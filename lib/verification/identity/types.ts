import type { CheckStatus } from "../model";

/**
 * A hosted government-ID + live-selfie + face-match flow run by a provider (Stripe Identity in
 * production). The provider captures the ID and selfie; Clutch starts sessions server-side, sends
 * the mechanic to the provider's short-lived URL, and learns the result only from a signed webhook
 * followed by a server-side fetch. Nothing from the return URL is trusted.
 */
export interface IdentitySessionStart {
  /** Our record, the signed-in account it's bound to, and which marketplace it's in. */
  recordId: string;
  accountId: string;
  scope: "live" | "demo";
  /** Where the provider sends the mechanic back (a Clutch page; carries no result). */
  returnUrl: string;
  /** Idempotency for the provider call: the same record never opens two sessions by accident. */
  idempotencyKey: string;
}

export interface IdentitySession {
  providerRef: string;
  /** Single-use, short-lived hosted URL (never stored). */
  url: string;
}

/** What Clutch keeps from a provider result: the minimum for proof and support. */
export interface IdentityResult {
  providerRef: string;
  status: CheckStatus;
  reasonCodes: string[];
  /** The name on the ID matched the account name (yes/no only; the name itself is discarded). */
  nameMatches?: boolean;
  /** Our record and account, as the provider echoed them back in metadata. */
  recordId?: string;
  accountId?: string;
  scope?: "live" | "demo";
}

export interface WebhookEvent {
  /** Provider event id: the idempotency key. */
  id: string;
  providerRef: string;
}

export interface IdentityProvider {
  readonly key: string;
  /** Display name for statements ("verified by Stripe Identity"). */
  readonly displayName: string;
  createSession(input: IdentitySessionStart): Promise<IdentitySession>;
  /** Read the session from the provider, server to server, and map it. */
  fetchResult(providerRef: string, accountName: string): Promise<IdentityResult>;
  /** Verify the signature and freshness of a webhook and return the event, or throw. */
  verifyWebhook(rawBody: string, headers: Headers, now?: number): WebhookEvent;
}

export class ProviderUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailable";
  }
}

export class WebhookRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookRejected";
  }
}
