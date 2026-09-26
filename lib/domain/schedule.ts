import type { ISODate, Job, Quote, Slot } from "./types";

export type { Slot };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** "9am", "9:30 AM", "13:00" → "09:00" / "09:30" / "13:00". */
export function parseTime(text: string): string | null {
  const m = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

/**
 * Read a free-text time like "Tue, Sep 30 · 10am" or "Mon, Sep 29 · drop-off 8am".
 * The year is the one that puts the date nearest to `ref` (so late-December
 * estimates for early January land in the right year).
 */
export function parseSlotText(text: string | undefined, ref: ISODate): Slot | null {
  if (!text) return null;
  const m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  const day = Number(m[2]);
  const refYear = Number(ref.slice(0, 4));
  const refTime = new Date(`${ref.slice(0, 10)}T12:00:00Z`).getTime();
  const year = [refYear - 1, refYear, refYear + 1].sort(
    (a, b) => Math.abs(Date.UTC(a, month, day) - refTime) - Math.abs(Date.UTC(b, month, day) - refTime),
  )[0];
  const after = text.slice((m.index ?? 0) + m[0].length);
  return { date: `${year}-${pad(month + 1)}-${pad(day)}`, time: parseTime(after) ?? "09:00" };
}

/** Where a job sits on the calendar: its booked slot, else the estimate's, else read from the text. */
export function jobSlot(job: Job, quote: Quote | undefined, ref: ISODate): Slot | null {
  return job.appointment ?? quote?.availableAt ?? parseSlotText(job.scheduledFor, ref) ?? parseSlotText(quote?.availableOn, ref);
}

export function timeLabel(time: string) {
  const [h, m] = time.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${pad(m)} ${ap}`;
}

/** "Tue, Sep 30 · 10:00 AM" — the label customers and mechanics already see. */
export function slotLabel(s: Slot) {
  const d = new Date(`${s.date}T12:00:00Z`);
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return `${day} · ${timeLabel(s.time)}`;
}

/** Calendar arithmetic on plain dates (no time zones involved). */
export function addDays(date: ISODate, n: number): ISODate {
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function weekday(date: ISODate) {
  return new Date(`${date.slice(0, 10)}T12:00:00Z`).getUTCDay(); // 0 = Sunday
}
/** Monday of the week containing `date`. */
export function startOfWeek(date: ISODate): ISODate {
  return addDays(date, -((weekday(date) + 6) % 7));
}
export function startOfMonth(date: ISODate): ISODate {
  return `${date.slice(0, 7)}-01`;
}
export function addMonthsTo(date: ISODate, n: number): ISODate {
  const d = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
