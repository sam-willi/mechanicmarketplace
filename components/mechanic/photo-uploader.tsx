"use client";

import { useState, useTransition } from "react";
import { Camera, Loader2 } from "lucide-react";
import { acceptFor, uploadMedia } from "@/lib/media/upload-client";
import { uploadLimits } from "@/lib/media/limits";
import type { MediaTag } from "@/lib/domain/types";

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
  const [sizeNote, setSizeNote] = useState<string | null>(null);
  const video = uploadLimits().video;
  const [, start] = useTransition();

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    setSizeNote(null);
    const items: { id: string; kind: string }[] = [];
    try {
      for (const file of Array.from(files)) {
        const r = await uploadMedia(file, kind as MediaTag);
        if (!r.ok) {
          setError(r.error);
          continue;
        }
        if (r.note) setSizeNote(r.note);
        items.push({ id: r.media.id, kind });
      }
      if (items.length) {
        start(async () => {
          await attach(items);
          setDone((n) => n + items.length);
        });
      }
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
        {busy ? "Uploading…" : video ? "Add photos or a short video" : "Add photos"}
        <input type="file" accept={acceptFor(["photo", "video"])} multiple className="sr-only" onChange={(e) => upload(e.target.files)} />
      </label>
      {done > 0 && (
        <p className="text-[0.8125rem] font-semibold" role="status">
          {done} photo{done === 1 ? "" : "s"} added.
        </p>
      )}
      {sizeNote && (
        <p className="text-[0.8125rem] text-ink-2" role="status">
          {sizeNote}
        </p>
      )}
      {!video && <p className="text-[0.8125rem] text-ink-3">Video can&apos;t be uploaded on this version of Clutch yet; photos can.</p>}
      {error && (
        <p className="text-[0.8125rem] text-alert" role="alert">
          {error}
        </p>
      )}
      {note && <p className="text-[0.8125rem] text-ink-3">{note}</p>}
    </div>
  );
}
