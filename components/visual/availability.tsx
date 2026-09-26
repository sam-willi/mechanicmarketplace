import { CalendarClock } from "lucide-react";
import { daysUntil, openingLabel, soonest } from "@/lib/domain/availability";

/**
 * When can this mechanic come? Shown near the top of every card and profile.
 * Today/tomorrow get ink weight; later dates stay quiet. No fake urgency.
 */
export function AvailabilityPill({
  openings,
  fallback,
  size = "md",
}: {
  openings: { on: string; time: string }[];
  fallback?: string;
  size?: "sm" | "md";
}) {
  const o = soonest(openings);
  const soon = o ? daysUntil(o.on) <= 1 : false;
  const text = o ? openingLabel(o, { prefix: true }) : (fallback ?? "Ask for availability");
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2 py-1 font-semibold ${size === "sm" ? "text-[0.75rem]" : "text-[0.8125rem]"} ${
        soon ? "border-brand bg-brand text-sheet" : "border-rule bg-sheet text-ink"
      }`}
    >
      <CalendarClock size={size === "sm" ? 13 : 14} aria-hidden />
      {text}
    </span>
  );
}

/** A short list of the next openings, for profiles and estimate requests. */
export function OpeningsList({ openings }: { openings: { on: string; time: string }[] }) {
  const list = [...openings].filter((o) => daysUntil(o.on) >= 0).slice(0, 4);
  if (!list.length) return <p className="text-[0.875rem] text-ink-3">No openings posted. Ask when you request an estimate.</p>;
  return (
    <ul className="flex flex-wrap gap-2">
      {list.map((o) => (
        <li key={o.on + o.time} className="border border-rule bg-sheet px-2.5 py-1.5 text-[0.8125rem] font-semibold">
          {openingLabel(o)}
        </li>
      ))}
    </ul>
  );
}
