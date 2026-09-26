import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * HMAC signing for the demo-account cookie. Set AUTH_SECRET in production;
 * in development a per-process secret is used (demo users just click again).
 */
const g = globalThis as unknown as { __clutchAuthSecret?: string };
function secret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET must be set in production.");
  return (g.__clutchAuthSecret ??= randomBytes(32).toString("hex"));
}

const mac = (value: string) => createHmac("sha256", secret()).update(value).digest("base64url");

export function sign(value: string) {
  return `${value}.${mac(value)}`;
}

/** Returns the original value if the signature is valid, otherwise undefined. */
export function unsign(signed: string | undefined) {
  if (!signed) return undefined;
  const i = signed.lastIndexOf(".");
  if (i <= 0) return undefined;
  const value = signed.slice(0, i);
  const a = Buffer.from(signed.slice(i + 1));
  const b = Buffer.from(mac(value));
  return a.length === b.length && timingSafeEqual(a, b) ? value : undefined;
}
