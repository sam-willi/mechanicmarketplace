"use client";

import { useState, useTransition } from "react";
import { Camera, Loader2 } from "lucide-react";

/** Add or replace the car's photo. Uploads, then sets it on the vehicle. */
export function VehiclePhotoButton({ setPhoto, hasPhoto }: { setPhoto: (mediaId: string) => Promise<void>; hasPhoto: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("tag", "vehicle");
      const res = await fetch("/api/media", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      start(() => setPhoto(json.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-[0.875rem] font-semibold underline decoration-rule underline-offset-[3px] hover:decoration-ink ${busy ? "pointer-events-none opacity-60" : ""}`}>
        {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Camera size={15} aria-hidden />}
        {busy ? "Uploading…" : hasPhoto ? "Change photo" : "Add a photo of your car"}
        <input type="file" accept="image/*" className="sr-only" onChange={(e) => upload(e.target.files)} />
      </label>
      {error && <p className="text-[0.8125rem] text-alert" role="alert">{error}</p>}
    </div>
  );
}
