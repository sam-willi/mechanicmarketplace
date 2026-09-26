"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

/** A form's submit button that shows it's working and can't be pressed twice. */
export function SubmitButton({ children, pending, className = "btn btn-ink min-h-12 w-full", name, value }: { children: React.ReactNode; pending: string; className?: string; name?: string; value?: string }) {
  const { pending: busy } = useFormStatus();
  return (
    <button className={`${className} disabled:cursor-wait disabled:opacity-80`} disabled={busy} aria-disabled={busy} name={name} value={value}>
      {busy ? (
        <>
          <Loader2 size={17} className="animate-spin" aria-hidden /> {pending}
        </>
      ) : (
        children
      )}
    </button>
  );
}
