import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived, private links to verification evidence (insurance certificates, credentials). A link
 * is bound to one file AND one viewer and expires in minutes, so a copied URL is useless to anyone
 * else and soon useless to its reviewer too. Issued only by the review page, only for the files
 * attached to the record being reviewed.
 */
export const DOC_LINK_SECONDS = 300;

function secret() {
  const s = process.env.CLUTCH_SIGNING_SECRET || process.env.AUTH_SECRET;
  if (!s && process.env.NODE_ENV === "production") throw new Error("CLUTCH_SIGNING_SECRET (or AUTH_SECRET) is required to issue document links.");
  return s || "clutch-dev-signing-secret";
}

const mac = (mediaId: string, viewerId: string, exp: number) => createHmac("sha256", secret()).update(`doc:${mediaId}:${viewerId}:${exp}`).digest("hex");

export function docLink(mediaId: string, viewerId: string, now = Date.now()) {
  const exp = Math.floor(now / 1000) + DOC_LINK_SECONDS;
  return `/api/media/${mediaId}?vt=${exp}.${mac(mediaId, viewerId, exp)}`;
}

export function checkDocToken(token: string | null, mediaId: string, viewerId: string, now = Date.now()) {
  const m = /^(\d+)\.([0-9a-f]{64})$/.exec(token ?? "");
  if (!m) return false;
  const exp = Number(m[1]);
  if (exp < now / 1000) return false;
  const want = Buffer.from(mac(mediaId, viewerId, exp), "hex");
  const got = Buffer.from(m[2], "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}
