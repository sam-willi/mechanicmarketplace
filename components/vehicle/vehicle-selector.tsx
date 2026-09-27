"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, ScanLine } from "lucide-react";
import type { CatalogConfig } from "@/lib/vehicles/catalog";
import { BODY_LABEL, DRIVE_LABEL } from "@/lib/vehicles/catalog";
import { buildSpec, GENERIC_TRANSMISSIONS, mechanicHeadline, pruneSelection, sameModel, stepOptions, STATUS_LABEL, type VinDecode } from "@/lib/vehicles/spec";
import type { Drivetrain, SpecField, VehicleSpec } from "@/lib/vehicles/types";
import { choiceToSelection, type VehicleChoice } from "@/lib/vehicles/choice";
import { Combobox } from "./combobox";
import { PhotoGuide } from "@/components/request/photo-guide";

export type { VehicleChoice } from "@/lib/vehicles/choice";
export { EMPTY_CHOICE, choiceToSelection } from "@/lib/vehicles/choice";

const YEARS = Array.from({ length: new Date().getFullYear() + 2 - 1990 }, (_, i) => String(new Date().getFullYear() + 1 - i));

async function api<T>(qs: string): Promise<T> {
  const r = await fetch(`/api/vehicles?${qs}`);
  if (!r.ok) throw new Error("unavailable");
  return r.json();
}

/**
 * Year → make → model → configuration, each step limited to what actually
 * existed. Changing an earlier choice clears later ones that no longer fit.
 * A VIN can fill it in; disagreements are flagged, never silently overwritten.
 */
