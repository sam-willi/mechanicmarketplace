import type { Metadata } from "next";
import { ready, repo } from "@/lib/data";
import { getSession } from "@/lib/session";
import { monthYear, plural, usd } from "@/lib/format";
import { saveCustomerNote } from "@/app/actions/mechanic";
import { PageTitle } from "@/components/workspace/ui";
import { CopyLink } from "@/components/app/copy-link";
import { StatusChip } from "@/components/app/status-chip";

export const metadata: Metadata = { title: "Customers" };

function monthsSince(iso: string) {
  const d = new Date(iso);
  const n = new Date();
  return (n.getFullYear() - d.getFullYear()) * 12 + n.getMonth() - d.getMonth();
}

export default async function Customers() {
  await ready();
  const s = await getSession();
  if (s.role !== "mechanic") return null;
  const rows = repo.listMechanicCustomers(s.mechanicId);
  const jobs = repo.listJobsForMechanic(s.mechanicId);
  const repeat = rows.filter((r) => r.isRepeat).length;
  const totalValue = rows.reduce((sum, r) => sum + r.jobs.reduce((a, j) => a + (j.valueCents ?? 0), 0), 0);

  return (
    <div className="space-y-8">
      <PageTitle
        title="Customers"
        note="Rebook your customers directly and keep your own notes."
      />
      <dl className="grid grid-cols-3 border-y border-rule">
        {[
          ["Customers", rows.length],
          ["Repeat customers", repeat],
          ["Relationship value", usd(totalValue)],
        ].map(([k, v]) => (
          <div key={k} className="border-r border-rule-soft py-3 pr-3 last:border-r-0 [&:not(:first-child)]:pl-3">
            <dt className="field-label">{k}</dt>
            <dd className="num mt-1.5 text-[1.75rem]">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[0.8125rem] text-ink-3">Relationship value is the total of job values on Clutch (estimates, not payouts).</p>

      <ul className="border-t border-ink">
        {rows.map(({ customer, jobs: history, isRepeat }) => {
          const last = history[0];
          const cars = [...new Set(history.map((h) => `${h.year} ${h.make} ${h.model}`))];
          const value = history.reduce((a, j) => a + (j.valueCents ?? 0), 0);
          const upcoming = jobs.find((j) => j.customerId === customer.id && (j.status === "scheduled" || j.status === "in_progress"));
          const due = !upcoming && monthsSince(last.performedOn) >= 6;
          const note = repo.getCustomerNote(s.mechanicId, customer.id);
          return (
            <li key={customer.id} className="border-b border-rule-soft">
              <details className="group">
                <summary className="grid cursor-pointer list-none gap-2 py-4 hover:bg-sheet sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-6 sm:px-2 [&::-webkit-details-marker]:hidden">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {customer.displayName} {isRepeat ? <span className="ml-1.5 border border-ink px-1.5 text-[0.6875rem] font-bold uppercase">Repeat</span> : null}
                    </p>
                    <p className="truncate text-[0.875rem] text-ink-2">{cars.join(", ")}</p>
                  </div>
                  <div className="text-[0.875rem]">
                    <p>
                      <span className="text-ink-3">Last service:</span> {last.title}
                    </p>
                    <p className="tnum text-ink-3">
                      {monthYear(last.performedOn)} · {plural(history.length, "job")} · {usd(value)}
                    </p>
                  </div>
                  <div>{upcoming ? <StatusChip label="Booked" /> : due ? <StatusChip label="Due for service" /> : <StatusChip label="Recent" />}</div>
                </summary>
                <div className="grid gap-6 pb-5 sm:grid-cols-2 sm:px-2">
                  <div>
                    <p className="field-label">History</p>
                    <ul className="mt-1 text-[0.9375rem]">
                      {history.map((h) => (
                        <li key={h.id} className="flex justify-between gap-3 border-b border-rule-soft py-1.5">
                          <span>
                            {h.title} <span className="text-ink-3">· {h.year} {h.make} {h.model}</span>
                          </span>
                          <span className="tnum shrink-0 text-ink-3">{monthYear(h.performedOn)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <CopyLink path={`/customer/requests/new?rebook=${s.slug}`} label="Copy rebooking link" />
                    </div>
                  </div>
                  <form action={saveCustomerNote.bind(null, customer.id)} className="space-y-2">
                    <label className="block">
                      <span className="field-label">Your notes (private)</span>
                      <textarea name="note" rows={4} defaultValue={note} className="input mt-1" placeholder="Preferences, parking, what's coming due." />
                    </label>
                    <button className="btn btn-quiet min-h-11 px-3 text-sm">Save note</button>
                  </form>
                </div>
              </details>
            </li>
          );
        })}
        {rows.length === 0 && <li className="py-6 text-ink-3">Customers you complete jobs for on Clutch appear here.</li>}
      </ul>
    </div>
  );
}
