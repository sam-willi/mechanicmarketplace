import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookRejected } from "./types";

/** Webhooks older (or newer) than this are refused, so a captured request can't be replayed later. */
export const TOLERANCE_SECONDS = 300;

/**
 * Stripe's scheme (also used by the test adapter): header `t=<unix>,v1=<hex hmac-sha256 of "t.body">`.
 * Constant-time comparison; several v1 values (secret rotation) are allowed.
 */
export function verifySignature(rawBody: string, header: string | null, secret: string, now = Date.now()) {
  if (!header) throw new WebhookRejected("missing signature");
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]).filter((p) => p.length === 2)) as Record<string, string>;
  const t = Number(header.match(/(?:^|,)t=(\d+)/)?.[1]);
  const sigs = [...header.matchAll(/(?:^|,)v1=([0-9a-f]+)/g)].map((m) => m[1]);
  if (!Number.isFinite(t) || !sigs.length || !parts.t) throw new WebhookRejected("malformed signature");
  if (Math.abs(now / 1000 - t) > TOLERANCE_SECONDS) throw new WebhookRejected("stale signature");
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  const ok = sigs.some((s) => {
    const got = Buffer.from(s, "hex");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  if (!ok) throw new WebhookRejected("bad signature");
}

export function sign(rawBody: string, secret: string, now = Date.now()) {
  const t = Math.floor(now / 1000);
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")}`;
}