export function VehicleSelector({
  value,
  onChange,
  showVin = true,
  beforeVin,
}: {
  value: VehicleChoice;
  onChange: (v: VehicleChoice, spec: VehicleSpec | undefined) => void;
  showVin?: boolean;
  /** Rendered after the car and before the optional VIN (e.g. mileage). */
  beforeVin?: React.ReactNode;
}) {
  const [makes, setMakes] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [modelSource, setModelSource] = useState<"nhtsa" | "catalog" | null>(null);
  const [fetchedConfigs, setConfigs] = useState<CatalogConfig[]>([]);
  // Only meaningful while a model is chosen.
  const configs = value.model && !value.model.startsWith("custom:") ? fetchedConfigs : [];
  const [loading, setLoading] = useState<"makes" | "models" | "configs" | "vin" | null>(null);
  const [decode, setDecode] = useState<VinDecode | null>(null);
  const [vinError, setVinError] = useState<string | null>(null);
  // Open by default when a VIN is already on file; after that the person decides (clearing the
  // field to retype it must not collapse the section mid-edit).
  const [vinOpen, setVinOpen] = useState(Boolean(value.vin));
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);

  const emit = (next: VehicleChoice, cfgs = configs, dec = decode) => {
    latest.current = next;
    const sel = choiceToSelection(next);
    const spec = next.year && next.make && next.model ? buildSpec(sel, cfgs, next.vinConfirmed && dec ? dec : undefined) : undefined;
    onChange(next, spec);
  };

  // Makes for the year.
  useEffect(() => {
    if (!value.year) return;
    let off = false;
    queueMicrotask(() => !off && setLoading("makes"));
    api<{ makes: string[] }>(`step=makes&year=${value.year}`)
      .then((j) => !off && setMakes(j.makes))
      .catch(() => !off && setMakes([]))
      .finally(() => !off && setLoading(null));
    return () => {
      off = true;
    };
  }, [value.year]);

  // Models for the year and make; clear a model that didn't exist that year.
  useEffect(() => {
    if (!value.year || !value.make) return;
    let off = false;
    queueMicrotask(() => !off && setLoading("models"));
    api<{ models: string[]; source: "nhtsa" | "catalog" }>(`step=models&year=${value.year}&make=${encodeURIComponent(value.make)}`)
      .then((j) => {
        if (off) return;
        setModels(j.models);
        setModelSource(j.source);
        const cur = latest.current;
        const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (cur.model && !cur.model.startsWith("custom:") && j.models.length && !j.models.some((m) => norm(m) === norm(cur.model))) {
          emit({ ...cur, model: "", body: "", trim: "", engine: "", transmission: "", drivetrain: "" }, []);
        }
      })
      .catch(() => {
        if (!off) {
          setModels([]);
          setModelSource(null);
        }
      })
      .finally(() => !off && setLoading(null));
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.year, value.make]);

  // Factory configurations for the year/make/model; drop choices that no longer fit.
  useEffect(() => {
    if (!value.year || !value.make || !value.model || value.model.startsWith("custom:")) return;
    let off = false;
    queueMicrotask(() => !off && setLoading("configs"));
    const asked = { year: value.year, make: value.make, model: value.model };
    api<{ configs: CatalogConfig[] }>(`step=configs&year=${value.year}&make=${encodeURIComponent(value.make)}&model=${encodeURIComponent(value.model)}`)
      .then((j) => {
        if (off) return;
        const cur = latest.current;
        // Ignore a response for a car that has since changed (e.g. the model was cleared).
        if (cur.year !== asked.year || cur.make !== asked.make || cur.model !== asked.model) return;
        setConfigs(j.configs);
        const pruned = j.configs.length ? pruneSelection(j.configs, choiceToSelection(cur)) : choiceToSelection(cur);
        const next = {
          ...cur,
          body: pruned.body ?? "",
          trim: pruned.trim ?? "",
          engine: j.configs.length ? (pruned.engine ?? "") : "",
          transmission: j.configs.length ? (pruned.transmission ?? "") : GENERIC_TRANSMISSIONS.some((g) => g.id === cur.transmission) ? cur.transmission : "",
          drivetrain: pruned.drivetrain ?? "",
        };
        emit(next, j.configs);
      })
      .catch(() => !off && setConfigs([]))
      .finally(() => !off && setLoading(null));
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.year, value.make, value.model]);

  const sel = choiceToSelection(value);
  const opts = configs.length ? stepOptions(configs, sel) : null;
  const spec = value.year && value.make && value.model ? buildSpec(sel, configs, value.vinConfirmed && decode ? decode : undefined) : undefined;
  const set = (patch: Partial<VehicleChoice>) => emit({ ...value, ...patch });

  async function decodeVin() {
    setVinError(null);
    setLoading("vin");
    try {
      const r = await fetch("/api/vehicles/decode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vin: value.vin }) });
      const j = (await r.json()) as VinDecode;
      if (!j.ok) setVinError(j.warnings[0] ?? "We couldn't decode that VIN. Check it, or pick the car below.");
      setDecode(j.ok ? j : null);
    } catch {
      setVinError("The VIN decoder isn't reachable right now. Pick the car below instead.");
    } finally {
      setLoading(null);
    }
  }

  function useDecoded() {
    if (!decode) return;
    const next: VehicleChoice = {
      ...value,
      year: decode.year ? String(decode.year) : value.year,
      make: decode.make ?? value.make,
      model: decode.model ?? value.model,
      body: decode.body ?? value.body,
      drivetrain: decode.drivetrain ?? value.drivetrain,
      vinConfirmed: true,
    };
    emit(next, next.year === value.year && next.make === value.make && sameModel(next.model, value.model) ? configs : [], decode);
  }

  const chips = (name: string, list: { id: string; label: string }[], current: string, key: keyof VehicleChoice, unsure = true) => (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={name}>
      {list.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={current === o.id}
          onClick={() => set({ [key]: o.id } as Partial<VehicleChoice>)}
          className={`min-h-11 border px-3 text-[0.9375rem] ${current === o.id ? "border-brand bg-brand font-semibold text-sheet" : "border-rule bg-sheet hover:border-ink"}`}
        >
          {o.label}
        </button>
      ))}
      {unsure ? (
        <button
          type="button"
          role="radio"
          aria-checked={!current}
          onClick={() => set({ [key]: "" } as Partial<VehicleChoice>)}
          className={`min-h-11 border px-3 text-[0.9375rem] ${!current ? "border-ink font-semibold" : "border-dashed border-rule text-ink-2 hover:border-ink"}`}
        >
          Not sure
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Combobox label="Year" required value={value.year} options={YEARS.map((y) => ({ id: y, label: y }))} onChange={(y) => set({ year: y })} />
        <Combobox label="Make" required value={value.make} disabled={!value.year} loading={loading === "makes"} options={makes.map((m) => ({ id: m, label: m }))} onChange={(m) => set({ make: m, model: "", body: "", trim: "", engine: "", transmission: "", drivetrain: "" })} />
        <Combobox
          label="Model"
          required
          value={value.model}
          disabled={!value.make}
          loading={loading === "models"}
          options={models.map((m) => ({ id: m, label: m }))}
          allowCustom="Not listed? Use"
          onChange={(m) => set({ model: m.startsWith("custom:") ? m.slice(7) : m, body: "", trim: "", engine: "", transmission: "", drivetrain: "" })}
        />
      </div>
      {value.make && modelSource === "catalog" ? <p className="text-[0.8125rem] text-ink-3">The full model list isn&apos;t available right now; showing the models we know. Type yours if it&apos;s missing.</p> : null}

      {value.model ? (
        <div className="space-y-4 border-t border-rule-soft pt-4">
          {loading === "configs" ? (
            <p className="flex items-center gap-2 text-[0.875rem] text-ink-2">
              <Loader2 size={15} className="animate-spin" aria-hidden /> Finding the configurations that existed…
            </p>
          ) : opts ? (
            <>
              {opts.bodies.length > 1 ? (
                <Step title="Body style" why="On this model the body style changes the chassis.">
                  {chips("Body style", opts.bodies, value.body, "body")}
                </Step>
              ) : null}
              {opts.trims.length > 1 ? <Step title="Trim or version">{chips("Trim", opts.trims, value.trim, "trim")}</Step> : null}
              {opts.engines.length > 1 ? <Step title="Engine" why="More than one engine was offered. Check the badge or your paperwork.">{chips("Engine", opts.engines, value.engine, "engine")}</Step> : null}
              <Step title="Transmission" required>
                {opts.transmissions.length === 1 ? (
                  <p className="text-[0.9375rem]">
                    {opts.transmissions[0].label} <span className="text-ink-3">(the only one offered)</span>
                  </p>
                ) : (
                  chips("Transmission", opts.transmissions, value.transmission, "transmission", false)
                )}
              </Step>
              {opts.drivetrains.length > 1 ? <Step title="Drivetrain">{chips("Drivetrain", opts.drivetrains, value.drivetrain, "drivetrain")}</Step> : null}
            </>
          ) : (
            <>
              <p className="text-[0.875rem] text-ink-2">We don&apos;t have factory details for this model, so tell us what you know. Mechanics will see it as your description.</p>
              <Step title="Transmission" required>
                {chips("Transmission", GENERIC_TRANSMISSIONS, value.transmission, "transmission", false)}
              </Step>
              <Step title="Drivetrain">
                {chips(
                  "Drivetrain",
                  (["FWD", "RWD", "AWD", "4WD"] as Drivetrain[]).map((d) => ({ id: d, label: DRIVE_LABEL[d] })),
                  value.drivetrain,
                  "drivetrain",
                )}
              </Step>
              <label className="block max-w-[24rem]">
                <span className="field-label">Engine, if you know it</span>
                <input value={value.engineText} onChange={(e) => set({ engineText: e.target.value })} className="input mt-1" placeholder="e.g. 2.0L turbo" />
              </label>
            </>
          )}
          {spec ? <SpecPreview year={Number(value.year)} make={value.make} model={value.model} spec={spec} /> : null}
        </div>
      ) : null}
      {beforeVin}
      {showVin ? (
        <details className="group border-t border-rule-soft pt-2" open={vinOpen} onToggle={(e) => setVinOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">
            <ScanLine size={17} aria-hidden /> Add VIN for more accurate parts and estimates
            <span className="text-[0.8125rem] font-normal text-ink-3">Optional</span>
          </summary>
          <div className="space-y-3 pt-2">
          <div className="max-w-[15rem]">
            <PhotoGuide show={["vin"]} />
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={value.vin}
              onChange={(e) => set({ vin: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""), vinConfirmed: false })}
              maxLength={17}
              className="input tnum max-w-[18rem] flex-1 tracking-[0.06em] uppercase"
              placeholder="17-character VIN"
              aria-label="VIN"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" onClick={decodeVin} disabled={value.vin.length !== 17 || loading === "vin"} className="btn btn-line min-h-11 disabled:opacity-50">
              {loading === "vin" ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <ScanLine size={16} aria-hidden />} Look up VIN
            </button>
          </div>
          {vinError ? <p className="text-[0.875rem] text-alert">{vinError}</p> : null}
          {decode ? (
            <div className="border border-ink bg-paper px-3 py-2.5 text-[0.9375rem]">
              <p className="font-semibold">
                This VIN is a {decode.year} {decode.make} {decode.model}
                {decode.body ? ` ${BODY_LABEL[decode.body].toLowerCase()}` : ""}
                {decode.displacementL ? `, ${decode.displacementL.toFixed(1)}L${decode.cylinders ? ` ${decode.cylinders}-cylinder` : ""}` : ""}
              </p>
              {decode.warnings.length ? <p className="text-[0.8125rem] text-ink-3">Decoder note: {decode.warnings[0]}</p> : null}
              {!value.vinConfirmed && value.model && ((decode.year && String(decode.year) !== value.year) || (decode.make && decode.make.toLowerCase() !== value.make.toLowerCase()) || (decode.model && !sameModel(decode.model, value.model))) ? (
                <p role="alert" className="mt-1 flex items-start gap-1.5 text-[0.875rem] font-semibold text-amber">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> That doesn&apos;t match what you picked ({value.year} {value.make} {value.model.replace(/^custom:/, "")}). If the VIN is right, use it; if not, check it. Saved as is, both are kept and the difference is shown to mechanics.
                </p>
              ) : null}
              {value.vinConfirmed ? (
                <p className="mt-1 flex items-center gap-1.5 text-[0.875rem] font-semibold">
                  <Check size={15} aria-hidden /> Confirmed as your car
                </p>
              ) : (
                <button type="button" onClick={useDecoded} className="btn btn-ink mt-2 min-h-11">
                  Yes, that&apos;s my car
                </button>
              )}
            </div>
          ) : null}
          <p className="text-[0.8125rem] text-ink-3">Only you and the mechanic you book see the full VIN.</p>
          </div>
        </details>
      ) : null}

    </div>
  );
}

