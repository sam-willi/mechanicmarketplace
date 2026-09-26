"use client";

import { useState } from "react";
import { Check, Share } from "lucide-react";
import { trackClient } from "@/app/actions/analytics";
import type { EvidenceVariant } from "@/lib/domain/types";

export function ShareButton({
  path,
  title,
  mechanicId,
  variant,
  className = "",
  compact = false,
}: {
  path: string;
  title: string;
  mechanicId: string;
  variant?: EvidenceVariant;
  className?: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = new URL(path, window.location.origin).toString();
    let method = "copy";
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        method = "native";
        await navigator.share({ title, url });
      } else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2200);
      }
      void trackClient("profile_share", { mechanicId, variant, method });
    } catch {
      /* user dismissed the share sheet */
    }
  }

  return (
    <button type="button" onClick={share} className={`btn btn-quiet ${compact ? "min-h-11 px-3 text-sm" : ""} ${className}`}>
      {copied ? <Check size={16} strokeWidth={2} className="text-ink" /> : <Share size={16} strokeWidth={1.75} />}
      <span aria-live="polite">{copied ? "Link copied" : "Share"}</span>
    </button>
  );
}
