/**
 * How much one upload may be, per deployment. The same values run in the browser (to shrink or
 * refuse before sending) and on the server (to enforce).
 *
 *   hosted  Serverless hosting (Vercel) refuses request bodies over ~4.5 MB before the app runs,
 *           so files are capped at 4 MB: photos are shrunk in the browser to fit, PDFs must fit,
 *           and video/audio are off (they'd need a direct-to-storage upload, not built yet).
 *   full    A normal Node server (local, Railway, Render…): up to 40 MB, video and audio on.
 *
 * next.config.ts sets CLUTCH_UPLOAD_PROFILE at build time ("hosted" on Vercel unless overridden),
 * so the browser bundle and the server agree.
 */
export type UploadProfile = "hosted" | "full";

export type UploadLimits = { profile: UploadProfile; maxBytes: number; video: boolean; audio: boolean; resizeTargetBytes: number };

export const HOSTED_MAX_BYTES = 4_000_000;

export function uploadLimits(profile: UploadProfile = currentProfile()): UploadLimits {
  return profile === "hosted"
    ? { profile, maxBytes: HOSTED_MAX_BYTES, video: false, audio: false, resizeTargetBytes: 3_500_000 }
    : { profile, maxBytes: 40_000_000, video: true, audio: true, resizeTargetBytes: 3_500_000 };
}

export function currentProfile(): UploadProfile {
  return process.env.CLUTCH_UPLOAD_PROFILE === "hosted" ? "hosted" : "full";
}

/** Sizes as phones show them (decimal megabytes): 4,000,000 bytes is "4.0 MB". */
export const mb = (bytes: number) => `${(bytes / 1e6).toFixed(bytes < 10e6 ? 1 : 0)} MB`;
