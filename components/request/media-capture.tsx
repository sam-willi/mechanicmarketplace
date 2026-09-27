"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Camera, Cog, Disc3, Droplets, FileText, FileUp, Gauge, Hash, Loader2, Mic, TriangleAlert, Video, X } from "lucide-react";
import type { MediaTag, RepairMedia } from "@/lib/domain/types";
import { acceptFor, uploadMedia } from "@/lib/media/upload-client";
import { uploadLimits } from "@/lib/media/limits";

type Mode = "photo" | "video" | "audio" | "file";

const MODES: Record<Mode, { label: string; accept: string; capture?: "environment" | "user"; icon: typeof Camera }> = {
  photo: { label: "Take photo", accept: acceptFor(["photo"]), capture: "environment", icon: Camera },
  video: { label: "Record video", accept: acceptFor(["video"]), capture: "environment", icon: Video },
  audio: { label: "Record audio", accept: acceptFor(["audio"]), icon: Mic },
  file: { label: "Upload", accept: acceptFor(["photo", "video", "audio", "pdf"]), icon: FileUp },
};

/**
 * Upload-as-you-go media. Each file is stored the moment it's chosen, so it
 * survives going back a step, autosave, and leaving and returning.
 */
export function MediaCapture({
  tag,
  value,
  onChange,
  modes = ["photo", "video", "file"],
  hint,
  compact = false,
}: {
  tag: MediaTag;
  value: RepairMedia[];
  onChange: (next: RepairMedia[]) => void;
  modes?: Mode[];
  hint?: string;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Video and audio aren't offered where this deployment can't take them (lib/media/limits.ts).
  const limits = uploadLimits();
  const shown = modes.filter((m) => (m === "video" ? limits.video : m === "audio" ? limits.audio : true));
  const dropped = modes.filter((m) => !shown.includes(m));
  const mine = value.filter((m) => m.tag === tag);
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setNote(null);
    for (const file of Array.from(files)) {
      setBusy((n) => n + 1);
      try {
        const r = await uploadMedia(file, tag);
        if (!r.ok) {
          setError(r.error);
          continue;
        }
        if (r.note) setNote(r.note);
        latest.current = [...latest.current, r.media];
        onChange(latest.current);
      } finally {
        setBusy((n) => n - 1);
      }
    }
  }

  return (
    <div className="space-y-3">
      <div className={`grid gap-2 ${compact ? "grid-cols-2 sm:flex sm:flex-wrap" : "grid-cols-2 sm:grid-cols-4"}`}>
        {shown.map((m) => (
          <CaptureButton key={m} mode={m} onFiles={upload} />
        ))}
      </div>
      {dropped.length ? (
        <p className="text-[0.8125rem] text-ink-2">
          {dropped.includes("audio") && !shown.length
            ? "Recordings can't be uploaded on this version of Clutch yet. Describe the sound in words instead."
            : `${dropped.includes("video") && dropped.includes("audio") ? "Video and audio" : dropped.includes("video") ? "Video" : "Audio"} can't be uploaded on this version of Clutch yet; photos can.`}
        </p>
      ) : null}
      {hint && shown.length ? <p className="text-[0.8125rem] text-ink-3">{hint}</p> : null}
      {(mine.length > 0 || busy > 0) && (
        <ul className="flex flex-wrap gap-2" aria-label="Attached files">
          {mine.map((m) => (
            <li key={m.id} className="relative">
              <MediaThumb m={m} size={84} />
              <button
                type="button"
                onClick={() => onChange(latest.current.filter((x) => x.id !== m.id))}
                className="absolute -top-2 -right-2 grid size-7 place-items-center border border-rule bg-sheet text-ink shadow-sm"
                aria-label={`Remove ${m.name}`}
              >
                <X size={14} aria-hidden />
              </button>
            </li>
          ))}
          {busy > 0 && (
            <li className="grid size-[84px] place-items-center border border-dashed border-rule bg-sheet text-ink-3" aria-live="polite">
              <Loader2 size={18} className="animate-spin" aria-label="Uploading" />
            </li>
          )}
        </ul>
      )}
      {note ? (
        <p className="text-[0.8125rem] text-ink-2" role="status">
          {note}
        </p>
      ) : null}
      {error ? (
        <p className="text-[0.875rem] text-alert" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CaptureButton({ mode, onFiles }: { mode: Mode; onFiles: (f: FileList | null) => void }) {
  const id = useId();
  const cfg = MODES[mode];
  const Icon = cfg.icon;
  return (
    <label
      htmlFor={id}
      className="flex min-h-12 cursor-pointer items-center justify-center gap-2 border border-ink bg-sheet px-3 text-[0.875rem] font-bold text-ink transition-colors hover:bg-paper has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-carbon"
    >
      <Icon size={18} strokeWidth={1.9} aria-hidden />
      {cfg.label}
      <input
        id={id}
        type="file"
        accept={cfg.accept}
        capture={cfg.capture}
        multiple={mode === "file" || mode === "photo"}
        className="sr-only"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </label>
  );
}

const TAG_LABEL: Record<MediaTag, string> = {
  portrait: "Portrait",
  before: "Before",
  after: "After",
  parts: "Parts replaced",
  completed: "Completed work",
  diagnostic: "Diagnostic",
  vehicle: "Vehicle",
  dashboard: "Dashboard",
  damage: "Damage",
  leak: "Leak",
  engine_bay: "Engine bay",
  wheel: "Tire / wheel",
  part: "Part",
  issue: "The problem",
  sound: "Sound",
  vin: "VIN",
  prior_estimate: "Shop estimate",
  customer_part: "Their part",
  answer: "Reply",
  other: "Other",
};

const TAG_ICON: Partial<Record<MediaTag, typeof Camera>> = {
  dashboard: Gauge,
  wheel: Disc3,
  leak: Droplets,
  vin: Hash,
  sound: Mic,
  engine_bay: Cog,
  prior_estimate: FileText,
  damage: TriangleAlert,
};

/** One attachment tile. Works for real uploads (url) and seeded demo files (no url). */
export function MediaThumb({ m, size = 84 }: { m: RepairMedia; size?: number }) {
  const box = { width: size, height: size };
  const caption = (
    <span className="absolute inset-x-0 bottom-0 truncate bg-ink/75 px-1.5 py-0.5 text-[0.6875rem] font-bold tracking-wide text-sheet uppercase">
      {TAG_LABEL[m.tag]}
    </span>
  );
  if (m.url && m.kind === "photo") {
    return (
      <a href={m.url} target="_blank" rel="noreferrer" className="relative block overflow-hidden border border-rule bg-sheet" style={box} title={m.name}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={m.url} alt={`${TAG_LABEL[m.tag]} photo`} className="size-full object-cover" />
        {caption}
      </a>
    );
  }
  if (m.url && m.kind === "video") {
    return (
      <a href={m.url} target="_blank" rel="noreferrer" className="relative block overflow-hidden border border-rule bg-ink" style={box} title={m.name}>
        <video src={`${m.url}#t=0.5`} muted preload="metadata" playsInline className="size-full object-cover" aria-label={`${TAG_LABEL[m.tag]} video`} />
        <span className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-sheet/90" aria-hidden>
          <Video size={11} />
        </span>
        {caption}
      </a>
    );
  }
  // No real image to show: a clear icon for what the file is. Never the bare filename as "evidence".
  const Icon = TAG_ICON[m.tag] ?? (m.kind === "video" ? Video : m.kind === "audio" ? Mic : m.kind === "photo" ? Camera : FileUp);
  const kindLabel = m.kind === "audio" ? "Audio" : m.kind === "video" ? "Video" : m.kind === "photo" ? "Photo" : "Document";
  const inner = (
    <>
      <Icon size={Math.round(size / 3.6)} strokeWidth={1.6} className="text-ink-2" aria-hidden />
      <span className="mt-1 px-1 text-center text-[0.6875rem] leading-tight font-semibold text-ink-3">{m.url ? kindLabel : `${kindLabel} · sample`}</span>
      {caption}
    </>
  );
  return m.url ? (
    <a href={m.url} target="_blank" rel="noreferrer" className="relative flex flex-col items-center justify-center overflow-hidden border border-rule bg-sheet pb-4" style={box} title={m.name} aria-label={`${TAG_LABEL[m.tag]} ${kindLabel.toLowerCase()}: ${m.name}`}>
      {inner}
    </a>
  ) : (
    <span
      role="img"
      aria-label={`${TAG_LABEL[m.tag]} ${kindLabel.toLowerCase()} (demo sample, no file attached)`}
      className="relative flex flex-col items-center justify-center overflow-hidden border border-dashed border-rule bg-paper pb-4"
      style={box}
      title="Demo sample: this seeded request has no real file attached"
    >
      {inner}
    </span>
  );
}
