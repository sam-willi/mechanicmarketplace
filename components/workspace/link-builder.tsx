"use client";

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { trackClient } from "@/app/actions/analytics";
import { REPAIR_LABEL } from "@/lib/domain/provenance";
import { REPAIR_CATEGORIES, VEHICLE_MAKES } from "@/lib/domain/types";

/**
 * Lets a mechanic send a lead a profile link that opens on the evidence for
 * that lead's car and repair — the portable-reputation move.
 */
export function LinkBuilder({ slug, mechanicId, origin }: { slug: string; mechanicId: string; origin: string }) {
  const [make, setMake] = useState("");
  const [repair, setRepair] = useState("");
  const [copied, setCopied] = useState(false);
  const url = useMemo(() => {
    const qs = new URLSearchParams({ ...(repair ? { repair } : {}), ...(make ? { make } : {}), ref: "direct" });
    return `${origin}/mechanics/${slug}?${qs}`;
  }, [origin, slug, make, repair]);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    void trackClient("profile_share", { mechanicId, method: "link_builder", contextual: Boolean(make || repair) });
  }

  return (
    <div className="sheet p-4 sm:p-5">
      <p className="font-semibold text-ink">Send a lead proof for their exact job</p>
      <p className="mt-0.5 text-[0.875rem] text-ink-2">The link opens your profile leading with your verified work on their car and repair.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <select value={make} onChange={(e) => setMake(e.target.value)} className="input" aria-label="Their car">
          <option value="">Any make</option>
          {VEHICLE_MAKES.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select value={repair} onChange={(e) => setRepair(e.target.value)} className="input" aria-label="The repair">
          <option value="">Any repair</option>
          {REPAIR_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {REPAIR_LABEL[c]}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex gap-2">
        <input readOnly value={url} className="input tnum min-w-0 flex-1 text-[0.875rem] text-ink-2" aria-label="Profile link" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" onClick={copy} className="btn btn-ink shrink-0">
          {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
