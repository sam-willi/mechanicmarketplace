"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";
import { saveEstimate, type EstimateInput } from "@/app/actions/mechanic";
import { slotLabel, type Slot } from "@/lib/domain/schedule";
import { inclusions, quoteTotals } from "@/lib/domain/quote";
import { usd } from "@/lib/format";

type Line = EstimateInput["lines"][number];
type Alt = EstimateInput["alternates"][number];

const dollars = (c: number) => (c ? String(c / 100) : "");
const cents = (v: string) => Math.round((Number(v.replace(/[^0-9.]/g, "")) || 0) * 100);
let seq = 0;
const lineId = () => `l${Date.now().toString(36)}${seq++}`;

/**
 * Itemized estimate with a live customer-facing total and preview. Autosaves a
 * draft as you type; sending asks for confirmation first.
 */
export function EstimateBuilder({
  requestId,
  customerFirst,
  initial,
  hourlyRateCents,
  canSend,
  blockedReason,
  mobileAllowed,
  shopAllowed,
  openings = [],
}: {
  requestId: string;
  customerFirst: string;
  initial: EstimateInput;
  hourlyRateCents: number;
  canSend: boolean;
  blockedReason?: string;
  mobileAllowed: boolean;
  shopAllowed: boolean;
  /** The mechanic's posted openings, offered as one-tap times. */
  openings?: Slot[];
}) {
  const [v, setV] = useState<EstimateInput>(initial);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [sending, startSend] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = <K extends keyof EstimateInput>(k: K, val: EstimateInput[K]) => {
    setV((p) => ({ ...p, [k]: val }));
    setDirty(true);
  };
  const setLine = (id: string, patch: Partial<Line>) =>
    set(
      "lines",
      v.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    );
  const setAlt = (i: number, patch: Partial<Alt>) =>
    set(
      "alternates",
      v.alternates.map((a, j) => (j === i ? { ...a, ...patch } : a)),
    );

  // Autosave: a quiet draft save a moment after typing stops.
  useEffect(() => {
    if (!dirty) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      startSave(async () => {
        const res = await saveEstimate(requestId, v, "draft");
        if (res.ok && res.savedAt) setSavedAt(res.savedAt);
      });
    }, 1200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [v, dirty, requestId]);

  const labor = v.lines.filter((l) => l.kind === "labor").reduce((n, l) => n + l.cents, 0);
  const parts = v.lines.filter((l) => l.kind === "part").reduce((n, l) => n + l.cents, 0);
  const totals = quoteTotals({
    laborCents: labor,
    diagnosticFeeCents: v.diagnosticFeeCents,
    travelFeeCents: v.serviceMode === "mobile" ? v.travelFeeCents : 0,
    partsIncluded: v.partsIncluded,
    partsEstimateCents: parts,
  });
  const inc = useMemo(
    () =>
      inclusions({
        diagnosticFeeCents: v.diagnosticFeeCents,
        travelFeeCents: v.travelFeeCents,
        partsIncluded: v.partsIncluded,
        partsEstimateCents: parts,
        serviceMode: v.serviceMode,
        exclusions: v.exclusions,
      }),
    [v.diagnosticFeeCents, v.travelFeeCents, v.partsIncluded, parts, v.serviceMode, v.exclusions],
  );

  function send() {
    setError(null);
    const msg = `Send this estimate to ${customerFirst}?\n\nTotal: ${totals.planFor}\n${totals.partsLine}\nValid until ${v.expiresOn || "no date"}\n\n${customerFirst} will be notified. You can update it later, and they'll see that it changed.`;
    if (!window.confirm(msg)) return;
    startSend(async () => {
      const res = await saveEstimate(requestId, v, "send");
      if (res && !res.ok) setError(res.error ?? "Couldn't send. Try again.");
    });
  }

  const money = "input tnum";
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="space-y-6">
        {/* Labor and parts */}
        <fieldset className="space-y-2">
          <legend className="heading text-[1.0625rem]">Labor and parts</legend>
          <p className="text-[0.8125rem] text-ink-3">One line per job step or part. Your rate is {usd(hourlyRateCents)}/hr.</p>
          <ul className="space-y-2">
            {v.lines.map((l) => (
              <li key={l.id} className="grid grid-cols-[6.5rem_minmax(0,1fr)_7rem_2.75rem] items-center gap-2">
                <select
                  aria-label="Line type"
                  value={l.kind}
                  onChange={(e) => setLine(l.id, { kind: e.target.value as Line["kind"] })}
                  className="input min-h-11 px-2 text-[0.875rem]"
                >
                  <option value="labor">Labor</option>
                  <option value="part">Part</option>
                </select>
                <input
                  aria-label="Description"
                  value={l.label}
                  onChange={(e) => setLine(l.id, { label: e.target.value })}
                  className="input min-h-11"
                  placeholder={l.kind === "labor" ? "e.g. Replace front pads and rotors" : "e.g. Front rotors (pair), OEM"}
                />
                <input
                  aria-label="Amount in dollars"
                  inputMode="decimal"
                  value={dollars(l.cents)}
                  onChange={(e) => setLine(l.id, { cents: cents(e.target.value) })}
                  className={`${money} min-h-11`}
                  placeholder="$0"
                />
                <button
                  type="button"
                  onClick={() =>
                    set(
                      "lines",
                      v.lines.filter((x) => x.id !== l.id),
                    )
                  }
                  className="grid size-11 place-items-center text-ink-3 hover:text-alert"
                  aria-label={`Remove ${l.label || "line"}`}
                >
                  <Trash2 size={16} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => set("lines", [...v.lines, { id: lineId(), kind: "labor", label: "", cents: 0 }])}
              className="btn btn-quiet min-h-11 text-sm"
            >
              <Plus size={15} aria-hidden /> Labor line
            </button>
            <button
              type="button"
              onClick={() => set("lines", [...v.lines, { id: lineId(), kind: "part", label: "", cents: 0 }])}
              className="btn btn-quiet min-h-11 text-sm"
            >
              <Plus size={15} aria-hidden /> Part
            </button>
            <label className="ml-auto flex items-center gap-2 text-[0.875rem]">
              Hours
              <input
                inputMode="decimal"
                value={v.durationHours || ""}
                onChange={(e) => set("durationHours", Number(e.target.value) || 0)}
                className="input tnum min-h-11 w-20"
                aria-label="Estimated hours"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                const c = Math.round(v.durationHours * hourlyRateCents);
                const first = v.lines.find((l) => l.kind === "labor");
                if (first) setLine(first.id, { cents: c });
                else set("lines", [{ id: lineId(), kind: "labor", label: "Labor", cents: c }, ...v.lines]);
              }}
              className="btn btn-quiet min-h-11 text-sm"
            >
              Use hours × rate
            </button>
          </div>
        </fieldset>

        {/* Parts treatment: impossible to miss */}
        <fieldset>
          <legend className="heading text-[1.0625rem]">How are parts charged?</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {(
              [
                [true, "Included, fixed price", "The parts lines above are the price. No surprises."],
                [false, "Billed at cost with receipts", "Parts lines are an estimate; the customer pays what they cost."],
              ] as const
            ).map(([val, title, body]) => (
              <label
                key={title}
                className="flex min-h-11 cursor-pointer gap-2.5 border border-rule bg-sheet p-3 has-[:checked]:border-brand has-[:checked]:ring-1 has-[:checked]:ring-ink"
              >
                <input
                  type="radio"
                  name="partsIncluded"
                  checked={v.partsIncluded === val}
                  onChange={() => set("partsIncluded", val)}
                  className="mt-1 accent-[var(--ink)]"
                />
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-[0.8125rem] text-ink-2">{body}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Fees, place, time */}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">Diagnostic fee ($)</span>
            <input
              inputMode="decimal"
              value={dollars(v.diagnosticFeeCents)}
              onChange={(e) => set("diagnosticFeeCents", cents(e.target.value))}
              className={`${money} mt-1`}
              placeholder="0"
            />
          </label>
          <label className="block">
            <span className="field-label">Where</span>
            <select value={v.serviceMode} onChange={(e) => set("serviceMode", e.target.value as "mobile" | "shop")} className="input mt-1">
              {mobileAllowed && <option value="mobile">At the customer&apos;s location</option>}
              {shopAllowed && <option value="shop">At my shop</option>}
            </select>
          </label>
          {v.serviceMode === "mobile" && (
            <label className="block">
              <span className="field-label">Travel fee ($)</span>
              <input
                inputMode="decimal"
                value={dollars(v.travelFeeCents)}
                onChange={(e) => set("travelFeeCents", cents(e.target.value))}
                className={`${money} mt-1`}
                placeholder="0"
              />
            </label>
          )}
          <fieldset className="block sm:col-span-2">
            <legend className="field-label">When you can do it</legend>
            {openings.length ? (
              <div className="mt-1 flex flex-wrap gap-2">
                {openings.map((o) => {
                  const on = v.availableDate === o.date && v.availableTime === o.time;
                  return (
                    <button
                      key={o.date + o.time}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        set("availableDate", o.date);
                        set("availableTime", o.time);
                      }}
                      className={`min-h-11 border px-3 text-[0.875rem] ${on ? "border-brand bg-brand font-semibold text-on-brand" : "border-rule bg-sheet hover:border-ink-3"}`}
                    >
                      {slotLabel(o)}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input type="date" value={v.availableDate} onChange={(e) => set("availableDate", e.target.value)} className="input" aria-label="Date" />
              <input
                type="time"
                step={900}
                value={v.availableTime}
                onChange={(e) => set("availableTime", e.target.value)}
                className="input"
                aria-label="Time"
              />
            </div>
          </fieldset>
          <label className="block">
            <span className="field-label">Estimate valid until</span>
            <input type="date" value={v.expiresOn} onChange={(e) => set("expiresOn", e.target.value)} className="input mt-1" />
          </label>
        </div>

        <label className="block">
          <span className="field-label">Scope of work</span>
          <textarea
            value={v.scope}
            onChange={(e) => set("scope", e.target.value)}
            rows={3}
            className="input mt-1"
            placeholder="What you'll do and what you'll check first."
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">This price assumes</span>
            <textarea
              value={v.assumptions}
              onChange={(e) => set("assumptions", e.target.value)}
              rows={3}
              className="input mt-1"
              placeholder="e.g. Rotors are above minimum thickness. Calipers aren't seized."
            />
          </label>
          <label className="block">
            <span className="field-label">Not included</span>
            <textarea
              value={v.exclusions}
              onChange={(e) => set("exclusions", e.target.value)}
              rows={3}
              className="input mt-1"
              placeholder="One per line, e.g. Rear brakes; Brake fluid flush"
            />
          </label>
        </div>

        {/* Alternate scopes */}
        <fieldset className="space-y-2">
          <legend className="heading text-[1.0625rem]">Not sure until you diagnose it?</legend>
          <p className="text-[0.8125rem] text-ink-3">
            Add up to two other outcomes with their own prices, so {customerFirst} knows the range before you arrive.
          </p>
          {v.alternates.map((a, i) => (
            <div key={i} className="grid gap-2 border border-rule-soft bg-paper/60 p-3 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_2.75rem]">
              <input
                aria-label="Alternate outcome"
                value={a.label}
                onChange={(e) => setAlt(i, { label: e.target.value })}
                className="input min-h-11"
                placeholder="If it's the starter solenoid, not the motor"
              />
              <input
                aria-label="Alternate labor ($)"
                inputMode="decimal"
                value={dollars(a.laborCents)}
                onChange={(e) => setAlt(i, { laborCents: cents(e.target.value) })}
                className={`${money} min-h-11`}
                placeholder="Labor $"
              />
              <input
                aria-label="Alternate parts ($)"
                inputMode="decimal"
                value={dollars(a.partsCents)}
                onChange={(e) => setAlt(i, { partsCents: cents(e.target.value) })}
                className={`${money} min-h-11`}
                placeholder="Parts $"
              />
              <button
                type="button"
                onClick={() =>
                  set(
                    "alternates",
                    v.alternates.filter((_, j) => j !== i),
                  )
                }
                className="grid size-11 place-items-center text-ink-3 hover:text-alert"
                aria-label="Remove this outcome"
              >
                <Trash2 size={16} aria-hidden />
              </button>
            </div>
          ))}
          {v.alternates.length < 2 && (
            <button
              type="button"
              onClick={() => set("alternates", [...v.alternates, { label: "", laborCents: 0, partsCents: 0 }])}
              className="btn btn-quiet min-h-11 text-sm"
            >
              <Plus size={15} aria-hidden /> Add another outcome
            </button>
          )}
        </fieldset>

        <label className="block">
          <span className="field-label">Note to {customerFirst}</span>
          <textarea
            value={v.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={3}
            className="input mt-1"
            placeholder="What you'd check first and why you're a good fit for this job."
          />
        </label>
      </div>

      {/* Customer-facing preview */}
      <aside className="space-y-3 xl:sticky xl:top-20 xl:self-start">
        <div className="sheet p-4" aria-live="polite">
          <p className="field-label">What {customerFirst} will see</p>
          <p className="num mt-2 text-[2rem]">{totals.planFor}</p>
          <p className="text-[0.8125rem] text-ink-2">estimated total</p>
          <dl className="mt-3 space-y-1 border-t border-rule-soft pt-2 text-[0.875rem]">
            {v.lines
              .filter((l) => l.label || l.cents)
              .map((l) => (
                <div key={l.id} className="flex justify-between gap-3">
                  <dt className="min-w-0 truncate">{l.label || (l.kind === "labor" ? "Labor" : "Part")}</dt>
                  <dd className="tnum">{usd(l.cents)}</dd>
                </div>
              ))}
            {v.diagnosticFeeCents ? (
              <div className="flex justify-between gap-3">
                <dt>Diagnostic</dt>
                <dd className="tnum">{usd(v.diagnosticFeeCents)}</dd>
              </div>
            ) : null}
            {v.serviceMode === "mobile" && v.travelFeeCents ? (
              <div className="flex justify-between gap-3">
                <dt>Travel</dt>
                <dd className="tnum">{usd(v.travelFeeCents)}</dd>
              </div>
            ) : null}
          </dl>
          <p className={`mt-3 border px-2 py-1.5 text-[0.8125rem] font-semibold ${v.partsIncluded ? "border-ink" : "border-amber bg-amber-wash text-amber"}`}>
            {totals.partsLine}
          </p>
          {inc.notIncluded.length ? (
            <p className="mt-2 text-[0.8125rem] text-ink-2">
              <span className="font-semibold text-ink">Not included:</span> {inc.notIncluded.slice(0, -1).join("; ") || "nothing listed"}
            </p>
          ) : null}
          {v.alternates.filter((a) => a.label).length ? (
            <ul className="mt-2 space-y-1 text-[0.8125rem]">
              {v.alternates
                .filter((a) => a.label)
                .map((a, i) => (
                  <li key={i}>
                    <span className="font-semibold">Or:</span> {a.label} ·{" "}
                    {usd(a.laborCents + a.partsCents + v.diagnosticFeeCents + (v.serviceMode === "mobile" ? v.travelFeeCents : 0))}
                  </li>
                ))}
            </ul>
          ) : null}
          <p className="mt-2 text-[0.75rem] text-ink-3">
            Valid until {v.expiresOn || "no date set"}. Final scope may change after diagnosis, with {customerFirst}&apos;s approval.
          </p>
        </div>

        {error ? (
          <p role="alert" className="border border-alert bg-alert-wash px-3 py-2 text-[0.875rem] text-alert">
            {error}
          </p>
        ) : null}
        {!canSend && blockedReason ? <p className="text-[0.8125rem] text-alert">{blockedReason}</p> : null}
        <button type="button" onClick={send} disabled={!canSend || sending} className="btn btn-ink min-h-12 w-full">
          {sending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null} Review and send
        </button>
        <p className="flex items-center gap-1.5 text-[0.8125rem] text-ink-3" role="status">
          {saving ? (
            <>
              <Loader2 size={13} className="animate-spin" aria-hidden /> Saving draft…
            </>
          ) : savedAt ? (
            <>
              <Check size={13} aria-hidden /> Draft saved {new Date(savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Only you can see
              it.
            </>
          ) : (
            "Drafts save automatically as you type. Only you can see them."
          )}
        </p>
      </aside>
    </div>
  );
}
