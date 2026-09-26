import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, CircleHelp } from "lucide-react";
import type { Job } from "@/lib/domain/types";
import { addDays, addMonthsTo, startOfMonth, startOfWeek, timeLabel, weekday, type Slot } from "@/lib/domain/schedule";

export type CalendarItem = {
  id: string;
  href: string;
  slot: Slot;
  title: string;
  sub: string;
  status: CalendarStatus;
};

export type CalendarStatus = "unconfirmed" | "confirmed" | "in_progress" | "awaiting_customer" | "completed";

/** A booked job waits on the mechanic's confirmation before it's really on the calendar. */
export function calendarStatus(j: Pick<Job, "status" | "confirmedAt">): CalendarStatus | null {
  if (j.status === "cancelled") return null;
  if (j.status === "scheduled") return j.confirmedAt ? "confirmed" : "unconfirmed";
  return j.status;
}

const TONE: Record<CalendarStatus, { box: string; label: string }> = {
  unconfirmed: { box: "border-l-amber border-y border-r border-dashed border-y-amber/50 border-r-amber/50 bg-amber-wash", label: "Needs your confirmation" },
  confirmed: { box: "border-l-go bg-go-wash", label: "Confirmed" },
  in_progress: { box: "border-l-brand bg-brand-wash", label: "In progress" },
  awaiting_customer: { box: "border-l-brass bg-brass-wash", label: "Awaiting customer" },
  completed: { box: "border-l-rule bg-paper text-ink-2", label: "Done" },
};

const dayName = (d: string, style: "short" | "long" = "short") => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: style, timeZone: "UTC" });
const dayNum = (d: string) => Number(d.slice(8, 10));
const monthTitle = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * The mechanic's jobs on a calendar: a week (day columns on desktop, a day
 * list on phones) or a month grid. Posted openings show as dashed "Open" slots.
 */
