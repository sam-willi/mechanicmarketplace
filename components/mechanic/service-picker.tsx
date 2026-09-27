"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Plus, Search } from "lucide-react";

/**
 * Repairs and makes, without a wall of checkboxes: repairs as chips in two groups, makes as the
 * ones you've picked plus a few popular ones, with search for the rest. They're real checkboxes
 * (name="categories" / "makes"), so the one onboarding form, its saved draft and the live preview
 * work unchanged.
 */
const COMMON = ["brakes", "maintenance", "diagnostics", "suspension", "starters", "alternators"];
const POPULAR_MAKES = ["Toyota", "Honda", "Ford", "Chevrolet", "Nissan", "BMW"];

type Opt = { value: string; label: string };

export function ServicePicker({ repairs, makes, chosenRepairs = [], chosenMakes = [] }: { repairs: Opt[]; makes: string[]; chosenRepairs?: string[]; chosenMakes?: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState({ repairs: chosenRepairs, makes: chosenMakes });
  const [query, setQuery] = useState("");
  const [allMakes, setAllMakes] = useState(false);
  // The checkboxes are the source of truth (a restored draft sets them directly): read them back.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () =>
      setPicked({
        repairs: [...el.querySelectorAll<HTMLInputElement>('input[name="categories"]:checked')].map((x) => x.value),
        makes: [...el.querySelectorAll<HTMLInputElement>('input[name="makes"]:checked')].map((x) => x.value),
      });
    read();
    el.addEventListener("change", read);
    const form = el.closest("form");
    form?.addEventListener("change", read);
    const t = setTimeout(read, 50);
    return () => {
      el.removeEventListener("change", read);
      form?.removeEventListener("change", read);
      clearTimeout(t);
    };
  }, []);
  const q = query.trim().toLowerCase();
  const makeShown = (mk: string) => picked.makes.includes(mk) || (q ? mk.toLowerCase().includes(q) : allMakes || POPULAR_MAKES.includes(mk));
  const chip = (checked: boolean) =>
    `inline-flex min-h-11 cursor-pointer items-center gap-1.5 border px-3 text-[0.9375rem] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand ${checked ? "border-brand bg-brand font-semibold text-on-brand" : "border-rule bg-sheet text-ink hover:border-ink-3"}`;
  // A plain render function (not a component), so the checkboxes keep their state between renders.
  const group = (title: string, items: Opt[]) => (
    <div>
      <p className="text-[0.8125rem] font-semibold text-ink-2">{title}</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {items.map((o) => {
          const on = picked.repairs.includes(o.value);
          return (
            <label key={o.value} className={chip(on)}>
              <input type="checkbox" name="categories" value={o.value} defaultChecked={chosenRepairs.includes(o.value)} className="sr-only" />
              {on ? <Check size={15} aria-hidden /> : <Plus size={15} aria-hidden />}
              {o.label}
            </label>
          );
        })}
      </div>
    </div>
  );
  const unmatched = q && !makes.some((mk) => mk.toLowerCase().includes(q));
  return (
    <div ref={ref} className="space-y-6">
      <p className="text-[0.9375rem] font-semibold" aria-live="polite">
        {picked.repairs.length} {picked.repairs.length === 1 ? "repair" : "repairs"} · {picked.makes.length} {picked.makes.length === 1 ? "make" : "makes"} selected
        <span className="block text-[0.8125rem] font-normal text-ink-2">Clutch sends you requests that match these. You can change them any time.</span>
      </p>
      <fieldset className="space-y-3">
        <legend className="field-label">Repairs you do</legend>
        {group("Most requested", repairs.filter((r) => COMMON.includes(r.value)))}
        {group("More", repairs.filter((r) => !COMMON.includes(r.value)))}
      </fieldset>
      <fieldset>
        <legend className="field-label">Makes you know best</legend>
        <label className="relative mt-2 block max-w-[20rem]">
          <span className="sr-only">Find a make</span>
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" aria-hidden />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a make (e.g. Subaru)" className="input pl-9" />
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          {makes.map((mk) => {
            const on = picked.makes.includes(mk);
            return (
              <label key={mk} className={chip(on)} hidden={!makeShown(mk)}>
                <input type="checkbox" name="makes" value={mk} defaultChecked={chosenMakes.includes(mk)} className="sr-only" />
                {on ? <Check size={15} aria-hidden /> : <Plus size={15} aria-hidden />}
                {mk}
              </label>
            );
          })}
        </div>
        {unmatched ? <p className="mt-2 text-[0.875rem] text-ink-2">No make called &ldquo;{query}&rdquo; on Clutch yet.</p> : null}
        {!q ? (
          <button type="button" onClick={() => setAllMakes((x) => !x)} className="mt-2 min-h-11 text-[0.875rem] font-semibold underline decoration-rule underline-offset-2">
            {allMakes ? "Show fewer makes" : `Show all ${makes.length} makes`}
          </button>
        ) : null}
      </fieldset>
    </div>
  );
}
