"use client";

import { useId, useState } from "react";
import { FileText, Loader2, X } from "lucide-react";
import { uploadMedia } from "@/lib/media/upload-client";

/**
 * Attach private evidence (a certificate of insurance, a credential) to a submission. The file is
 * stored as a verification document that only its uploader and a reviewer (through a short-lived
 * link) can open; the form carries only its id. Works with a phone camera (photo of the paper) or
 * a PDF, and with the keyboard (it's a native file input).
 */
export function EvidenceUpload({ name = "documentIds", label, hint, required = false }: { name?: string; label: string; hint?: string; required?: boolean }) {
  const id = useId();
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="field-label">
        {label}
        {required ? " (required)" : ""}
      </label>
      {hint ? <p className="text-[0.8125rem] text-ink-2">{hint}</p> : null}
      <input
        id={id}
        type="file"
        accept="application/pdf,image/*"
        className="block w-full py-2 text-[0.875rem]"
        aria-describedby={`${id}-status`}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          setError("");
          const r = await uploadMedia(file, "verification_doc");
          setBusy(false);
          if (!r.ok) return setError(r.error);
          setFiles((f) => [...f, { id: r.media.id, name: r.media.name || file.name }].slice(-5));
        }}
      />
      {/* An empty required marker keeps native form validation honest until a file is stored. */}
      {required && !files.length ? <input tabIndex={-1} aria-hidden required className="sr-only" name={`${name}-required`} value="" onChange={() => undefined} /> : null}
      {files.map((f) => (
        <input key={f.id} type="hidden" name={name} value={f.id} />
      ))}
      <div id={`${id}-status`} aria-live="polite">
        {busy ? (
          <p className="flex items-center gap-2 text-[0.875rem] text-ink-2">
            <Loader2 size={15} className="animate-spin" aria-hidden /> Uploading privately…
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="border border-alert/50 bg-alert-wash px-3 py-2 text-[0.875rem]">
            {error}
          </p>
        ) : null}
        {files.length ? (
          <ul className="space-y-1">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-2 text-[0.875rem]">
                <FileText size={15} aria-hidden className="shrink-0 text-ink-3" />
                <span className="min-w-0 truncate">{f.name}</span>
                <span className="text-ink-3">stored privately</span>
                <button type="button" onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))} className="ml-auto grid size-11 place-items-center" aria-label={`Remove ${f.name}`}>
                  <X size={15} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
