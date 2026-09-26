import { today } from "@/lib/verification/lifecycle";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function daysUntil(on: string, from = today()) {
  return Math.round((new Date(`${on}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86_400_000);
}

/** "Available today · 4:30 PM", "Tomorrow · 9:00 AM", "Sat, Sep 27 · 10:00 AM". */
export function openingLabel(o: { on: string; time: string }, opts: { prefix?: boolean } = {}) {
  const d = daysUntil(o.on);
  const date = new Date(`${o.on}T12:00:00Z`);
  const day = d <= 0 ? "Today" : d === 1 ? "Tomorrow" : `${DAYS[date.getUTCDay()]}, ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
  const label = o.time ? `${day} · ${o.time}` : day;
  return opts.prefix && d <= 0 ? `Available today${o.time ? ` · ${o.time}` : ""}` : label;
}

export function soonest(openings: { on: string; time: string }[]) {
  return [...openings].filter((o) => daysUntil(o.on) >= 0).sort((a, b) => (a.on + toMinutes(a.time) < b.on + toMinutes(b.time) ? -1 : 1))[0];
}

function toMinutes(t: string) {
  const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return "9999";
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === "PM") h += 12;
  return String(h * 60 + Number(m[2])).padStart(4, "0");
}

export function daysAgo(n: number, from = today()) {
  return new Date(new Date(`${from}T12:00:00Z`).getTime() - n * 86_400_000).toISOString().slice(0, 10);
}
