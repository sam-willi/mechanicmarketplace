"use client";

import { useState } from "react";
import { Check, Link2 } from "lucide-react";

/** Copies an absolute link built from a path on this site. */
export function CopyLink({ path, label, className = "" }: { path: string; label: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
      className={`btn btn-quiet min-h-11 px-3 text-sm ${className}`}
    >
      {done ? <Check size={15} aria-hidden /> : <Link2 size={15} aria-hidden />}
      <span aria-live="polite">{done ? "Copied" : label}</span>
    </button>
  );
}
