/**
 * Before an upload leaves the browser: send it as is, shrink it first, or explain why it can't
 * go. Pure (no browser APIs), so it's unit-tested; lib/media/upload-client.ts carries it out.
 * The server still checks every byte (lib/media/policy.ts); this only avoids sending files the
 * host would refuse, and makes big phone photos fit.
 */
import { mb, type UploadLimits } from "./limits";

export type Candidate = { name: string; type: string; size: number };
export type Plan =
  | { action: "upload" }
  | { action: "shrink"; reason: "too_big" | "heic"; steps: { maxEdge: number; quality: number }[] }
  | { action: "refuse"; error: string };

/** Longest edge and JPEG quality to try, in order, until the photo fits. */
export const SHRINK_STEPS = [
  { maxEdge: 3000, quality: 0.86 },
  { maxEdge: 2560, quality: 0.82 },
  { maxEdge: 2048, quality: 0.8 },
  { maxEdge: 1600, quality: 0.76 },
  { maxEdge: 1280, quality: 0.72 },
];

export const PREPARE_COPY = {
  noVideo: "Video uploads aren't available on this version of Clutch yet. Describe what happens in words, or add a photo instead.",
  noAudio: "Audio uploads aren't available on this version of Clutch yet. Describe the sound in words instead (for example: a grinding noise from the front when braking).",
  documentTooBig: (size: number, max: number) => `This document is ${mb(size)}; the most Clutch can take here is ${mb(max)}. Take a photo of the page instead, or save a smaller PDF.`,
  heicUnreadable:
    "This browser can't open HEIC photos. On iPhone, pick the photo from Photos (it's converted to JPEG automatically) or set Settings › Camera › Formats to Most Compatible. You can also take a screenshot of the photo and upload that.",
  unreadable: "Couldn't read this photo. Try another one, or take a screenshot of it and upload that.",
  stillTooBig: (max: number) => `Couldn't make this photo small enough (under ${mb(max)}). Try a screenshot of it instead.`,
  clipTooBig: (size: number, max: number) => `This clip is ${mb(size)}; the most Clutch can take is ${mb(max)}. Record a shorter clip (10–20 seconds is plenty), then try again.`,
  hostRefused: (max: number) => `That file is too big to upload here (the limit is ${mb(max)}). Photos are shrunk automatically; for anything else, send a smaller file.`,
} as const;

const isHeic = (c: Candidate) => /^image\/hei[cf]/i.test(c.type) || /\.(heic|heif|hif)$/i.test(c.name);
const isRaster = (c: Candidate) => /^image\/(jpeg|jpg|pjpeg|png|webp)$/i.test(c.type) || (!c.type && /\.(jpe?g|png|webp)$/i.test(c.name));
const isVideo = (c: Candidate) => /^video\//i.test(c.type) || /\.(mp4|m4v|mov|qt|webm|3gp|3gpp|3g2)$/i.test(c.name);
const isAudio = (c: Candidate) => /^audio\//i.test(c.type) || /\.(m4a|mp3|wav|wave|ogg|oga|opus|aac|weba)$/i.test(c.name);

export function planUpload(c: Candidate, limits: UploadLimits): Plan {
  if (isVideo(c) && !isAudio(c) && !limits.video) return { action: "refuse", error: PREPARE_COPY.noVideo };
  if (isAudio(c) && !limits.audio) return { action: "refuse", error: PREPARE_COPY.noAudio };
  // HEIC can't be stored (most browsers can't show it); convert it where this browser can decode it.
  if (isHeic(c)) return { action: "shrink", reason: "heic", steps: SHRINK_STEPS };
  if (isRaster(c)) return c.size > limits.resizeTargetBytes ? { action: "shrink", reason: "too_big", steps: SHRINK_STEPS } : { action: "upload" };
  if ((isVideo(c) || isAudio(c)) && c.size > limits.maxBytes) return { action: "refuse", error: PREPARE_COPY.clipTooBig(c.size, limits.maxBytes) };
  if (c.size > limits.maxBytes) return { action: "refuse", error: /pdf/i.test(c.type) || /\.pdf$/i.test(c.name) ? PREPARE_COPY.documentTooBig(c.size, limits.maxBytes) : PREPARE_COPY.hostRefused(limits.maxBytes) };
  // Everything else goes to the server, which decides from the bytes.
  return { action: "upload" };
}

/** The size a shrunk photo is allowed to be (a little under the host's cap). */
export const shrinkTarget = (limits: UploadLimits) => Math.min(limits.resizeTargetBytes, limits.maxBytes);

/** Fit width × height inside maxEdge, keeping the aspect ratio; never enlarges. */
export function fitWithin(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** "IMG_1234.HEIC" → "IMG_1234.jpg" (the server makes the stored name safe too). */
export const jpegName = (name: string) => `${name.replace(/\.[^.]*$/, "") || "photo"}.jpg`;
