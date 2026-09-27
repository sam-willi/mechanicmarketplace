/**
 * Every upload from the browser goes through here: plan it (lib/media/prepare.ts), shrink big
 * photos and convert HEIC where the browser can decode them, then POST to /api/media and turn
 * any refusal (the app's, or the host's own "too large" page) into a plain sentence.
 *
 * Shrinking redraws the photo on a canvas as a JPEG: the camera's orientation is applied
 * (createImageBitmap "from-image"), and metadata such as GPS location is not carried over.
 */
import type { MediaTag, RepairMedia } from "@/lib/domain/types";
import { uploadLimits, mb } from "./limits";
import { fitWithin, jpegName, planUpload, PREPARE_COPY, shrinkTarget } from "./prepare";

export type UploadResult = { ok: true; media: RepairMedia; note?: string } | { ok: false; error: string };

async function shrink(file: File, steps: { maxEdge: number; quality: number }[], target: number): Promise<File | "unreadable" | "too_big"> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return "unreadable";
  }
  try {
    for (const step of steps) {
      const { width, height } = fitWithin(bitmap.width, bitmap.height, step.maxEdge);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return "unreadable";
      // JPEG has no transparency: paint white under PNG/WebP screenshots.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", step.quality));
      if (blob && blob.size <= target) return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified });
    }
    return "too_big";
  } finally {
    bitmap.close();
  }
}

export async function uploadMedia(file: File, tag: MediaTag, extra: { description?: string } = {}): Promise<UploadResult> {
  const limits = uploadLimits();
  const plan = planUpload(file, limits);
  if (plan.action === "refuse") return { ok: false, error: plan.error };
  let toSend = file;
  let note: string | undefined;
  if (plan.action === "shrink") {
    const out = await shrink(file, plan.steps, shrinkTarget(limits));
    if (out === "unreadable") return { ok: false, error: plan.reason === "heic" ? PREPARE_COPY.heicUnreadable : PREPARE_COPY.unreadable };
    if (out === "too_big") return { ok: false, error: PREPARE_COPY.stillTooBig(shrinkTarget(limits)) };
    toSend = out;
    note = plan.reason === "heic" ? `Converted from HEIC to JPEG (${mb(out.size)}).` : `Resized from ${mb(file.size)} to ${mb(out.size)} so it uploads quickly.`;
  }
  const body = new FormData();
  body.append("file", toSend);
  body.append("tag", tag);
  if (extra.description) body.append("description", extra.description);
  let res: Response;
  try {
    res = await fetch("/api/media", { method: "POST", body });
  } catch {
    return { ok: false, error: "Couldn't reach Clutch. Check your connection and try again." };
  }
  const json = (res.headers.get("content-type") ?? "").includes("application/json") ? await res.json().catch(() => null) : null;
  if (res.ok && json?.id) return { ok: true, media: json as RepairMedia, note };
  // The host's own "too large" page isn't JSON; the app's refusals are.
  if (res.status === 413 && !json?.error) return { ok: false, error: PREPARE_COPY.hostRefused(limits.maxBytes) };
  return { ok: false, error: json?.error ?? `Upload failed (${res.status}). Try again.` };
}

/** What a file picker should offer on this deployment. */
export function acceptFor(kinds: ("photo" | "video" | "audio" | "pdf")[]) {
  const l = uploadLimits();
  return kinds
    .filter((k) => (k === "video" ? l.video : k === "audio" ? l.audio : true))
    .map((k) => ({ photo: "image/*", video: "video/*", audio: "audio/*", pdf: "application/pdf" })[k])
    .join(",");
}
