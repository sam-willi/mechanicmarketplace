import { deliveryConfig, type DeliveryConfig } from "./config";

/**
 * The interface a real email (or later SMS) provider implements. No provider is wired up:
 * `providerFromConfig` returns null until an adapter is added here and configured, and the
 * worker then records "no provider" (retryable) instead of sending.
 *
 * Contract for implementers:
 *  - `send` must pass `idempotencyKey` to the provider (a header or message id) so a retry of
 *    the same event can never produce a second message.
 *  - `lookup`, if the provider supports it, finds a message already accepted under that key
 *    (used after a timeout, when the first send may have succeeded).
 *  - Throw ProviderError with kind "retryable" (rate limits, 5xx), "permanent" (bad address,
 *    rejected) or "timeout" (no answer; outcome unknown).
 */
export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
}

export interface EmailProvider {
  readonly key: string;
  send(msg: OutboundEmail, opts: { timeoutMs: number }): Promise<{ messageId: string }>;
  lookup?(idempotencyKey: string): Promise<{ messageId: string } | null>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: "retryable" | "permanent" | "timeout",
    readonly code: string = kind,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Registered adapters. Empty on purpose: nothing can send until one is added and configured. */
const ADAPTERS: Record<string, (cfg: DeliveryConfig) => EmailProvider> = {};

/** The provider to use, or null when alerts are off (not configured, or not switched on). */
export function providerFromConfig(cfg: DeliveryConfig = deliveryConfig()): EmailProvider | null {
  if (!cfg.active) return null;
  const make = ADAPTERS[cfg.provider];
  return make ? make(cfg) : null;
}
