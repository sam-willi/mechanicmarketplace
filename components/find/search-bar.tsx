"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Pencil, Search, SlidersHorizontal, X } from "lucide-react";
import { Combobox } from "@/components/vehicle/combobox";
import { SEARCH_CONTROL } from "./search-cell";

type Opt = { id: string; label: string };
export type SearchValues = {
  vehicle?: string;
  year?: string;
  make?: string;
  model?: string;
  repair?: string;
  area?: string;
  mode?: string;
  within?: string;
  maxMi?: string;
  lang?: string;
};

const YEARS = Array.from({ length: new Date().getFullYear() + 2 - 1990 }, (_, i) => String(new Date().getFullYear() + 1 - i));
const MODES: Opt[] = [
  { id: "", label: "Either" },
  { id: "mobile", label: "Comes to me" },
  { id: "shop", label: "At a shop" },
];
const WITHIN: Opt[] = [
  { id: "", label: "Any time" },
  { id: "3", label: "Within 3 days" },
  { id: "7", label: "This week" },
];
const DISTANCE: Opt[] = [
  { id: "", label: "Any distance" },
  { id: "5", label: "Within 5 mi" },
  { id: "10", label: "Within 10 mi" },
  { id: "15", label: "Within 15 mi" },
];

const cell = "relative block min-w-0 bg-sheet px-3.5 pt-2.5 pb-2 transition-colors focus-within:bg-brand-wash/60 focus-within:shadow-[inset_0_0_0_2px_var(--brand)]";

/**
 * Vehicle, repair, location — and nothing else until asked. On results pages
 * the form folds into a one-line summary the customer can edit.
 */
export function SearchBar({
  action,
  initial,
  vehicles = [],
  makes,
  repairs,
  areas,
  languages = [],
  variant = "results",
}: {
  action: string;
  initial: SearchValues;
  vehicles?: Opt[];
  makes: string[];
  repairs: Opt[];
  areas: Opt[];
  languages?: string[];
  variant?: "hero" | "results";
}) {
  const [v, setV] = useState<SearchValues>(initial);
  const set = (patch: SearchValues) => setV((cur) => ({ ...cur, ...patch }));
  const applied = variant === "results" && Boolean(initial.vehicle || initial.make || initial.repair || initial.area);
  const [editing, setEditing] = useState(!applied);
  const extras = [initial.mode, initial.within, initial.maxMi, initial.lang].filter(Boolean).length;
  const [more, setMore] = useState(false);

  const vehicleLabel = v.vehicle ? (vehicles.find((x) => x.id === v.vehicle)?.label ?? "Your vehicle") : [v.year, v.make, v.model].filter(Boolean).join(" ") || "";
  const label = (list: Opt[], id?: string) => list.find((o) => o.id === (id ?? ""))?.label;

  if (!editing) {
    const parts = [
      vehicleLabel || "Any vehicle",
      label(repairs, v.repair) ?? "Any repair",
      label(areas, v.area) ?? "Anywhere in LA",
      ...(v.mode ? [label(MODES, v.mode)!] : []),
      ...(v.within ? [label(WITHIN, v.within)!] : []),
      ...(v.maxMi ? [label(DISTANCE, v.maxMi)!] : []),
      ...(v.lang ? [v.lang] : []),
    ];
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-rule bg-sheet px-4 py-3">
        <Search size={17} className="shrink-0 text-ink-3" aria-hidden />
        <p className="min-w-0 flex-1 text-[1rem] font-semibold">
          {parts.map((t, i) => (
            <span key={t + i} className="whitespace-nowrap">
              {i ? <span className="px-1.5 text-rule" aria-hidden>·</span> : null}
              {t}
            </span>
          ))}
        </p>
        <button type="button" onClick={() => setEditing(true)} className="btn btn-quiet min-h-11 px-3 sm:px-[1.125rem]" aria-label="Edit search">
          <Pencil size={15} aria-hidden /> <span className="hidden sm:inline">Edit search</span>
        </button>
      </div>
    );
  }

  return (
    <form action={action} method="get">
      {v.vehicle ? <input type="hidden" name="vehicle" value={v.vehicle} /> : null}
      {!v.vehicle && v.year ? <input type="hidden" name="year" value={v.year} /> : null}
      {!v.vehicle && v.make ? <input type="hidden" name="make" value={v.make} /> : null}
      {!v.vehicle && v.model ? <input type="hidden" name="model" value={v.model} /> : null}
      <div className={`grid grid-cols-2 gap-px border border-rule bg-rule-soft ${variant === "hero" ? "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_auto]" : "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_13rem]"}`}>
        <VehicleCell value={v} label={vehicleLabel} vehicles={vehicles} makes={makes} onChange={set} />
        <label className={cell}>
          <span className="field-label">Repair</span>
          <select name="repair" value={v.repair ?? ""} onChange={(e) => set({ repair: e.target.value })} className={SEARCH_CONTROL}>
            {[{ id: "", label: "Any repair" }, ...repairs].map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <Chevron />
        </label>
        <label className={cell}>
          <span className="field-label">Location</span>
          <select name="area" value={v.area ?? ""} onChange={(e) => set({ area: e.target.value })} className={SEARCH_CONTROL}>
            {[{ id: "", label: "Anywhere in LA" }, ...areas].map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <Chevron />
        </label>
        <div className="col-span-2 flex bg-sheet lg:col-span-1">
          <button className="btn btn-ink min-h-14 w-full rounded-none px-6 shadow-none">
            <Search size={16} aria-hidden /> Find mechanics
          </button>
        </div>
      </div>

      {variant === "results" ? (
        <div className="mt-2">
          <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="inline-flex min-h-11 items-center gap-1.5 text-[0.875rem] font-semibold">
            <SlidersHorizontal size={15} aria-hidden /> More filters{extras ? ` (${extras})` : ""}
            <ChevronDown size={15} className={`transition-transform ${more ? "rotate-180" : ""}`} aria-hidden />
          </button>
          <div hidden={!more} className="mt-1 grid grid-cols-2 gap-px border border-rule bg-rule-soft lg:grid-cols-4">
            <Select name="mode" label="Mobile or shop" options={MODES} value={v.mode} onChange={(x) => set({ mode: x })} />
            <Select name="within" label="Availability" options={WITHIN} value={v.within} onChange={(x) => set({ within: x })} />
            <Select name="maxMi" label="Distance" options={DISTANCE} value={v.maxMi} onChange={(x) => set({ maxMi: x })} disabled={!v.area} />
            <Select
              name="lang"
              label="Language"
              options={[{ id: "", label: "Any language" }, ...languages.map((l) => ({ id: l, label: l }))]}
              value={v.lang}
              onChange={(x) => set({ lang: x })}
            />
          </div>
        </div>
      ) : null}
    </form>
  );
}

function Select({ name, label, options, value, onChange, disabled }: { name: string; label: string; options: Opt[]; value?: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <label className={cell}>
      <span className="field-label">{label}</span>
      {/* An unset filter sends nothing, so URLs stay short. */}
      <select name={value ? name : undefined} value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={SEARCH_CONTROL}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {disabled && !o.id ? "Choose a location first" : o.label}
          </option>
        ))}
      </select>
      <Chevron />
    </label>
  );
}

