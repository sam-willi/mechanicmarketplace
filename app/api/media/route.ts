import { NextResponse } from "next/server";
import { getAccount, getSession } from "@/lib/session";
import { requestScope } from "@/lib/data";
import { putMedia } from "@/lib/data/mock/media-store";
import { checkUpload } from "@/lib/media/policy";
import { uploadLimits } from "@/lib/media/limits";
import { PREPARE_COPY } from "@/lib/media/prepare";
import type { MediaTag } from "@/lib/domain/types";

const TAGS: MediaTag[] = ["portrait", "before", "after", "parts", "completed", "diagnostic", "vehicle", "dashboard", "damage", "leak", "engine_bay", "wheel", "part", "issue", "sound", "vin", "prior_estimate", "customer_part", "answer", "other"];

/**
 * Upload one file as soon as it's chosen. Customers: request media and car photos. Mechanics:
 * repair photos and videos. What's accepted is decided from the file's bytes (lib/media/policy.ts).
 */
export async function POST(request: Request) {
  const s = await getSession();
  // A brand-new mechanic account has no mechanic profile yet; it may upload its portrait during onboarding.
  const acct = s.role === "guest" ? await getAccount() : null;
  if (s.role !== "customer" && s.role !== "mechanic" && !acct) return NextResponse.json({ error: "Sign in to upload." }, { status: 401 });
  // Refuse an oversized body before reading it (multipart overhead allowed for). On Vercel the
  // host refuses anything over ~4.5 MB before this runs; the browser shrinks photos to fit.
  const limits = uploadLimits();
  const tooBig = () => NextResponse.json({ error: PREPARE_COPY.hostRefused(limits.maxBytes) }, { status: 413 });
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > limits.maxBytes + 64 * 1024) return tooBig();
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Send the file as multipart form data." }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > limits.maxBytes) return tooBig();
  const tagRaw = String(form.get("tag") ?? "other") as MediaTag;
  const tag = TAGS.includes(tagRaw) ? tagRaw : "other";
  if (acct && tag !== "portrait") return NextResponse.json({ error: "Finish your profile first." }, { status: 403 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const verdict = checkUpload({ name: file.name, declaredType: file.type, bytes, tag, role: s.role === "customer" ? "customer" : "mechanic" }, limits);
  if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: verdict.status });
  const ownerId = s.role === "guest" ? acct!.user.id : s.userId;
  const meta = await putMedia(await requestScope(), ownerId, { displayName: verdict.displayName, contentType: verdict.contentType, kind: verdict.kind, bytes }, tag, String(form.get("description") ?? "").slice(0, 300) || undefined);
  return NextResponse.json(meta);
}
