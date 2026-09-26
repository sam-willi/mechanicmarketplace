"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";

/** Upload a portrait and keep its URL in a hidden field so the onboarding form saves it. */
export function PortraitUpload({ current }: { current?: string }) {
  const [url, setUrl] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  // Let the live preview (which listens to the form) pick up the new photo.
  useEffect(() => {
    ref.current?.form?.dispatchEvent(new Event("change", { bubbles: true }));
  }, [url]);
  async function upload(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Choose a photo.");
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("tag", "portrait");
      const res = await fetch("/api/media", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setUrl(json.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center gap-4">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="Your portrait" className="size-24 border border-rule object-cover" />
      ) : (
        <span className="grid size-24 place-items-center border border-dashed border-rule bg-paper text-ink-3" aria-hidden>
          <Camera size={26} />
        </span>
      )}
      <div>
        <input ref={ref} type="hidden" name="photoUrl" value={url} readOnly />
        <label className={`btn btn-line min-h-11 cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Camera size={16} aria-hidden />}
          {url ? "Change photo" : "Add your photo"}
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
        </label>
        {error ? <p className="mt-1 text-[0.8125rem] text-alert">{error}</p> : null}
      </div>
    </div>
  );
}