function Chevron() {
  return <ChevronDown size={16} className="pointer-events-none absolute right-3.5 bottom-[0.9rem] text-ink-2" aria-hidden />;
}

/** One cell that reads "2008 BMW 135i"; the year → make → model picker opens under it. */
function VehicleCell({ value, label, vehicles, makes, onChange }: { value: SearchValues; label: string; vehicles: Opt[]; makes: string[]; onChange: (p: SearchValues) => void }) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  useEffect(() => {
    if (!value.year || !value.make) return;
    let off = false;
    queueMicrotask(() => !off && setLoading(true));
    fetch(`/api/vehicles?step=models&year=${value.year}&make=${encodeURIComponent(value.make)}`)
      .then((r) => r.json())
      .then((j: { models?: string[] }) => !off && setModels(j.models ?? []))
      .catch(() => !off && setModels([]))
      .finally(() => !off && setLoading(false));
    return () => {
      off = true;
    };
  }, [value.year, value.make]);

  return (
    <div ref={box} className="relative col-span-2 bg-sheet lg:col-span-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`${cell.replace("block ", "")} flex w-full items-end gap-3 text-left ${open ? "bg-brand-wash/60 shadow-[inset_0_0_0_2px_var(--brand)]" : ""}`}
      >
        <span className="min-w-0 flex-1">
          <span className="field-label block">Vehicle</span>
          <span className={`mt-0.5 block truncate py-1 text-[1rem] font-semibold ${label ? "text-ink" : "text-ink"}`}>{label || "Any vehicle"}</span>
        </span>
        <ChevronDown size={16} className={`mb-2 shrink-0 text-ink-2 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open ? (
        <div className="absolute inset-x-0 top-full z-40 -mt-px space-y-3 border border-rule bg-sheet p-3.5 shadow-[0_18px_40px_-18px_rgba(15,28,48,0.45)] lg:right-auto lg:w-[26rem]">
          {vehicles.length ? (
            <div className="flex flex-wrap gap-2">
              {vehicles.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => {
                    onChange({ vehicle: x.id, year: "", make: "", model: "" });
                    setOpen(false);
                  }}
                  className={`min-h-11 border px-3 text-[0.9375rem] ${value.vehicle === x.id ? "border-brand bg-brand font-semibold text-on-brand" : "border-rule hover:border-ink"}`}
                >
                  {x.label}
                </button>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-3 gap-2">
            <Combobox label="Year" value={value.year ?? ""} options={YEARS.map((y) => ({ id: y, label: y }))} onChange={(y) => onChange({ vehicle: "", year: y, model: "" })} placeholder="Any" />
            <Combobox label="Make" value={value.make ?? ""} options={makes.map((m) => ({ id: m, label: m }))} onChange={(m) => onChange({ vehicle: "", make: m, model: "" })} placeholder="Any" />
            <Combobox
              label="Model"
              value={value.model ?? ""}
              disabled={!value.year || !value.make}
              loading={loading}
              options={models.map((m) => ({ id: m, label: m }))}
              allowCustom="Use"
              onChange={(m) => onChange({ vehicle: "", model: m.startsWith("custom:") ? m.slice(7) : m })}
              placeholder="Any"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            {label ? (
              <button type="button" onClick={() => onChange({ vehicle: "", year: "", make: "", model: "" })} className="inline-flex min-h-11 items-center gap-1 text-[0.875rem] text-ink-2 underline decoration-rule underline-offset-2">
                <X size={14} aria-hidden /> Any vehicle
              </button>
            ) : (
              <span />
            )}
            <button type="button" onClick={() => setOpen(false)} className="btn btn-line min-h-11">
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
