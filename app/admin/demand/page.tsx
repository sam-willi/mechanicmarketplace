import type { Metadata } from "next";
import Link from "next/link";
import { getRepo } from "@/lib/data";
import { getSession, isStaff, needs } from "@/lib/session";
import { DEMAND_LIMIT, DEMAND_STATUS_LABEL, unmatchedDemand, type DemandStatus } from "@/lib/demand";
import { plural } from "@/lib/format";
import { SiteHeader } from "@/components/site/site-header";
import { NeedsPersona, PageTitle } from "@/components/workspace/ui";

export const metadata: Metadata = { title: "Unmatched demand" };

/** Where customers are waiting and nobody can take the job: what to recruit for. */
export default async function AdminDemand({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const repo = await getRepo();
  const s = await getSession();
  if (!isStaff(s))
    return (
      <>
        <SiteHeader />
        <NeedsPersona role="admin" />
      </>
    );
  const sp = await searchParams;
  await (await needs(s)).demand(DEMAND_LIMIT);
  const d = await unmatchedDemand(repo);
  const status = (Object.keys(DEMAND_STATUS_LABEL) as DemandStatus[]).find((k) => k === sp.status);
  const rows = d.rows.filter((r) => !status || r.status === status);
  const oldest = d.rows[0]?.ageDays;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1200px] space-y-8 px-4 pt-8 pb-24 sm:px-6">
        <PageTitle
          title="Unmatched demand"
          note={`Requests in the ${repo.scope === "demo" ? "demo (fictional)" : "real"} marketplace that no mechanic has picked up. Customer names, contact details and addresses are never shown here.`}
        />
        <nav aria-label="Admin" className="flex flex-wrap gap-4 text-[0.9375rem]">
          <Link href="/admin" className="link">
            Verification review
          </Link>
          <Link href="/admin/support" className="link">
            Support reports
          </Link>
          <span className="font-semibold" aria-current="page">
            Unmatched demand
          </span>
          <Link href="/admin/delivery" className="link">
            Alert delivery
          </Link>
        </nav>

        <dl className="grid grid-cols-2 gap-px border border-rule bg-rule-soft sm:grid-cols-4">
          {(
            [
              [String(d.rows.length), "unmatched requests"],
              [String(d.rows.filter((r) => r.status === "waiting").length), "with no mechanic who fits"],
              [oldest === undefined ? "–" : oldest === 0 ? "Today" : `${oldest} days`, "age of the oldest request"],
              [String(d.supply.bookable), `bookable mechanics (${d.supply.profiles} profiles)`],
            ] as const
          ).map(([v, k]) => (
            <div key={k} className="bg-sheet px-4 py-3">
              <dd className="num text-[1.75rem]">{v}</dd>
              <dt className="text-[0.8125rem] text-ink-2">{k}</dt>
            </div>
          ))}
        </dl>

        {d.truncated ? (
          <p role="status" className="border border-amber bg-amber-wash px-4 py-3 text-[0.9375rem]">
            More than {DEMAND_LIMIT} requests are open. These figures cover the {DEMAND_LIMIT} oldest.
          </p>
        ) : null}
        {d.rows.length === 0 ? (
          <p className="border-y border-rule py-6 text-ink-2">
            No unmatched requests. {d.supply.bookable === 0 ? "No customer has saved a request yet, and no mechanic is bookable yet." : "Every open request has a mechanic working on it."}
          </p>
        ) : (
          <>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              <Breakdown title="Recruit for (repair · area)" items={d.byAreaAndRepair} />
              <Breakdown title="By area" items={d.byArea} />
              <Breakdown title="By repair" items={d.byCategory} />
              <Breakdown title="By make" items={d.byMake} />
            </div>

            <section aria-labelledby="rows-title" className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 id="rows-title" className="heading text-[1.25rem]">
                  {plural(rows.length, "request")}
                  {status ? ` · ${DEMAND_STATUS_LABEL[status]}` : ""}
                </h2>
                <div className="flex flex-wrap gap-2 text-[0.8125rem]">
                  <Link href="/admin/demand" className={`min-h-9 content-center border px-2.5 ${!status ? "border-brand bg-brand text-on-brand" : "border-rule bg-sheet"}`}>
                    All
                  </Link>
                  {(Object.keys(DEMAND_STATUS_LABEL) as DemandStatus[]).map((k) => (
                    <Link
                      key={k}
                      href={`/admin/demand?status=${k}`}
                      className={`min-h-9 content-center border px-2.5 ${status === k ? "border-brand bg-brand text-on-brand" : "border-rule bg-sheet"}`}
                    >
                      {DEMAND_STATUS_LABEL[k]}
                    </Link>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-left text-[0.9375rem]">
                  <thead>
                    <tr className="border-b-2 border-ink text-[0.8125rem] text-ink-2">
                      {["Repair", "Vehicle", "Area", "Waiting", "Status"].map((h) => (
                        <th key={h} scope="col" className="py-2 pr-4 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-rule-soft">
                        <td className="py-2.5 pr-4 font-semibold">{r.categoryLabel}</td>
                        <td className="py-2.5 pr-4">{r.vehicle}</td>
                        <td className="py-2.5 pr-4">{r.area}</td>
                        <td className="tnum py-2.5 pr-4">{r.ageDays === 0 ? "Today" : plural(r.ageDays, "day")}</td>
                        <td className="py-2.5 text-[0.875rem]">{DEMAND_STATUS_LABEL[r.status]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </>
  );
}

function Breakdown({ title, items }: { title: string; items: { label: string; n: number }[] }) {
  return (
    <section className="min-w-0">
      <h2 className="field-label">{title}</h2>
      <ul className="mt-2 border-t border-rule">
        {items.slice(0, 6).map((i) => (
          <li key={i.label} className="flex items-baseline justify-between gap-3 border-b border-rule-soft py-1.5 text-[0.9375rem]">
            <span className="min-w-0 truncate">{i.label}</span>
            <span className="tnum font-semibold">{i.n}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
