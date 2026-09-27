import type { CheckStatus } from "../model";
import { verifySignature } from "./signature";
import { ProviderUnavailable, WebhookRejected, type IdentityProvider, type IdentityResult, type IdentitySession, type IdentitySessionStart, type WebhookEvent } from "./types";

/**
 * Stripe Identity (https://docs.stripe.com/identity). Plain HTTPS with a restricted secret key; no
 * SDK. The document and selfie are captured and kept by Stripe. Clutch reads the session status,
 * its error code and, to compare names, the verified name, which is compared here and discarded.
 */
const API = "https://api.stripe.com/v1";

/** Stripe `last_error.code` → our reason code, and whether the mechanic can simply try again. */
const ERRORS: Record<string, { code: string; status: CheckStatus }> = {
  document_expired: { code: "document_expired", status: "needs_more_info" },
  document_type_not_supported: { code: "id_unsupported", status: "needs_more_info" },
  document_unverified_other: { code: "document_unreadable", status: "needs_more_info" },
  selfie_document_missing_photo: { code: "selfie_retake", status: "needs_more_info" },
  selfie_face_mismatch: { code: "selfie_retake", status: "needs_more_info" },
  selfie_unverified_other: { code: "selfie_retake", status: "needs_more_info" },
  selfie_manipulated: { code: "not_authentic", status: "failed" },
  consent_declined: { code: "session_cancelled", status: "not_started" },
  abandoned: { code: "session_cancelled", status: "not_started" },
};

type StripeSession = {
  id: string;
  status: "requires_input" | "processing" | "verified" | "canceled";
  url?: string | null;
  last_error?: { code?: string | null } | null;
  metadata?: Record<string, string>;
  verified_outputs?: { first_name?: string | null; last_name?: string | null } | null;
};

export function mapStripe(s: StripeSession, accountName: string): IdentityResult {
  const meta = s.metadata ?? {};
  const base = { providerRef: s.id, recordId: meta.clutch_record, accountId: meta.clutch_account, scope: meta.clutch_scope === "demo" ? ("demo" as const) : ("live" as const) };
  if (s.status === "verified") {
    const out = s.verified_outputs;
    const nameMatches = out?.first_name || out?.last_name ? sameName(`${out.first_name ?? ""} ${out.last_name ?? ""}`, accountName) : undefined;
    // A verified ID in someone else's name is not this mechanic's identity.
    if (nameMatches === false) return { ...base, status: "needs_more_info", reasonCodes: ["name_mismatch"], nameMatches };
    return { ...base, status: "verified", reasonCodes: ["provider_verified"], nameMatches };
  }
  if (s.status === "processing") return { ...base, status: "under_review", reasonCodes: [] };
  if (s.status === "canceled") return { ...base, status: "not_started", reasonCodes: ["session_cancelled"] };
  // requires_input: nothing submitted yet (no error), or a check the mechanic can retry.
  const code = s.last_error?.code ?? "";
  if (!code) return { ...base, status: "in_progress", reasonCodes: [] };
  const m = ERRORS[code] ?? { code: "provider_error", status: "needs_more_info" as CheckStatus };
  return { ...base, status: m.status, reasonCodes: [m.code] };
}

/** Loose, case- and accent-insensitive: every word of the shorter name appears in the other. */
export function sameName(a: string, b: string) {
  const words = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const [x, y] = [words(a), words(b)];
  if (!x.length || !y.length) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every((w) => long.includes(w));
}

export class StripeIdentityProvider implements IdentityProvider {
  readonly key = "stripe_identity";
  readonly displayName = "Stripe Identity";
  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async call(path: string, init: RequestInit & { form?: Record<string, string> } = {}) {
    const body = init.form ? new URLSearchParams(init.form).toString() : undefined;
    let res: Response;
    try {
      res = await this.fetcher(`${API}${path}`, {
        ...init,
        body,
        headers: { Authorization: `Bearer ${this.secretKey}`, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}), ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ProviderUnavailable("Stripe Identity didn't respond.");
    }
    if (res.status >= 500 || res.status === 429) throw new ProviderUnavailable(`Stripe Identity is unavailable (${res.status}).`);
    const json = (await res.json().catch(() => ({}))) as StripeSession & { error?: { message?: string } };
    if (!res.ok) throw new Error(`Stripe Identity refused the request (${res.status}).`);
    return json;
  }

  async createSession(input: IdentitySessionStart): Promise<IdentitySession> {
    const s = await this.call("/identity/verification_sessions", {
      method: "POST",
      headers: { "Idempotency-Key": input.idempotencyKey },
      form: {
        type: "document",
        "options[document][require_live_capture]": "true",
        "options[document][require_matching_selfie]": "true",
        "options[document][allowed_types][0]": "driving_license",
        "options[document][allowed_types][1]": "id_card",
        "options[document][allowed_types][2]": "passport",
        "metadata[clutch_record]": input.recordId,
        "metadata[clutch_account]": input.accountId,
        "metadata[clutch_scope]": input.scope,
        return_url: input.returnUrl,
      },
    });
    if (!s.url) throw new ProviderUnavailable("Stripe Identity didn't return a verification link.");
    return { providerRef: s.id, url: s.url };
  }

  async fetchResult(providerRef: string, accountName: string): Promise<IdentityResult> {
    if (!/^vs_[A-Za-z0-9]+$/.test(providerRef)) throw new WebhookRejected("unexpected session id");
    const s = await this.call(`/identity/verification_sessions/${providerRef}?expand[]=verified_outputs`);
    return mapStripe(s, accountName);
  }

  verifyWebhook(rawBody: string, headers: Headers, now = Date.now()): WebhookEvent {
    verifySignature(rawBody, headers.get("stripe-signature"), this.webhookSecret, now);
    const e = JSON.parse(rawBody) as { id?: string; type?: string; data?: { object?: { id?: string; object?: string } } };
    if (!e.id || !e.type?.startsWith("identity.verification_session.") || e.data?.object?.object !== "identity.verification_session" || !e.data.object.id)
      throw new WebhookRejected("not an identity session event");
    return { id: e.id, providerRef: e.data.object.id };
  }
}
