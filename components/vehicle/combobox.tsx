"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { SEARCH_CONTROL } from "@/components/find/search-cell";

/**
 * Searchable dropdown (ARIA combobox + listbox). Type to filter long lists;
 * arrow keys, Enter and Escape work as expected.
 */
export function Combobox({
  label,
  value,
  options,
  onChange,
  placeholder = "Choose",
  disabled,
  loading,
  allowCustom,
  required,
  bare,
}: {
  label: string;
  value: string;
  options: { id: string; label: string; hint?: string }[];
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  /** Offer "Use “…”" when the typed text isn't in the list. */
  allowCustom?: string;
  required?: boolean;
  /** No box of its own: sits in a ruled cell that is the field (search form). */
  bare?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.id === value);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? options.filter((o) => o.label.toLowerCase().includes(t)) : options;
    return allowCustom && t && !options.some((o) => o.label.toLowerCase() === t) ? [...list, { id: `custom:${q.trim()}`, label: `${allowCustom} “${q.trim()}”` }] : list;
  }, [q, options, allowCustom]);

  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function pick(o: { id: string }) {
    onChange(o.id);
    setOpen(false);
    setQ("");
  }

  return (
    <div ref={box} className={bare ? "" : "relative"}>
      <label htmlFor={id} className="field-label">
        {label}
        {required ? <span className="ml-1.5 text-ink">(required)</span> : null}
      </label>
      <div className={bare ? "relative" : "relative mt-1"}>
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && filtered[active] ? `${id}-o${active}` : undefined}
          disabled={disabled}
          value={open ? q : (selected?.label ?? (value.startsWith("custom:") ? value.slice(7) : value))}
          placeholder={loading ? "Loading…" : open && selected?.label ? selected.label : placeholder}
          onFocus={() => {
            setQ("");
            setOpen(true);
            // Start at the current pick, scrolled into view.
            const at = Math.max(0, options.findIndex((o) => o.id === value));
            setActive(at);
            requestAnimationFrame(() => {
              const list = document.getElementById(`${id}-list`);
              const row = document.getElementById(`${id}-o${at}`);
              if (list && row) list.scrollTop = row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2;
            });
          }}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && open && filtered[active]) {
              e.preventDefault();
              pick(filtered[active]);
            } else if (e.key === "Escape") setOpen(false);
          }}
          className={bare ? `${SEARCH_CONTROL} placeholder:font-semibold placeholder:text-ink disabled:placeholder:font-medium disabled:placeholder:text-ink-3` : "input pr-9 disabled:opacity-50"}
          autoComplete="off"
        />
        <ChevronDown size={16} className={`pointer-events-none absolute top-1/2 -translate-y-1/2 ${bare ? `right-0 transition-transform ${open ? "rotate-180" : ""} ${disabled ? "text-rule" : "text-ink-2"}` : "right-3 text-ink-3"}`} aria-hidden />
      </div>
      {open && !disabled ? (
        <ul id={`${id}-list`} role="listbox" aria-label={label} className={`absolute z-40 max-h-72 overflow-auto border border-rule bg-sheet py-1 shadow-[0_18px_40px_-18px_rgba(15,28,48,0.45)] ${bare ? "inset-x-0 top-full -mt-px" : "mt-1 w-full"}`}>
          {filtered.length ? (
            filtered.map((o, i) => (
              <li
                key={o.id}
                id={`${id}-o${i}`}
                role="option"
                aria-selected={o.id === value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3.5 text-[0.9375rem] ${o.id === value ? "font-semibold text-brand-deep" : ""} ${i === active ? "bg-brand-wash" : ""}`}
              >
                <span>
                  {o.label}
                  {o.hint ? <span className="block text-[0.75rem] text-ink-3">{o.hint}</span> : null}
                </span>
                {o.id === value ? <Check size={15} className="text-brand" aria-hidden /> : null}
              </li>
            ))
          ) : (
            <li className="px-3 py-2.5 text-[0.875rem] text-ink-3">{loading ? "Loading…" : "No matches"}</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}
