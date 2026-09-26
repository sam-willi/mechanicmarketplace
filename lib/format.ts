export function usd(cents: number, opts: { cents?: boolean } = {}) {
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Full timestamps are read as Los Angeles calendar dates; plain dates are used as-is. */
function calendarDate(iso: string) {
  return iso.length > 10 && iso.includes("T") ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }) : iso.slice(0, 10);
}

/** "Sep 2026". Plain dates are never shifted by timezone. */
export function monthYear(iso?: string, long = false) {
  if (!iso) return "";
  const [y, m] = calendarDate(iso).split("-").map(Number);
  return `${(long ? MONTHS_LONG : MONTHS)[m - 1]} ${y}`;
}

export function dayMonth(iso?: string) {
  if (!iso) return "";
  const [y, m, d] = calendarDate(iso).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function year(iso?: string) {
  return iso ? iso.slice(0, 4) : "";
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function rating(n: number) {
  return (Math.round(n * 10) / 10).toFixed(1);
}

/** Every Clutch mechanic is mobile (older records saying "shop" or "both" read the same). */
export const WORK_MODEL_LABEL: Record<string, string> = { mobile: "Mobile mechanic" };
