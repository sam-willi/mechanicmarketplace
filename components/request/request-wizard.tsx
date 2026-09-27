"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, Ban, Check, CircleHelp, KeyRound, Loader2, Plus, ScanLine, ShieldAlert, Trash2 } from "lucide-react";
import { discardIntakeDraft, saveIntakeDraft, submitIntake } from "@/app/actions/intake";
import { AREAS } from "@/lib/domain/areas";
import {
  CODE_NOTE,
  KNOWN_SERVICES,
  LEAK_AMOUNTS,
  LEAK_COLORS,
  LEAK_LOCATIONS,
  MODIFICATIONS,
  OCCURRENCE,
  ONSET,
  PARKING,
  SMELLS,
  SOUNDS,
  SYMPTOM_EXAMPLES,
  URGENCY,
  WARNING_LIGHTS,
  WORK_SPACE,
  YNU,
  parseCodes,
  transmissionLabel,
  inferCategory,
} from "@/lib/domain/intake";
import { stepErrors, type IntakeDraft } from "@/lib/domain/intake-draft";
import { draftToRequest } from "@/lib/domain/intake-preview";
import type { RepairMedia, Vehicle } from "@/lib/domain/types";
import { MediaCapture } from "./media-capture";
import { RequestSummary } from "./request-summary";
import { PhotoGuide } from "./photo-guide";
import { EMPTY_CHOICE, SpecPreview, VehicleSelector, type VehicleChoice } from "@/components/vehicle/vehicle-selector";
import type { VehicleSpec, TransmissionType } from "@/lib/vehicles/types";

function legacyTransmission(t?: TransmissionType): IntakeDraft["vehicle"]["transmission"] {
  return t === "manual" ? "manual" : t === "automatic" ? "automatic" : t === "cvt" || t === "ecvt" ? "cvt" : t === "dct" ? "dual_clutch" : "";
}
import { ReadinessBadge } from "./readiness";
import { VehicleTile } from "@/components/visual/vehicle-glyph";
import { quoteReadiness } from "@/lib/domain/readiness";

/** Four steps a customer recognises. The same detailed fields are stored underneath. */
const STEPS = ["Your car", "The problem", "Photos and location", "Timing and review"];
const STEP_MINUTES = [1, 2, 1.5, 1];

/** The car's condition as one visual choice, mapped onto starts / drives / safe. */
const CONDITIONS = [
  { id: "normal", label: "Starts normally", icon: Check },
  { id: "hard", label: "Hard to start", icon: KeyRound },
  { id: "wont", label: "Won't start", icon: Ban },
  { id: "unsafe", label: "Unsafe to drive", icon: AlertTriangle },
  { id: "unsure", label: "Not sure", icon: CircleHelp },
] as const;
type Condition = (typeof CONDITIONS)[number]["id"];
const NO_START = [
  { value: "cranks_no_start", label: "Cranks but won't start" },
  { value: "clicks_no_crank", label: "Clicks but won't crank" },
  { value: "no_response", label: "Nothing happens" },
] as const;

function conditionOf(d: IntakeDraft): Condition | "" {
  if (d.driveability === "unsafe" || d.safeToDrive === "no") return "unsafe";
  if (d.startsStatus === "normal") return "normal";
  if (d.startsStatus === "difficult") return "hard";
  if (["cranks_no_start", "clicks_no_crank", "no_response"].includes(d.startsStatus)) return "wont";
  if (d.startsStatus === "unsure") return "unsure";
  return "";
}

type Target = { id: string; firstName: string; displayName: string } | null;

