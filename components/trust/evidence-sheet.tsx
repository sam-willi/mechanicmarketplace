"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { trackClient } from "@/app/actions/analytics";
import type { EvidenceDetail } from "@/lib/domain/evidence";
import type { EvidenceVariant } from "@/lib/domain/types";
import { Tick, tickForStatus } from "./marks";

type Ctx = { open: (d: EvidenceDetail) => void };
const EvidenceCtx = createContext<Ctx>({ open: () => {} });

/**
 * One sheet per page. Any mark can open it; it shows which copy of the record
 * proves the claim, how, when, and until when.
 */
export function EvidenceProvider({
  children,
  mechanicId,
  variant,
}: {
  children: React.ReactNode;
  mechanicId?: string;
  variant?: EvidenceVariant;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<EvidenceDetail | null>(null);

  const open = useCallback(
    (d: EvidenceDetail) => {
      setDetail(d);
      requestAnimationFrame(() => ref.current?.showModal());
      void trackClient("verification_badge_clicked", {
        mechanicId,
        variant,
        source: d.source,
        claim: d.title.slice(0, 80),
        kind: d.kind,
      });
    },
    [mechanicId, variant],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      if (e.target === el) el.close();
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, []);

  const tick = detail ? (detail.kind === "safety" ? tickForStatus(detail.status) : tickForStatus(detail.status, detail.source)) : "blank";

  return (
    <EvidenceCtx.Provider value={{ open }}>
      {children}
      <dialog
        ref={ref}
        aria-labelledby="evidence-title"
        className="m-0 mt-auto w-full max-w-none bg-transparent p-0 backdrop:bg-[rgba(22,24,29,0.32)] backdrop:backdrop-blur-[1px] sm:m-auto sm:w-[26rem]"
      >
        {detail && (
          <div className="sheet perf-top relative animate-[sheet-up_320ms_cubic-bezier(0.16,1,0.3,1)] rounded-b-none border-b-0 px-5 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_-12px_rgba(22,24,29,0.25)] sm:rounded-b-[2px] sm:border-b sm:shadow-[0_24px_60px_-20px_rgba(22,24,29,0.35)]">
            <div className="flex items-start justify-between gap-4 border-b border-rule-soft pb-3">
              <p className="field-label">{detail.copy}</p>
              <button
                type="button"
                onClick={() => ref.current?.close()}
                className="-mt-1 -mr-2 grid size-9 place-items-center text-ink-3 hover:text-ink"
                aria-label="Close"
              >
                <X size={18} strokeWidth={1.75} />
              </button>
            </div>
            <h2 id="evidence-title" className="heading mt-4 text-[1.25rem] text-ink">
              {detail.title}
            </h2>
            <div className="mt-3 flex items-center gap-2">
              <Tick state={tick} size={18} />
              <span className={`text-[0.9375rem] font-semibold ${tick === "self" ? "text-pencil" : tick === "lapsed" ? "text-alert" : tick === "pending" || tick === "blank" ? "text-ink-2" : "text-carbon"}`}>
                {detail.label}
              </span>
            </div>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-2">{detail.explanation}</p>
            {detail.facts.length > 0 && (
              <dl className="mt-5 grid grid-cols-2 border-t border-rule">
                {detail.facts.map((f) => (
                  <div key={f.label} className="border-b border-rule-soft py-2.5 pr-3 odd:border-r odd:pr-3 even:pl-3">
                    <dt className="field-label">{f.label}</dt>
                    <dd className="tnum mt-0.5 text-[0.9375rem] text-ink">{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="mt-5 text-sm text-ink-3">
              Clutch shows the source of every claim instead of a trust score.{" "}
              <Link href="/verification" className="link text-ink-2">
                How verification works
              </Link>
            </p>
          </div>
        )}
      </dialog>
    </EvidenceCtx.Provider>
  );
}

export function useEvidence() {
  return useContext(EvidenceCtx);
}

/** Makes any content a trigger for the evidence sheet. */
export function EvidenceTrigger({
  detail,
  children,
  className = "",
  label,
}: {
  detail: EvidenceDetail;
  children: React.ReactNode;
  className?: string;
  label?: string;
}) {
  const { open } = useEvidence();
  return (
    <button
      type="button"
      onClick={() => open(detail)}
      aria-label={label ?? `${detail.label}: ${detail.title}. Show evidence.`}
      aria-haspopup="dialog"
      className={`cursor-pointer text-left ${className}`}
    >
      {children}
    </button>
  );
}
