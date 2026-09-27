import type { AuditEntry } from "@/lib/domain/types";
import { usd } from "@/lib/format";

/** "total 45000" → "$450"; "+2500" → "+$25"; everything else as written. Details never hold private data. */
function detailText(d?: string) {
  if (!d) return "";
  return d
    .replace(/\b(total|final) (\d+)\b/g, (_, k: string, n: string) => `${k === "total" ? "total" : "final"} ${usd(Number(n))}`)
    .replace(/^([+])?(\d+)$/, (_, plus: string | undefined, n: string) => (plus ? `+${usd(Number(n))}` : n));
}

/**
 * What happened, when, and by whom (by role: "You", the other person's first name, Clutch
 * staff). The same record both sides and staff see, so a refresh always tells the same story.
 */
export function HistoryList({ entries, names, title = "History" }: { entries: AuditEntry[]; names: Partial<Record<AuditEntry["by"], string>>; title?: string }) {
  if (!entries.length) return null;
  const who = (by: AuditEntry["by"]) => names[by] ?? (by === "staff" ? "Clutch staff" : by === "system" ? "Clutch" : by === "customer" ? "Customer" : "Mechanic");
  return (
    <section aria-label={title}>
      <h2 className="field-label">{title}</h2>
      <ol className="mt-2 border-t border-rule">
        {[...entries].reverse().map((e, i) => (
          <li key={`${e.at}-${i}`} className="grid gap-x-4 border-b border-rule-soft py-2 text-[0.875rem] sm:grid-cols-[11rem_minmax(0,1fr)]">
            <time dateTime={e.at} className="tnum text-ink-3">
              {new Date(e.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" })}
            </time>
            <span>
              <span className="font-semibold">{who(e.by)}</span> {e.action}
              {e.detail ? <span className="text-ink-2"> · {detailText(e.detail)}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