export function JobCalendar({
  items,
  openings,
  view,
  anchor,
  today,
  basePath,
  hash = "",
}: {
  items: CalendarItem[];
  openings: Slot[];
  view: "week" | "month";
  anchor: string;
  today: string;
  basePath: string;
  /** Keep the page scrolled to the calendar when stepping weeks (e.g. "#calendar"). */
  hash?: string;
}) {
  const byDay = (d: string) => items.filter((i) => i.slot.date === d).sort((a, b) => a.slot.time.localeCompare(b.slot.time));
  const openOn = (d: string) => openings.filter((o) => o.date === d && !items.some((i) => i.slot.date === d && i.slot.time === o.time) && d >= today);
  const href = (v: "week" | "month", d: string) => `${basePath}?view=${v}&d=${d}${hash}`;

  // The week view is the next seven days from the anchor (today by default): upcoming work first.
  const start = view === "week" ? anchor : startOfMonth(anchor);
  const prev = view === "week" ? addDays(start, -7) : addMonthsTo(start, -1);
  const next = view === "week" ? addDays(start, 7) : addMonthsTo(start, 1);
  const days = view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(start, i)) : [];
  const title = view === "week" ? `${shortDate(days[0])} – ${shortDate(days[6])}` : monthTitle(start);

  return (
    <section aria-labelledby="cal-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href={href(view, prev)}
            className="grid size-11 place-items-center border border-rule bg-sheet hover:border-ink-3"
            aria-label={view === "week" ? "Previous week" : "Previous month"}
          >
            <ChevronLeft size={18} aria-hidden />
          </Link>
          <Link
            href={href(view, next)}
            className="grid size-11 place-items-center border border-rule bg-sheet hover:border-ink-3"
            aria-label={view === "week" ? "Next week" : "Next month"}
          >
            <ChevronRight size={18} aria-hidden />
          </Link>
          <h2 id="cal-title" className="heading ml-1 text-[1.25rem]">
            {title}
          </h2>
          <Link href={href(view, today)} className="ml-1 text-[0.875rem] font-semibold underline decoration-rule underline-offset-2">
            Today
          </Link>
        </div>
        <div className="inline-flex border border-rule" role="group" aria-label="Calendar view">
          {(["week", "month"] as const).map((v) => (
            <Link
              key={v}
              href={href(v, anchor)}
              aria-current={view === v ? "true" : undefined}
              className={`min-h-11 px-4 content-center text-[0.875rem] font-semibold capitalize ${view === v ? "bg-brand text-on-brand" : "bg-sheet text-ink-2 hover:text-ink"}`}
            >
              {v}
            </Link>
          ))}
        </div>
      </div>

      {view === "week" ? (
        <>
          {/* Desktop: seven columns */}
          <ol className="hidden grid-cols-7 gap-px border border-rule bg-rule-soft md:grid">
            {days.map((d) => {
              const list = byDay(d);
              const open = openOn(d);
              const isToday = d === today;
              return (
                <li key={d} className={`min-h-44 min-w-0 p-2 ${isToday ? "bg-brand-wash/40" : "bg-sheet"} ${d < today ? "opacity-70" : ""}`}>
                  <p className={`mb-2 flex items-baseline gap-1.5 text-[0.8125rem] ${isToday ? "font-bold text-brand" : "text-ink-2"}`}>
                    {dayName(d)} <span className={`tnum text-[1.125rem] ${isToday ? "" : "font-semibold text-ink"}`}>{dayNum(d)}</span>
                    {isToday ? <span className="sr-only">(today)</span> : null}
                  </p>
                  <ul className="space-y-1.5">
                    {list.map((i) => (
                      <li key={i.id}>
                        <Event item={i} />
                      </li>
                    ))}
                    {open.map((o) => (
                      <li key={o.time} className="border border-dashed border-rule px-1.5 py-1 text-[0.75rem] text-ink-3">
                        Open · {timeLabel(o.time)}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
          {/* Phone: a day list */}
          <ol className="space-y-3 md:hidden">
            {days.map((d) => {
              const list = byDay(d);
              const open = openOn(d);
              if (!list.length && !open.length && d !== today) return null;
              return (
                <li key={d}>
                  <p className={`text-[0.875rem] font-bold ${d === today ? "text-brand" : ""}`}>
                    {dayName(d, "long")}, {shortDate(d)}
                    {d === today ? " · Today" : ""}
                  </p>
                  <ul className="mt-1.5 space-y-1.5">
                    {list.map((i) => (
                      <li key={i.id}>
                        <Event item={i} />
                      </li>
                    ))}
                    {open.map((o) => (
                      <li key={o.time} className="border border-dashed border-rule px-2 py-1.5 text-[0.8125rem] text-ink-3">
                        Open · {timeLabel(o.time)}
                      </li>
                    ))}
                    {!list.length && !open.length ? <li className="text-[0.8125rem] text-ink-3">Nothing booked</li> : null}
                  </ul>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <MonthGrid start={start} today={today} byDay={byDay} openOn={openOn} weekHref={(d) => href("week", d)} />
      )}

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[0.75rem] text-ink-2" aria-label="Legend">
        {(["unconfirmed", "confirmed", "in_progress", "awaiting_customer"] as const).map((k) => (
          <li key={k} className="inline-flex items-center gap-1.5">
            <span className={`inline-block h-3 w-3 border-l-4 ${TONE[k].box}`} aria-hidden /> {TONE[k].label}
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-4 border border-dashed border-rule" aria-hidden /> Open slot
        </li>
      </ul>
    </section>
  );
}

function Event({ item }: { item: CalendarItem }) {
  const t = TONE[item.status];
  return (
    <Link href={item.href} className={`block border-l-4 px-2 py-1.5 hover:brightness-95 ${t.box}`}>
      <span className="tnum flex items-center gap-1 text-[0.75rem] font-bold">
        {timeLabel(item.slot.time)}
        {item.status === "confirmed" ? <Check size={14} strokeWidth={3} className="text-go" aria-hidden /> : null}
        <span className="sr-only"> · {t.label}</span>
      </span>
      <span className="block truncate text-[0.8125rem] font-semibold">{item.title}</span>
      <span className="block truncate text-[0.75rem] text-ink-2">{item.sub}</span>
      {item.status === "unconfirmed" ? (
        <span className="mt-0.5 flex items-center gap-1 text-[0.75rem] font-bold text-amber" aria-hidden>
          <CircleHelp size={12} /> Confirm?
        </span>
      ) : null}
    </Link>
  );
}

function MonthGrid({
  start,
  today,
  byDay,
  openOn,
  weekHref,
}: {
  start: string;
  today: string;
  byDay: (d: string) => CalendarItem[];
  openOn: (d: string) => Slot[];
  weekHref: (d: string) => string;
}) {
  const first = startOfWeek(start);
  const month = start.slice(0, 7);
  const weeks = Math.ceil(((weekday(start) + 6) % 7) + new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()) / 7;
  const cells = Array.from({ length: Math.ceil(weeks) * 7 }, (_, i) => addDays(first, i));
  return (
    <div>
      <div className="grid grid-cols-7 text-center text-[0.75rem] font-semibold text-ink-3" aria-hidden>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d} className="py-1">
            {d}
          </span>
        ))}
      </div>
      <ol className="grid grid-cols-7 gap-px border border-rule bg-rule-soft">
        {cells.map((d) => {
          const list = byDay(d);
          const open = openOn(d);
          const inMonth = d.startsWith(month);
          const isToday = d === today;
          return (
            <li key={d} className={`min-h-16 min-w-0 p-1 sm:min-h-24 sm:p-1.5 ${isToday ? "bg-brand-wash/40" : inMonth ? "bg-sheet" : "bg-paper"}`}>
              <Link
                href={weekHref(d)}
                className={`tnum inline-grid size-7 place-items-center text-[0.8125rem] ${isToday ? "bg-brand font-bold text-on-brand" : inMonth ? "font-semibold" : "text-ink-3"}`}
                aria-label={`${d}${list.length ? `, ${list.length} job${list.length > 1 ? "s" : ""}` : ""}`}
              >
                {dayNum(d)}
              </Link>
              {/* Phones: a count; larger screens: the jobs themselves */}
              {list.length ? <span className="ml-1 inline-block bg-brand px-1 text-[0.6875rem] font-bold text-on-brand sm:hidden">{list.length}</span> : null}
              <ul className="mt-1 hidden space-y-1 sm:block">
                {list.slice(0, 2).map((i) => (
                  <li key={i.id}>
                    <Link href={i.href} className={`block truncate border-l-4 px-1 text-[0.6875rem] font-semibold ${TONE[i.status].box}`}>
                      {timeLabel(i.slot.time).replace(":00", "")} {i.title}
                    </Link>
                  </li>
                ))}
                {list.length > 2 ? <li className="text-[0.6875rem] text-ink-2">+{list.length - 2} more</li> : null}
                {!list.length && open.length ? (
                  <li className="truncate text-[0.6875rem] text-ink-3">Open {timeLabel(open[0].time).replace(":00", "")}</li>
                ) : null}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
