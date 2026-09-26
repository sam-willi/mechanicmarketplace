import type { Metadata } from "next";
import { getSession } from "@/lib/session";
import { earnings } from "@/lib/mechanic-insights";
import { usd } from "@/lib/format";
import { PageTitle } from "@/components/workspace/ui";

export const metadata: Metadata = { title: "Earnings" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function Earnings() {
  const s = await getSession();
  if (s.role !== "mechanic") return null;
  const e = earnings(s.mechanicId);
  const max = Math.max(...e.byMonth.map((m) => m.cents), 1);

  return (
    <div className="space-y-8">
      <PageTitle title="Earnings" note="Estimated from job values. Clutch doesn't process payments." />
      <dl className="grid grid-cols-2 border border-rule bg-sheet sm:grid-cols-4">
        {(
          [
            ["Estimated earnings", usd(e.total), `${e.jobs} completed Clutch jobs`],
            ["This month", usd(e.thisMonth), "estimated"],
            ["Average job value", usd(e.average), "labor + fees"],
            ["Booked, not yet done", usd(e.upcoming), "upcoming and in progress"],
          ] as const
        ).map(([k, v, note]) => (
          <div key={k} className="border-r border-b border-rule-soft p-4 sm:border-b-0 sm:last:border-r-0">
            <dt className="field-label">{k}</dt>
            <dd className="num mt-2 text-[1.875rem]">{v}</dd>
            <p className="mt-1 text-[0.75rem] text-ink-3">{note}</p>
          </div>
        ))}
      </dl>

      <section className="space-y-3">
        <h2 className="heading text-[1.25rem]">By month</h2>
        <div className="sheet p-4 sm:p-6">
          <div className="grid h-56 grid-cols-6 items-end gap-3" role="img" aria-label="Estimated earnings by month for the last six months">
            {e.byMonth.map((m) => (
              <div key={m.month} className="flex h-full flex-col justify-end gap-1.5">
                <span className="tnum text-center text-[0.75rem] font-semibold">{m.cents ? usd(m.cents) : "—"}</span>
                <div className="bg-brand" style={{ height: `${Math.max(2, (m.cents / max) * 100)}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-6 gap-3 border-t border-rule pt-2">
            {e.byMonth.map((m) => (
              <div key={m.month} className="text-center text-[0.75rem] text-ink-2">
                {MONTHS[Number(m.month.slice(5)) - 1]}
                <span className="block text-ink-3">{m.jobs} jobs</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="sheet p-5">
          <p className="field-label">From repeat customers</p>
          <p className="num mt-2 text-[2rem]">{usd(e.repeat)}</p>
          <p className="mt-1 text-[0.875rem] text-ink-2">{e.repeatShare}% of your Clutch job value comes from customers who came back.</p>
        </div>
        <div className="sheet p-5">
          <p className="field-label">Your prices</p>
          <p className="mt-2 text-[0.9375rem] text-ink-2">You set your own rates. Clutch never ranks you by price or shows you anyone else&apos;s estimates.</p>
        </div>
      </section>
    </div>
  );
}
