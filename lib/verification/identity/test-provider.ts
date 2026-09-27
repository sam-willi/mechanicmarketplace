import { randomBytes } from "node:crypto";
import type { CheckStatus } from "../model";
import { verifySignature } from "./signature";
import { WebhookRejected, type IdentityProvider, type IdentityResult, type IdentitySession, type IdentitySessionStart, type WebhookEvent } from "./types";

/**
 * Deterministic stand-in for a hosted identity provider, for tests and the fictional demo only
 * (config refuses it in production). It keeps its sessions server-side like a real provider,
 * serves its own "hosted" page (/verification-test/identity/[ref]) where the tester picks an
 * outcome, and reports it through the same signed webhook route. Statements name it plainly:
 * "verified by Clutch's test provider (not a real check)".
 */
type Outcome = "verified" | "selfie_mismatch" | "document_expired" | "manipulated" | "cancelled" | "processing";
type Session = { recordId: string; accountId: string; scope: "live" | "demo"; returnUrl: string; outcome?: Outcome; name?: string };

const g = globalThis as { __clutchTestIdentity?: Map<string, Session> };
const store: Map<string, Session> = (g.__clutchTestIdentity ??= new Map<string, Session>());

export function testIdentitySecret() {
  return process.env.CLUTCH_TEST_IDENTITY_SECRET || process.env.AUTH_SECRET || "clutch-test-identity-secret";
}

export class TestIdentityProvider implements IdentityProvider {
  readonly key = "test";
  readonly displayName = "Clutch's test provider (not a real check)";

  async createSession(input: IdentitySessionStart): Promise<IdentitySession> {
    // Idempotent like a real provider: the same key returns the same session.
    for (const [ref, s] of store) if (s.recordId === input.recordId && !s.outcome) return { providerRef: ref, url: `/verification-test/identity/${ref}` };
    const ref = `test_vs_${randomBytes(9).toString("hex")}`;
    store.set(ref, { recordId: input.recordId, accountId: input.accountId, scope: input.scope, returnUrl: input.returnUrl });
    return { providerRef: ref, url: `/verification-test/identity/${ref}` };
  }

  /** The test page's choice (what a real provider decides on its side). */
  complete(ref: string, outcome: Outcome, nameOnId?: string) {
    const s = store.get(ref);
    if (!s) throw new WebhookRejected("unknown test session");
    s.outcome = outcome;
    s.name = nameOnId;
    return s;
  }

  session(ref: string) {
    return store.get(ref);
  }

  async fetchResult(providerRef: string, accountName: string): Promise<IdentityResult> {
    const s = store.get(providerRef);
    if (!s) throw new WebhookRejected("unknown test session");
    const base = { providerRef, recordId: s.recordId, accountId: s.accountId, scope: s.scope };
    const map: Record<Outcome, { status: CheckStatus; reasonCodes: string[] }> = {
      verified: { status: "verified", reasonCodes: ["provider_verified"] },
      selfie_mismatch: { status: "needs_more_info", reasonCodes: ["selfie_retake"] },
      document_expired: { status: "needs_more_info", reasonCodes: ["document_expired"] },
      manipulated: { status: "failed", reasonCodes: ["not_authentic"] },
      cancelled: { status: "not_started", reasonCodes: ["session_cancelled"] },
      processing: { status: "under_review", reasonCodes: [] },
    };
    if (!s.outcome) return { ...base, status: "in_progress", reasonCodes: [] };
    const r = map[s.outcome];
    if (r.status === "verified" && s.name) {
      const words = (x: string) => x.toLowerCase().split(/\s+/).filter(Boolean);
      const matches = words(s.name).every((w) => words(accountName).includes(w));
      if (!matches) return { ...base, status: "needs_more_info", reasonCodes: ["name_mismatch"], nameMatches: false };
      return { ...base, ...r, nameMatches: true };
    }
    return { ...base, ...r };
  }

  verifyWebhook(rawBody: string, headers: Headers, now = Date.now()): WebhookEvent {
    verifySignature(rawBody, headers.get("stripe-signature"), testIdentitySecret(), now);
    const e = JSON.parse(rawBody) as { id?: string; data?: { object?: { id?: string } } };
    if (!e.id || !e.data?.object?.id) throw new WebhookRejected("not a test identity event");
    return { id: e.id, providerRef: e.data.object.id };
  }
}
