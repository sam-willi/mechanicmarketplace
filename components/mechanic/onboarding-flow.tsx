"use client";

import { Children, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { findArea } from "@/lib/domain/areas";

type StepMeta = { title: string; why: string; minutes: number; required?: string[]; optional?: boolean };

const KEY = "clutch-onboarding-draft";
/** The step you were on, for this browser tab: leaving (say, to Verification) and coming back resumes it. */
const STEP_KEY = "clutch-onboarding-step";

/**
 * A real stepped flow around one form: every step's fields stay in the form
 * (so one submit saves everything), only the current step is visible. Answers
 * are kept on this device as you go, and restored if you come back.
 */
export function OnboardingFlow({
  steps,
  children,
  submitLabel,
  persist,
}: {
  steps: StepMeta[];
  children: React.ReactNode;
  submitLabel: string;
  persist: boolean;
}) {
  const panels = Children.toArray(children);
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [missing, setMissing] = useState<string[]>([]);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const form = () => formRef.current?.closest("form") ?? null;

  useEffect(() => {
    try {
      const saved = Number(sessionStorage.getItem(`${STEP_KEY}:${persist ? "new" : "edit"}`));
      if (saved > 0 && saved < steps.length) {
        setTimeout(() => {
          setStep(saved);
          setReached(saved);
        }, 0);
      }
    } catch {
      /* storage unavailable: start at the beginning */
    }
  }, [persist, steps.length]);
  useEffect(() => {
    try {
      sessionStorage.setItem(`${STEP_KEY}:${persist ? "new" : "edit"}`, String(step));
    } catch {
      /* not remembered */
    }
  }, [step, persist]);

  // Restore, then keep saving on this device.
  useEffect(() => {
    const f = form();
    if (!f || !persist) return;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const data = JSON.parse(raw) as Record<string, string | string[]>;
        for (const [name, val] of Object.entries(data)) {
          const els = f.querySelectorAll<HTMLInputElement>(`[name="${CSS.escape(name)}"]`);
          els.forEach((el) => {
            if (el.type === "file") return;
            if (el.type === "checkbox" || el.type === "radio") el.checked = Array.isArray(val) ? val.includes(el.value) : val === el.value;
            else el.value = String(val);
          });
        }
        setTimeout(() => setSavedNote("Picked up where you left off"), 0);
      }
    } catch {
      /* storage unavailable: nothing to restore */
    }
    const save = () => {
      const data: Record<string, string | string[]> = {};
      new FormData(f).forEach((v, k) => {
        if (typeof v !== "string") return;
        data[k] = k in data ? ([] as string[]).concat(data[k], v) : v;
      });
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
        setSavedNote(`Saved on this device at ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
      } catch {
        setSavedNote(null);
      }
    };
    f.addEventListener("input", save);
    f.addEventListener("change", save);
    return () => {
      f.removeEventListener("input", save);
      f.removeEventListener("change", save);
    };
  }, [persist]);

  function check(i: number) {
    const f = form();
    if (!f) return [];
    return (steps[i].required ?? []).filter((name) => {
      const el = f.querySelector<HTMLInputElement>(`[name="${name}"]`);
      return el && !el.value.trim();
    });
  }

  function go(to: number) {
    if (to > step) {
      const m = check(step);
      if (m.length) {
        setMissing(m);
        return;
      }
    }
    setMissing([]);
    setStep(to);
    setReached((r) => Math.max(r, to));
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const left = Math.max(1, Math.round(steps.slice(step).reduce((n, s) => n + s.minutes, 0)));

  return (
    <div ref={formRef} className="scroll-mt-20">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="tnum text-[0.8125rem] font-bold text-ink-2">
          Step {step + 1} of {steps.length} · about {left} min left
        </p>
        {savedNote ? (
          <p className="text-[0.75rem] text-ink-3" aria-live="polite">
            {savedNote}
          </p>
        ) : null}
      </div>
      <ol className="mt-2 grid gap-1" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label="Steps">
        {steps.map((s, i) => (
          <li key={s.title} className="min-w-0">
            <button
              type="button"
              onClick={() => i <= reached && go(i)}
              disabled={i > reached || i === step}
              aria-current={i === step ? "step" : undefined}
              className="group block w-full text-left disabled:cursor-default"
            >
              <span className={`block h-1.5 ${i === step ? "bg-brand" : i < reached || i < step ? "bg-ink-2" : "bg-rule-soft"}`} />
              <span
                className={`mt-1.5 hidden truncate text-[0.6875rem] sm:block ${i === step ? "font-bold text-ink" : i <= reached ? "text-ink-2 underline decoration-rule underline-offset-2" : "text-ink-3"}`}
              >
                {s.title}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <h2 className="display mt-6 text-[1.75rem] sm:text-[2.25rem]">{steps[step].title}</h2>
      <p className="mt-1 max-w-[62ch] text-[0.9375rem] text-ink-2">{steps[step].why}</p>
      {missing.length ? (
        <p role="alert" className="mt-3 border border-alert bg-alert-wash px-3 py-2 text-[0.9375rem]">
          Fill in the required fields to continue.
        </p>
      ) : null}

      <div className="mt-6">
        {panels.map((p, i) => (
          <div key={i} hidden={i !== step}>
            {p}
          </div>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3 border-t-2 border-ink pt-5">
        {step > 0 ? (
          <button type="button" onClick={() => go(step - 1)} className="btn btn-quiet min-h-12">
            <ArrowLeft size={17} aria-hidden /> Back
          </button>
        ) : null}
        <div className="flex-1" />
        {step < steps.length - 1 && steps[step].optional ? (
          <button type="button" onClick={() => go(step + 1)} className="btn btn-quiet min-h-12">
            Do this later
          </button>
        ) : null}
        {step < steps.length - 1 ? (
          <button type="button" onClick={() => go(step + 1)} className="btn btn-ink min-h-12 px-6">
            Continue <ArrowRight size={17} aria-hidden />
          </button>
        ) : (
          <button
            className="btn btn-ink min-h-12 px-6"
            onClick={() => {
              setSubmitting(true);
              try {
                localStorage.removeItem(KEY);
                sessionStorage.removeItem(`${STEP_KEY}:${persist ? "new" : "edit"}`);
              } catch {
                /* nothing to clear */
              }
            }}
          >
            {submitting ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Check size={17} aria-hidden />} {submitLabel}
          </button>
        )}
      </div>
    </div>
  );
}

/** Live preview of the public profile from what's typed so far. */
export function ProfilePreview() {
  const ref = useRef<HTMLDivElement>(null);
  const [v, setV] = useState<Record<string, string>>({});
  useEffect(() => {
    const f = ref.current?.closest("form");
    if (!f) return;
    const read = () => {
      const o: Record<string, string> = {};
      new FormData(f).forEach((val, k) => {
        if (typeof val === "string") o[k] = k in o ? `${o[k]}, ${val}` : val;
      });
      setV(o);
    };
    read();
    f.addEventListener("input", read);
    f.addEventListener("change", read);
    return () => {
      f.removeEventListener("input", read);
      f.removeEventListener("change", read);
    };
  }, []);
  const model = "Mobile mechanic";
  return (
    <div ref={ref} className="sheet p-4">
      <p className="field-label">Your public profile, as customers will see it</p>
      <div className="mt-3 flex gap-3">
        {v.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.photoUrl} alt="" className="size-20 border border-rule object-cover" />
        ) : (
          <span className="grid size-20 place-items-center bg-[#dfe2dc] text-[1.5rem] font-extrabold text-ink-2" aria-hidden>
            {(v.displayName || "?")
              .split(" ")
              .map((x) => x[0])
              .join("")
              .slice(0, 2)}
          </span>
        )}
        <div className="min-w-0">
          <p className="heading text-[1.25rem]">{v.displayName || "Your name"}</p>
          <p className="text-[0.875rem] text-ink-2">
            {model} · {v.neighborhood ? (findArea(v.neighborhood)?.label ?? v.neighborhood) : "Where you start from"} · within {v.serviceRadiusMi || 15} mi
          </p>
          <p className="mt-1 text-[0.875rem]">
            <span className="font-semibold">${v.hourlyRate || "?"}</span>/hr · ${v.diagnosticFee || "?"} diagnostic
            {v.travelFee ? ` · $${v.travelFee} travel` : ""}
          </p>
        </div>
      </div>
      {v.bio ? <p className="mt-3 line-clamp-3 text-[0.875rem] text-ink-2">{v.bio}</p> : null}
      <p className="mt-3 border-t border-rule-soft pt-2 text-[0.8125rem] text-ink-3">
        Services and makes you pick show as self-reported until real jobs verify them. Each verification check shows as &ldquo;Not completed&rdquo; until it&apos;s done; customers can still book you once your profile is complete.
      </p>
    </div>
  );
}