export function RequestWizard({
  initial,
  resumed,
  vehicles,
  customerId,
  target,
  rebook,
  noSupply = false,
  alertsOn = false,
}: {
  initial: IntakeDraft;
  resumed: boolean;
  vehicles: Vehicle[];
  customerId: string;
  target: Target;
  rebook: boolean;
  /** No mechanic can be booked yet: the request is saved, not sent. */
  noSupply?: boolean;
  /** Email alerts are configured and on (lib/notify/config.ts). */
  alertsOn?: boolean;
}) {
  const saveOnly = noSupply && !target;
  // Drafts saved under the old seven-step flow resume at the nearest new step.
  const [d, setD] = useState<IntakeDraft>({ ...initial, step: Math.min(initial.step, STEPS.length - 1) });
  const [maxStep, setMaxStep] = useState(Math.min(initial.step, STEPS.length - 1));
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(resumed ? "Picked up where you left off" : null);
  const [wontStart, setWontStart] = useState(conditionOf(initial) === "wont");
  const [submitting, startSubmit] = useTransition();
  const topRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const step = d.step;
  const hasSaved = vehicles.length > 0;

  const set = useCallback(<K extends keyof IntakeDraft>(k: K, v: IntakeDraft[K]) => setD((x) => ({ ...x, [k]: v })), []);
  const setVehicle = (k: keyof IntakeDraft["vehicle"], v: string) => setD((x) => ({ ...x, vehicle: { ...x.vehicle, [k]: v } }));
  const setMedia = (next: RepairMedia[]) => set("media", next);
  const setChoice = (c: VehicleChoice, spec: VehicleSpec | undefined) =>
    setD((x) => ({
      ...x,
      vehicle: {
        ...x.vehicle,
        choice: c,
        spec,
        year: c.year,
        make: c.make,
        model: c.model,
        trim: spec?.trim && spec.trim.status !== "needs_confirmation" ? spec.trim.label : "",
        engine: spec?.engine && spec.engine.status !== "needs_confirmation" ? spec.engine.label : c.engineText,
        transmission: legacyTransmission(spec?.transmission?.status !== "needs_confirmation" ? spec?.transmission?.type : undefined),
        vin: c.vin,
      },
    }));

  function setCondition(c: Condition) {
    setWontStart(c === "wont");
    setD((x) => {
      const base = { ...x, safeToDrive: x.safeToDrive === "no" ? ("" as const) : x.safeToDrive, driveability: x.driveability === "unsafe" ? ("" as const) : x.driveability };
      if (c === "normal") return { ...base, startsStatus: "normal" };
      if (c === "hard") return { ...base, startsStatus: "difficult" };
      if (c === "unsure") return { ...base, startsStatus: "unsure" };
      if (c === "unsafe") return { ...base, startsStatus: x.startsStatus || "normal", driveability: "unsafe", safeToDrive: "no" };
      return { ...base, startsStatus: "", driveability: "no" };
    });
  }

  // Autosave: debounced after edits.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(async () => {
      await saveIntakeDraft(d);
      setSaved(`Saved ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
    }, 900);
    return () => clearTimeout(t);
  }, [d]);

  function go(to: number) {
    if (to > step) {
      const e = stepErrors(d, step, hasSaved);
      if (e.length) {
        setErrors(e);
        topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
    setErrors([]);
    setMaxStep((m) => Math.max(m, to));
    setD((x) => ({ ...x, step: to }));
    // Save the new step right away (the debounced autosave waits for a pause), so a refresh
    // straight after "Continue" comes back to this step, not an earlier one.
    void saveIntakeDraft({ ...d, step: to }).catch(() => undefined);
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function submit() {
    startSubmit(async () => {
      const res = await submitIntake(d);
      if (res?.errors?.length) setErrors(res.errors);
    });
  }

  const current = vehicles.find((v) => v.id === d.vehicleId);
  const reached = Math.max(step, maxStep);
  const minutesLeft = Math.max(1, Math.round(STEP_MINUTES.slice(step).reduce((a, b) => a + b, 0)));
  const isNewCar = !current;
  const { preview, vehicle } = draftToRequest(d, customerId, vehicles);
  const brakeOrSteering = ["brakes", "suspension"].includes(inferCategory(d.symptomDescription, [], d.warningLights)) || d.warningLights.includes("Brake") || d.warningLights.includes("ABS");
  const safetyRisk = brakeOrSteering && (d.safeToDrive === "no" || d.driveability === "unsafe");
  const readiness = quoteReadiness(preview, { vin: d.vehicle.vin || current?.vin, mileage: Number(d.vehicle.mileage.replace(/[^0-9]/g, "")) || current?.mileage });
  const condition = wontStart ? "wont" : conditionOf(d);

  // Follow-up questions appear when the description or answers make them relevant.
  const text = d.symptomDescription.toLowerCase();
  const relevant = {
    lights: /light|warning|dash|check engine|abs|tpms/.test(text) || d.warningLights.some((l) => l !== "None"),
    sound: /nois|sound|grind|squeal|squeak|click|knock|rattl|hum|whin|hiss|clunk|thump/.test(text) || d.soundPresent === "yes",
    leak: /leak|drip|puddle|fluid/.test(text) || d.leakPresent === "yes",
    when: /sometimes|only when|when i|intermittent|cold|warm|hot|idle|brak|turn|acceler|highway/.test(text) || d.occurrence.length > 0,
  };

  const lightsQ = (
    <Q key="lights" title="Any warning lights on?">
      <Chips options={WARNING_LIGHTS} value={d.warningLights} onChange={(v) => set("warningLights", v.includes("None") && !d.warningLights.includes("None") ? ["None"] : v.filter((x) => x !== "None" || v.length === 1))} />
      {d.warningLights.some((l) => l !== "None") && (
        <div className="mt-3">
          <MediaCapture tag="dashboard" value={d.media} onChange={setMedia} modes={["photo"]} compact hint="A photo of the dashboard shows exactly which lights are on." />
        </div>
      )}
    </Q>
  );
  const soundQ = (
    <Q key="sound" title="Is it making an unusual sound?">
      <Segmented value={d.soundPresent} onChange={(v) => set("soundPresent", v as IntakeDraft["soundPresent"])} options={YNU} name="sound" />
      {d.soundPresent === "yes" && (
        <div className="mt-4 space-y-3">
          <MediaCapture tag="sound" value={d.media} onChange={setMedia} modes={["audio", "video"]} compact hint="A short recording near the sound is the most useful thing you can send." />
          <Chips options={SOUNDS} value={d.soundKinds} onChange={(v) => set("soundKinds", v)} />
          <input value={d.soundDescription} onChange={(e) => set("soundDescription", e.target.value)} className="input" placeholder="e.g. a grind from the front when I brake" aria-label="Describe the sound" />
        </div>
      )}
    </Q>
  );
  const leakQ = (
    <Q key="leak" title="Any leaks?">
      <Segmented value={d.leakPresent} onChange={(v) => set("leakPresent", v as IntakeDraft["leakPresent"])} options={YNU} name="leak" />
      {d.leakPresent === "yes" && (
        <div className="mt-4 space-y-4">
          <MediaCapture tag="leak" value={d.media} onChange={setMedia} modes={["photo"]} compact hint="A photo of the drip or puddle." />
          <Sub title="Where under the car?">
            <Chips single options={LEAK_LOCATIONS} value={d.leakLocation ? [d.leakLocation] : []} onChange={(v) => set("leakLocation", v[0] ?? "")} />
          </Sub>
          <Sub title="What color?">
            <Chips single options={LEAK_COLORS} value={d.leakColor ? [d.leakColor] : []} onChange={(v) => set("leakColor", v[0] ?? "")} />
          </Sub>
          <Sub title="About how much?">
            <Chips single options={LEAK_AMOUNTS} value={d.leakAmount ? [d.leakAmount] : []} onChange={(v) => set("leakAmount", v[0] ?? "")} />
          </Sub>
        </div>
      )}
    </Q>
  );
  const whenQ = (
    <Q key="when" title="When does it happen?">
      <Chips options={OCCURRENCE} value={d.occurrence} onChange={(v) => set("occurrence", v)} />
      {d.occurrence.includes("Other") && <input value={d.occurrenceNotes} onChange={(e) => set("occurrenceNotes", e.target.value)} className="input mt-3" placeholder="Tell us when" aria-label="When it happens" />}
    </Q>
  );
  const extras = [
    !relevant.lights && lightsQ,
    !relevant.sound && soundQ,
    !relevant.leak && leakQ,
    !relevant.when && whenQ,
    <Q key="onset" title="When did it start?">
      <Chips single options={ONSET.map((o) => o.label)} value={d.onset ? [ONSET.find((o) => o.value === d.onset)!.label] : []} onChange={(v) => set("onset", ONSET.find((o) => o.label === v[0])?.value ?? "")} />
    </Q>,
    <Q key="smell" title="Any unusual smell?">
      <Chips options={SMELLS} value={d.smells} onChange={(v) => set("smells", v)} />
    </Q>,
    <Q key="codes" title="Do you have diagnostic codes?">
      <Segmented
        value={d.hasCodes}
        onChange={(v) => setD((x) => ({ ...x, hasCodes: v as "yes" | "no", codes: v === "yes" ? x.codes : "" }))}
        options={[
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ]}
        name="codes"
      />
      {d.hasCodes === "yes" && (
        <div className="mt-3 space-y-2">
          <input value={d.codes} onChange={(e) => set("codes", e.target.value.toUpperCase())} className="input tnum uppercase" placeholder="e.g. P0302, P0171" autoCapitalize="characters" aria-label="Diagnostic codes" />
          {parseCodes(d.codes).length > 0 && (
            <p className="flex flex-wrap gap-1.5">
              {parseCodes(d.codes).map((c) => (
                <span key={c} className="tnum border border-ink px-1.5 py-0.5 text-[0.8125rem] font-bold">
                  {c}
                </span>
              ))}
            </p>
          )}
          <p className="text-[0.8125rem] text-ink-3">{CODE_NOTE}</p>
        </div>
      )}
    </Q>,
    <Q key="recent" title="Any recent work on the car?">
      <Segmented
        value={d.hasRecentWork}
        onChange={(v) => setD((x) => ({ ...x, hasRecentWork: v as "yes" | "no", recentRepairs: v === "yes" && x.recentRepairs.length === 0 ? [{ what: "" }] : x.recentRepairs }))}
        options={[
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ]}
        name="recent"
      />
      {d.hasRecentWork === "yes" && (
        <Repeater
          items={d.recentRepairs}
          onChange={(v) => set("recentRepairs", v)}
          blank={{ what: "" }}
          addLabel="Add another"
          render={(item, update) => (
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={item.what} onChange={(e) => update({ ...item, what: e.target.value })} className="input sm:col-span-2" placeholder="What was done? e.g. Battery replaced" aria-label="What was repaired or replaced" />
              <input value={item.when ?? ""} onChange={(e) => update({ ...item, when: e.target.value })} className="input" placeholder="About when?" aria-label="Approximate date" />
              <input value={item.shop ?? ""} onChange={(e) => update({ ...item, shop: e.target.value })} className="input" placeholder="Shop or mechanic" aria-label="Shop or mechanic" />
            </div>
          )}
        />
      )}
    </Q>,
    <Q key="prior" title="Has another shop looked at it?">
      <Segmented
        value={d.hadPriorShop}
        onChange={(v) => set("hadPriorShop", v as "yes" | "no")}
        options={[
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ]}
        name="prior"
      />
      {d.hadPriorShop === "yes" && (
        <div className="mt-4 space-y-3">
          <textarea value={d.priorSaid} onChange={(e) => set("priorSaid", e.target.value)} rows={2} className="input" placeholder="What did they say?" aria-label="What the other shop said" />
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <input value={d.priorRepair} onChange={(e) => set("priorRepair", e.target.value)} className="input" placeholder="Repair they quoted" aria-label="Quoted repair" />
            <input value={d.priorPrice} onChange={(e) => set("priorPrice", e.target.value)} inputMode="decimal" className="input tnum" placeholder="Price ($)" aria-label="Quoted price" />
          </div>
          <MediaCapture tag="prior_estimate" value={d.media} onChange={setMedia} modes={["photo", "file"]} compact />
        </div>
      )}
    </Q>,
    <Q key="parts" title="Already bought parts for this?">
      <Segmented
        value={d.hasParts}
        onChange={(v) => setD((x) => ({ ...x, hasParts: v as "yes" | "no", parts: v === "yes" && x.parts.length === 0 ? [{ description: "" }] : x.parts }))}
        options={[
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ]}
        name="parts"
      />
      {d.hasParts === "yes" && (
        <div className="mt-4 space-y-3">
          <Repeater
            items={d.parts}
            onChange={(v) => set("parts", v)}
            blank={{ description: "" }}
            addLabel="Add another part"
            render={(item, update) => (
              <div className="grid gap-2 sm:grid-cols-3">
                <input value={item.description} onChange={(e) => update({ ...item, description: e.target.value })} className="input sm:col-span-3" placeholder="Part, e.g. Front brake pads" aria-label="Part description" />
                <input value={item.brand ?? ""} onChange={(e) => update({ ...item, brand: e.target.value })} className="input" placeholder="Brand" aria-label="Brand" />
                <input value={item.partNumber ?? ""} onChange={(e) => update({ ...item, partNumber: e.target.value })} className="input tnum sm:col-span-2" placeholder="Part number" aria-label="Part number" />
              </div>
            )}
          />
          <MediaCapture tag="customer_part" value={d.media} onChange={setMedia} modes={["photo"]} compact />
        </div>
      )}
    </Q>,
    <Q key="mods" title="Modified from stock?">
      <Segmented
        value={d.hasMods}
        onChange={(v) => set("hasMods", v as "yes" | "no")}
        options={[
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ]}
        name="mods"
      />
      {d.hasMods === "yes" && (
        <div className="mt-4 space-y-3">
          <Chips options={MODIFICATIONS} value={d.modKinds} onChange={(v) => set("modKinds", v)} />
          <input value={d.modNotes} onChange={(e) => set("modNotes", e.target.value)} className="input" placeholder="Anything specific?" aria-label="Modification notes" />
        </div>
      )}
    </Q>,
    <Q key="suspect" title="What do you think it is?">
      <textarea value={d.suspectedIssue} onChange={(e) => set("suspectedIssue", e.target.value)} rows={2} className="input" placeholder="e.g. A shop said it may need a starter." aria-label="What you suspect" />
      <select value={d.knownService} onChange={(e) => set("knownService", e.target.value)} className="input mt-2 max-w-[24rem]" aria-label="Known repair or service">
        <option value="">Known service? Not sure / skip</option>
        {KNOWN_SERVICES.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </select>
    </Q>,
  ].filter(Boolean);
  const extrasFilled = Boolean(d.onset || d.smells.length || d.hasCodes || d.hasRecentWork || d.hadPriorShop || d.hasParts || d.hasMods || d.suspectedIssue || d.knownService);

  const mileage = (
    <Field label="Mileage" className="max-w-[16rem]">
      <input value={d.vehicle.mileage} onChange={(e) => setVehicle("mileage", e.target.value)} inputMode="numeric" className="input tnum" placeholder="71,000" aria-label="Current mileage" />
    </Field>
  );

  return (
    <div ref={topRef} className="scroll-mt-20 pb-32">
      {/* Four steps; finished ones are links back */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="tnum text-[0.8125rem] font-bold text-ink-2">
          Step {step + 1} of {STEPS.length} · about {minutesLeft} min
        </p>
        {saved ? (
          <p className="text-[0.75rem] text-ink-3" aria-live="polite">
            {saved}
          </p>
        ) : null}
      </div>
      <ol className="mt-2 grid grid-cols-4 gap-1.5" aria-label="Steps">
        {STEPS.map((s, i) => {
          const done = i < reached && i !== step;
          const here = i === step;
          return (
            <li key={s} className="min-w-0">
              <button
                type="button"
                onClick={() => (i <= reached ? go(i) : undefined)}
                disabled={i > reached || here}
                aria-current={here ? "step" : undefined}
                aria-label={`${s}${here ? " (current step)" : done ? " (done, go back to edit)" : i <= reached ? "" : " (not started)"}`}
                className="group block w-full min-w-0 text-left disabled:cursor-default"
              >
                <span className={`block h-2 w-full ${here ? "bg-brand" : done ? "bg-ink-2" : "bg-rule-soft"}`} />
                <span className={`mt-1.5 block text-[0.75rem] leading-tight sm:text-[0.8125rem] ${here ? "font-bold text-ink" : done ? "text-ink-2 underline decoration-rule underline-offset-2 group-hover:text-ink" : "text-ink-3"}`}>
                  {s}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <h2 className="display mt-6 text-[1.875rem] sm:text-[2.25rem]">{STEPS[step]}</h2>

      {safetyRisk && step >= 1 && (
        <div role="alert" className="mt-4 flex gap-3 border-2 border-alert bg-alert-wash px-4 py-3 text-[0.9375rem]">
          <ShieldAlert size={20} className="mt-0.5 shrink-0 text-alert" aria-hidden />
          <p>
            <span className="font-bold text-alert">Don&apos;t drive it.</span> Your mechanic comes to the car, so leave it where it is. In an emergency, call 911.
          </p>
        </div>
      )}

      {errors.length > 0 && (
        <div role="alert" className="mt-4 border border-alert bg-alert-wash px-4 py-3 text-[0.9375rem] text-ink">
          <p className="font-bold text-alert">A little more is needed</p>
          <ul className="mt-1 list-disc pl-5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 space-y-9">
        {/* ------------------------------------------------------ 1. YOUR CAR */}
        {step === 0 && (
          <>
            {hasSaved && (
              <fieldset>
                <legend className="sr-only">Which car?</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {vehicles.map((v) => (
                    <label
                      key={v.id}
                      className="flex cursor-pointer items-center gap-3 border border-rule bg-sheet p-3 hover:border-ink-3 has-[:checked]:border-brand has-[:checked]:shadow-[inset_0_0_0_1px_var(--brand)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand"
                    >
                      <input
                        type="radio"
                        name="vehicle"
                        className="sr-only"
                        checked={d.vehicleId === v.id}
                        onChange={() => setD((x) => ({ ...x, vehicleId: v.id, vehicle: { ...x.vehicle, mileage: v.mileage ? v.mileage.toLocaleString() : "" } }))}
                      />
                      <VehicleTile v={v} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold">
                          {v.year} {v.make} {v.model}
                        </span>
                        <span className="block text-[0.8125rem] text-ink-2">{v.mileage ? `${v.mileage.toLocaleString()} mi` : "Saved car"}</span>
                      </span>
                      {d.vehicleId === v.id ? <Check size={18} className="shrink-0 text-brand" aria-hidden /> : null}
                    </label>
                  ))}
                  <label className="flex min-h-[4.5rem] cursor-pointer items-center gap-3 border border-dashed border-rule bg-sheet p-3 hover:border-ink-3 has-[:checked]:border-solid has-[:checked]:border-brand has-[:checked]:shadow-[inset_0_0_0_1px_var(--brand)]">
                    <input type="radio" name="vehicle" className="sr-only" checked={isNewCar} onChange={() => setD((x) => ({ ...x, vehicleId: "new", vehicle: { ...x.vehicle, mileage: "" } }))} />
                    <span className="grid size-11 place-items-center border border-rule text-ink-2" aria-hidden>
                      <Plus size={18} />
                    </span>
                    <span className="font-bold">A different car</span>
                  </label>
                </div>
              </fieldset>
            )}
            {isNewCar ? (
              <VehicleSelector value={d.vehicle.choice ?? { ...EMPTY_CHOICE, vin: d.vehicle.vin }} onChange={setChoice} beforeVin={mileage} />
            ) : current ? (
              <>
                <p className="border-l-4 border-brand bg-sheet px-4 py-3 text-[1.0625rem] font-bold">
                  {current.year} {current.make} {current.model}
                  <span className="font-normal text-ink-2">
                    {[transmissionLabel(current.transmission) || null, d.vehicle.mileage ? `${d.vehicle.mileage} miles` : null].filter(Boolean).map((x) => ` · ${x}`)}
                  </span>
                </p>
                {current.spec ? (
                  <SpecPreview year={current.year} make={current.make} model={current.model} spec={current.spec} />
                ) : (
                  <details className="group" open={Boolean(d.vehicle.choice)}>
                    <summary className="min-h-11 cursor-pointer content-center font-semibold">Add the exact engine and transmission</summary>
                    <div className="mt-3">
                      <VehicleSelector
                        value={d.vehicle.choice ?? { ...EMPTY_CHOICE, year: String(current.year), make: current.make, model: current.model, vin: current.vin ?? "" }}
                        onChange={setChoice}
                        showVin={false}
                      />
                    </div>
                  </details>
                )}
                {mileage}
                {!current.vin ? (
                  <details className="group border-t border-rule-soft pt-2" open={Boolean(d.vehicle.vin)}>
                    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">
                      <ScanLine size={17} aria-hidden /> Add VIN for more accurate parts and estimates
                      <span className="text-[0.8125rem] font-normal text-ink-3">Optional</span>
                    </summary>
                    <div className="space-y-3 pt-2">
                      <div className="max-w-[15rem]">
                        <PhotoGuide show={["vin"]} />
                      </div>
                      <input
                        value={d.vehicle.vin}
                        onChange={(e) => setVehicle("vin", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                        maxLength={17}
                        className="input tnum max-w-[18rem] tracking-[0.06em] uppercase"
                        placeholder="17-character VIN"
                        aria-label="VIN"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <MediaCapture tag="vin" value={d.media} onChange={setMedia} modes={["photo"]} compact hint="Or a photo of it." />
                    </div>
                  </details>
                ) : null}
              </>
            ) : null}
          </>
        )}

        {/* ---------------------------------------------------- 2. THE PROBLEM */}
        {step === 1 && (
          <>
            <Q req title="What is the car doing?" hint="In your own words; you don't need to know the part. For example: “Grinding from the front when I brake, worse in the morning.”">
              <textarea
                value={d.symptomDescription}
                onChange={(e) => set("symptomDescription", e.target.value)}
                rows={4}
                className="input text-[1rem] leading-relaxed"
                placeholder={SYMPTOM_EXAMPLES[0]}
                aria-label="What is the car doing?"
              />
            </Q>
            <fieldset>
              <legend className="text-[1.0625rem] font-bold">
                Does it start and drive?
                <span className="ml-2 align-middle text-[0.6875rem] font-bold tracking-[0.06em] text-ink uppercase">Required</span>
              </legend>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5" role="radiogroup">
                {CONDITIONS.map((c) => (
                  <label
                    key={c.id}
                    className="flex min-h-[5.5rem] cursor-pointer flex-col items-center justify-center gap-2 border border-rule bg-sheet p-3 text-center text-[0.9375rem] font-semibold hover:border-ink-3 has-[:checked]:border-brand has-[:checked]:bg-brand has-[:checked]:text-on-brand has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand"
                  >
                    <input type="radio" name="condition" className="sr-only" checked={condition === c.id} onChange={() => setCondition(c.id)} />
                    <c.icon size={22} aria-hidden />
                    {c.label}
                  </label>
                ))}
              </div>
              {condition === "wont" && (
                <div className="mt-4">
                  <p className="mb-2 text-[0.9375rem] font-semibold">What happens when you try?</p>
                  <Options value={d.startsStatus} onChange={(v) => set("startsStatus", v as IntakeDraft["startsStatus"])} options={[...NO_START]} name="nostart" />
                </div>
              )}
            </fieldset>
            {relevant.lights && lightsQ}
            {relevant.sound && soundQ}
            {relevant.leak && leakQ}
            {relevant.when && whenQ}
            <details className="group border-t border-rule pt-2" open={extrasFilled}>
              <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">
                <Plus size={17} className="transition-transform group-open:rotate-45" aria-hidden /> Add more detail
                <span className="text-[0.8125rem] font-normal text-ink-3">Optional</span>
              </summary>
              <div className="mt-4 space-y-8">{extras}</div>
            </details>
          </>
        )}

        {/* ------------------------------------------ 3. PHOTOS AND LOCATION */}
        {step === 2 && (
          <>
            <Q title="Photos">
              <PhotoGuide show={["dashboard", "part", "location"]} />
              <div className="mt-3">
                <MediaCapture tag="issue" value={d.media} onChange={setMedia} modes={["photo", "video", "audio", "file"]} />
              </div>
            </Q>
            <p className="text-[0.9375rem] text-ink-2">Clutch mechanics come to the car, at home, at work or wherever it&apos;s parked.</p>
            <Field label="Area the car is in" className="max-w-[20rem]">
              <select value={d.area} onChange={(e) => set("area", e.target.value)} className="input">
                <option value="">Choose</option>
                {AREAS.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Address" hint="Shared only with the mechanic you book.">
              <input value={d.address} onChange={(e) => set("address", e.target.value)} className="input" autoComplete="street-address" placeholder="Street address" />
            </Field>
            <Q title="Where is it parked?">
              <Chips single options={PARKING.map((p) => p.label)} value={d.parkingType ? [PARKING.find((p) => p.value === d.parkingType)!.label] : []} onChange={(v) => set("parkingType", PARKING.find((p) => p.label === v[0])?.value ?? "")} />
            </Q>
            <div className="grid gap-6 sm:grid-cols-2">
              <Q title="Flat ground?">
                <Segmented value={d.flatGround} onChange={(v) => set("flatGround", v as IntakeDraft["flatGround"])} options={YNU} name="flat" />
              </Q>
              <Q title="Repairs allowed there?">
                <Segmented value={d.repairsAllowed} onChange={(v) => set("repairsAllowed", v as IntakeDraft["repairsAllowed"])} options={YNU} name="allowed" />
              </Q>
            </div>
            <Q title="Room to work around the car?">
              <Segmented value={d.workSpace} onChange={(v) => set("workSpace", v as IntakeDraft["workSpace"])} options={WORK_SPACE} name="space" />
            </Q>
            <details className="group" open={Boolean(d.accessAvailable || d.locationNotes)}>
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">
                <Plus size={17} className="transition-transform group-open:rotate-45" aria-hidden /> Access and notes
                <span className="text-[0.8125rem] font-normal text-ink-3">Optional</span>
              </summary>
              <div className="mt-3 space-y-5">
                <Q title="Will someone be there?">
                  <Segmented
                    value={d.accessAvailable}
                    onChange={(v) => set("accessAvailable", v as "yes" | "no")}
                    options={[
                      { value: "yes", label: "Yes" },
                      { value: "no", label: "No" },
                    ]}
                    name="access"
                  />
                  {d.accessAvailable && (
                    <textarea
                      value={d.accessInstructions}
                      onChange={(e) => set("accessInstructions", e.target.value)}
                      rows={2}
                      className="input mt-3"
                      placeholder={d.accessAvailable === "no" ? "Where are the keys? Any gate code?" : "Gate or parking instructions"}
                      aria-label="Access instructions"
                    />
                  )}
                </Q>
                <Field label="Anything else about the location?">
                  <textarea value={d.locationNotes} onChange={(e) => set("locationNotes", e.target.value)} rows={2} className="input" placeholder="e.g. low garage, parked on a slope" />
                </Field>
              </div>
            </details>
          </>
        )}

        {/* ---------------------------------------------- 4. TIMING AND REVIEW */}
        {step === 3 && (
          <>
            <Q req title="How soon do you need help?">
              <Options value={d.urgency} onChange={(v) => set("urgency", v as IntakeDraft["urgency"])} options={URGENCY} name="urgency" />
              {d.urgency === "stranded" && (
                <p className="mt-3 border border-amber bg-amber-wash px-4 py-3 text-[0.9375rem]">Clutch isn&apos;t a roadside service. If you&apos;re somewhere unsafe, call roadside assistance or 911 first.</p>
              )}
            </Q>
            <Field label="When works for you?">
              <input value={d.preferredTimes} onChange={(e) => set("preferredTimes", e.target.value)} className="input" placeholder="e.g. Saturday morning, or weekdays after 5pm" />
            </Field>

            <section aria-labelledby="preview-title" className="border border-rule bg-sheet">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule-soft px-4 py-3">
                <h3 id="preview-title" className="font-bold">
                  What mechanics will see
                </h3>
                <p className="text-[0.8125rem] text-ink-2">{target ? `Goes to ${target.displayName}${rebook ? " again" : " only"}` : saveOnly ? "Saved until a mechanic fits it" : "Goes to a few available mechanics who match your car, repair and area"}</p>
              </div>
              <dl className="grid gap-x-6 px-4 py-3 text-[0.9375rem] sm:grid-cols-2">
                {(
                  [
                    ["Car", vehicle.year ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : "Not set"],
                    ["Problem", d.symptomDescription.trim() || "Not described"],
                    ["Condition", CONDITIONS.find((c) => c.id === condition)?.label ?? "Not set"],
                    ["Photos and recordings", String(d.media.length)],
                    ["Where", d.area ? `Comes to the car · ${AREAS.find((a) => a.key === d.area)?.label}` : "Not set"],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="border-b border-rule-soft py-2 last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
                    <dt className="text-[0.75rem] text-ink-3">{k}</dt>
                    <dd className="line-clamp-2 font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
              {readiness.gaps.some((g) => g.blocks) ? (
                <div className="border-t border-rule-soft px-4 py-3">
                  <ReadinessBadge readiness={readiness} audience="customer" />
                </div>
              ) : null}
              <details className="group border-t border-rule-soft px-4">
                <summary className="flex min-h-11 cursor-pointer list-none items-center text-[0.875rem] font-semibold underline decoration-rule underline-offset-2 [&::-webkit-details-marker]:hidden">
                  See the full request
                </summary>
                <div className="pb-4">{vehicle.year ? <RequestSummary r={preview} v={vehicle} audience="mechanic" /> : null}</div>
              </details>
            </section>
            {saveOnly ? (
              <div role="note" className="border-l-4 border-brass bg-sheet px-4 py-3 text-[0.9375rem]">
                <p className="font-semibold">No mechanics are available on Clutch yet.</p>
                <p className="mt-1 text-ink-2">
                  Saving keeps this request on your Requests page, where you can edit or cancel it. When a mechanic who fits your car, repair and area joins, Clutch
                  sends it to them and their reply shows on the request.{" "}
                  {alertsOn ? "You'll also get an email alert if alerts are on in your settings." : "Clutch doesn't send email or text alerts yet, so check back there."}
                </p>
              </div>
            ) : null}
            <p className="text-[0.8125rem] text-ink-3">Your address and access details stay private until you book.</p>
          </>
        )}
      </div>

      {/* Sticky controls: large, thumb-reachable */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-sheet/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm">
        <div className="mx-auto flex max-w-[760px] items-center gap-2 px-4 pt-3 sm:px-6">
          {step > 0 ? (
            <button type="button" onClick={() => go(step - 1)} className="btn btn-quiet min-h-12 px-4" aria-label="Back">
              <ArrowLeft size={18} aria-hidden />
              <span className="hidden sm:inline">Back</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={async () => {
              await saveIntakeDraft(d);
              router.push("/customer?saved=1");
            }}
            className="px-2 text-[0.8125rem] font-semibold text-ink-2 underline decoration-rule underline-offset-2"
          >
            Finish later
          </button>
          <div className="flex-1" />
          {step < STEPS.length - 1 ? (
            <button type="button" onClick={() => go(step + 1)} className="btn btn-ink min-h-12 px-6 text-[0.9375rem]">
              Continue <ArrowRight size={18} aria-hidden />
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={submitting} className="btn btn-ink min-h-12 px-6 text-[0.9375rem]">
              {submitting ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Check size={18} aria-hidden />}
              {target ? `Send to ${target.firstName}` : saveOnly ? "Save request" : "Send request"}
            </button>
          )}
        </div>
      </div>
      {resumed && step === 0 && (
        <form action={discardIntakeDraft} className="mt-8">
          <button className="text-[0.8125rem] text-ink-3 underline decoration-rule underline-offset-2">Start over instead</button>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Controls: big, thumb-friendly, real inputs underneath for accessibility.
// ---------------------------------------------------------------------------
function Q({ title, hint, children, req = false }: { title: string; hint?: string; children: React.ReactNode; req?: boolean }) {
  return (
    <fieldset>
      <legend className="text-[1.0625rem] font-bold text-ink">
        {title}
        <span className={`ml-2 align-middle text-[0.6875rem] font-bold tracking-[0.06em] uppercase ${req ? "text-ink" : "text-ink-3"}`}>{req ? "Required" : "Optional"}</span>
      </legend>
      {hint ? <p className="mt-1 text-[0.875rem] text-ink-2">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </fieldset>
  );
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[0.875rem] font-semibold">{title}</p>
      {children}
    </div>
  );
}

function Field({ label, hint, children, className = "" }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="field-label">{label}</span>
      <span className="mt-1 block">{children}</span>
      {hint ? <span className="mt-1 block text-[0.8125rem] text-ink-3">{hint}</span> : null}
    </label>
  );
}

function Choice({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label className="flex min-h-14 cursor-pointer items-center gap-3 border border-rule bg-sheet px-4 py-3 transition-colors hover:border-ink-3 has-[:checked]:border-brand has-[:checked]:ring-1 has-[:checked]:ring-brand has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand">
      <input type="radio" name={name} checked={checked} onChange={onChange} className="size-5 shrink-0 accent-[var(--brand)]" />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

function Options<T extends string>({ value, onChange, options, name }: { value: string; onChange: (v: T) => void; options: { value: T; label: string }[]; name: string }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => (
        <Choice key={o.value} name={name} checked={value === o.value} onChange={() => onChange(o.value)}>
          <span className="font-semibold">{o.label}</span>
        </Choice>
      ))}
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options, name }: { value: string; onChange: (v: T) => void; options: { value: T; label: string }[]; name: string }) {
  return (
    <div className="inline-grid w-full grid-flow-col auto-cols-fr border border-ink sm:w-auto" role="radiogroup">
      {options.map((o, i) => (
        <label
          key={o.value}
          className={`flex min-h-12 min-w-24 cursor-pointer items-center justify-center px-4 text-[0.9375rem] font-bold transition-colors has-[:checked]:bg-brand has-[:checked]:text-sheet has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand ${i > 0 ? "border-l border-ink" : ""}`}
        >
          <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function Chips({ options, value, onChange, single = false }: { options: string[]; value: string[]; onChange: (v: string[]) => void; single?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(single ? (on ? [] : [o]) : on ? value.filter((x) => x !== o) : [...value, o])}
            className={`inline-flex min-h-11 items-center gap-1.5 border px-3.5 text-[0.9375rem] transition-colors ${on ? "border-brand bg-brand font-bold text-sheet" : "border-rule bg-sheet text-ink hover:border-ink-3"}`}
          >
            {on ? <Check size={15} strokeWidth={2.5} aria-hidden /> : null}
            {o}
          </button>
        );
      })}
    </div>
  );
}

function Repeater<T>({
  items,
  onChange,
  blank,
  addLabel,
  render,
}: {
  items: T[];
  onChange: (v: T[]) => void;
  blank: T;
  addLabel: string;
  render: (item: T, update: (next: T) => void) => React.ReactNode;
}) {
  return (
    <div className="mt-4 space-y-3">
      {items.map((item, i) => (
        <div key={i} className="flex gap-2">
          <div className="min-w-0 flex-1">{render(item, (next) => onChange(items.map((x, j) => (j === i ? next : x))))}</div>
          {items.length > 1 && (
            <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="grid size-11 shrink-0 place-items-center border border-rule text-ink-2 hover:text-ink" aria-label="Remove">
              <Trash2 size={16} aria-hidden />
            </button>
          )}
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, blank])} className="inline-flex items-center gap-1.5 text-[0.875rem] font-semibold underline decoration-rule underline-offset-2">
        <Plus size={15} aria-hidden /> {addLabel}
      </button>
    </div>
  );
}
