import { NextResponse } from "next/server";
import { getAccount, getSession } from "@/lib/session";
import { MAX_MEDIA_BYTES, putMedia } from "@/lib/data/mock/media-store";
import type { MediaTag } from "@/lib/domain/types";

const TAGS: MediaTag[] = ["portrait", "before", "after", "parts", "completed", "diagnostic", "vehicle", "dashboard", "damage", "leak", "engine_bay", "wheel", "part", "issue", "sound", "vin", "prior_estimate", "customer_part", "answer", "other"];

const MECHANIC_TAGS: MediaTag[] = ["portrait", "before", "after", "parts", "completed", "diagnostic", "vehicle"];

/** Upload one file as soon as it's chosen. Customers: request media and car photos. Mechanics: repair photos only. */
export async function POST(request: Request) {
  const s = await getSession();
  // A brand-new mechanic account has no mechanic profile yet; it may upload its portrait during onboarding.
  const acct = s.role === "guest" ? await getAccount() : null;
  if (s.role !== "customer" && s.role !== "mechanic" && !acct) return NextResponse.json({ error: "Sign in to upload." }, { status: 401 });
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Send the file as multipart form data." }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_MEDIA_BYTES) return NextResponse.json({ error: "That file is over 40 MB. Try a shorter clip." }, { status: 413 });
  const tagRaw = String(form.get("tag") ?? "other") as MediaTag;
  const tag = TAGS.includes(tagRaw) ? tagRaw : "other";
  if (acct && tag !== "portrait") return NextResponse.json({ error: "Finish your profile first." }, { status: 403 });
  if (s.role === "mechanic" && !MECHANIC_TAGS.includes(tag)) return NextResponse.json({ error: "Mechanics can upload repair photos only." }, { status: 403 });
  const ownerId = s.role === "guest" ? acct!.user.id : s.userId;
  const meta = await putMedia(ownerId, { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }, tag, String(form.get("description") ?? "") || undefined);
  return NextResponse.json(meta);
}
