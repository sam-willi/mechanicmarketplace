"use client";

import { useState } from "react";
import { Camera, Loader2, X } from "lucide-react";

/** Optional photo on a review. Shown on the mechanic's profile, labelled as the customer's photo. */
export function ReviewPhoto() {
  const [m, setM] = useState<{ id: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function upload(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Choose a photo.");
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("tag", "after");
      const res = await fetch("/api/media", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setM({ id: json.id, url: json.url });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <p className="field-label">A photo of the finished work (optional)</p>
      <p className="mt-0.5 text-[0.8125rem] text-ink-2">Shown with your review on the mechanic&apos;s profile. Keep your licence plate and house number out of it.</p>
      <input type="hidden" name="reviewPhotoId" value={m?.id ?? ""} readOnly />
      <div className="mt-2 flex items-center gap-3">
        {m ? (
          <span className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.url} alt="Your photo" className="size-20 border border-rule object-cover" />
            <button type="button" onClick={() => setM(null)} className="absolute -top-2 -right-2 grid size-7 place-items-center rounded-full bg-brand text-sheet" aria-label="Remove photo">
              <X size={14} aria-hidden />
            </button>
          </span>
        ) : null}
        <label className={`btn btn-line min-h-11 cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Camera size={16} aria-hidden />}
          {m ? "Change photo" : "Add a photo"}
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
        </label>
      </div>
      {error ? <p className="mt-1 text-[0.8125rem] text-alert">{error}</p> : null}
    </div>
  );
}