function Step({ title, why, required, children }: { title: string; why?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="text-[0.9375rem] font-bold">
        {title}
        <span className={`ml-2 text-[0.6875rem] font-bold tracking-[0.06em] uppercase ${required ? "text-ink" : "text-ink-3"}`}>{required ? "Required" : "Optional"}</span>
      </legend>
      {why ? <p className="text-[0.8125rem] text-ink-2">{why}</p> : null}
      <div className="mt-2">{children}</div>
    </fieldset>
  );
}

/** What mechanics will see, with each attribute's source. */
export function SpecPreview({ year, make, model, spec }: { year: number; make: string; model: string; spec: VehicleSpec }) {
  const rows: [string, SpecField | undefined][] = [
    ["Engine", spec.engine],
    ["Transmission", spec.transmission],
    ["Drivetrain", spec.drivetrain],
    ["Platform", spec.platform],
  ];
  const conflicts = spec.vin.conflicts;
  return (
    <div className="space-y-2">
      {conflicts.length ? (
        <div role="alert" className="flex gap-2 border border-alert bg-alert-wash px-2.5 py-2 text-[0.8125rem] text-alert">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
          <div>
            <p className="font-bold">Your VIN and your choices disagree</p>
            {conflicts.map((c) => (
              <p key={c} className="text-ink">
                {c}
              </p>
            ))}
          </div>
        </div>
      ) : null}
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 text-[0.9375rem] [&::-webkit-details-marker]:hidden">
          <Check size={16} className="text-brand" aria-hidden />
          <span className="font-semibold">Vehicle details ready for mechanics</span>
          <span className="text-[0.875rem] text-ink-2 underline decoration-rule underline-offset-2">View technical details</span>
        </summary>
        <div className="mt-1 border border-rule bg-paper px-3 py-3">
          <p className="font-semibold">{mechanicHeadline({ year, make, model }, spec)}</p>
          <ul className="mt-2 grid gap-1 text-[0.8125rem] sm:grid-cols-2">
            {rows
              .filter(([, f]) => f)
              .map(([k, f]) => (
                <li key={k}>
                  <span className="text-ink-3">{k}:</span> {f!.status === "needs_confirmation" ? <span className="text-ink-2">not confirmed</span> : f!.label}{" "}
                  <span className={`font-semibold ${f!.status === "needs_confirmation" ? "text-amber" : "text-ink-2"}`}>· {STATUS_LABEL[f!.status]}</span>
                </li>
              ))}
          </ul>
          {spec.open.length ? <p className="mt-2 text-[0.8125rem] text-ink-2">Mechanics confirm anything marked unconfirmed.</p> : null}
        </div>
      </details>
    </div>
  );
}
