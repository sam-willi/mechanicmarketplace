"use client";

import { useState, useTransition } from "react";
import { Camera, Loader2 } from "lucide-react";

const KINDS = [
  ["before", "Before"],
  ["after", "After"],
  ["parts", "Old parts"],
  ["diagnostic", "Diagnostic"],
  ["vehicle", "Vehicle"],
] as const;

/**
 * Mechanic photo upload for a job or a repair record. Pick what the photo
 * shows, then take or choose photos. Each one is uploaded and attached.
 */
export function RepairPhotoUploader({ attach, note }: { attach: (items: { id: string; kind: string }[]) => Promise<void>; note?: string }) {
  const [kind, setKind] = useState<string>("before");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const [, start] = useTransition();

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    const items: { id: string; kind: string }[] = [];
    try {
      for (const file of Array.from(files)) {
        if (!/^(image|video)\//.test(file.type)) continue;
        const body = new FormData();
        body.append("file", file);
        body.append("tag", kind);
        const res = await fetch("/api/media", { method: "POST", body });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Upload failed");
        items.push({ id: json.id, kind });
      }
      if (items.length) {
        start(async () => {
          await attach(items);
          setDone((n) => n + items.length);
        });
      } else setError("Choose a photo or video.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <fieldset>
        <legend className="field-label">What does the photo show?</legend>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {KINDS.map(([k, label]) => (
            <label
              key={k}
              className="cursor-pointer border border-rule bg-sheet px-3 py-1.5 text-[0.875rem] font-semibold has-[:checked]:border-brand has-[:checked]:bg-brand has-[:checked]:text-sheet"
            >
              <input type="radio" name="photo-kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className={`btn btn-line min-h-11 cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
        {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Camera size={16} aria-hidden />}
        {busy ? "Uploading…" : "Add photos or a short video"}
        <input type="file" accept="image/*,video/*" multiple className="sr-only" onChange={(e) => upload(e.target.files)} />
      </label>
      {done > 0 && (
        <p className="text-[0.8125rem] font-semibold" role="status">
          {done} photo{done === 1 ? "" : "s"} added.
        </p>
      )}
      {error && (
        <p className="text-[0.8125rem] text-alert" role="alert">
          {error}
        </p>
      )}
      {note && <p className="text-[0.8125rem] text-ink-3">{note}</p>}
    </div>
  );
}
