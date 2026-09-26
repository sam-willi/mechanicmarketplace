import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ready, repo } from "@/lib/data";
import { getSession } from "@/lib/session";
import { vehicleLine } from "@/lib/domain/intake";
import { monthYear, usd } from "@/lib/format";
import { setVehiclePhoto, updateVehicle } from "@/app/actions/customer";
import { REPAIR_LABEL } from "@/lib/domain/provenance";
import { PhotoPrint } from "@/components/profile/photo";
import { RepairIcon } from "@/components/visual/icons";
import { VehicleGlyph, VehicleTile } from "@/components/visual/vehicle-glyph";
import { VehiclePhotoButton } from "@/components/app/vehicle-photo";
import { SpecPreview } from "@/components/vehicle/vehicle-selector";
import { customerSummary } from "@/lib/vehicles/spec";
import { VehicleFields } from "@/components/app/vehicle-form";

export const metadata: Metadata = { title: "Vehicle" };

export default async function VehiclePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; edit?: string }> }) {
  await ready();
  const s = await getSession();
  if (s.role !== "customer") return null;
  const { id } = await params;
  const sp = await searchParams;
  const v = repo.getVehicle(id);
  if (!v || v.customerId !== s.customerId) notFound();
  const history = repo.listVehicleHistory(v.id);
  const mechanics = [...new Set(history.map((h) => h.mechanicId))];
  const spent = history.reduce((n, h) => n + (h.valueCents ?? 0), 0);
  const open = repo.listRequestsForCustomer(s.customerId).filter((r) => r.vehicleId === v.id && (r.status === "open" || r.status === "quoted" || r.status === "booked"));

  return (
    <div className="mx-auto max-w-[820px] space-y-8">
      <Link href="/customer/vehicles" className="inline-flex items-center gap-1.5 text-[0.875rem] text-ink-3 hover:text-ink">
        <ArrowLeft size={14} aria-hidden /> My Vehicles
      </Link>
      <header className="grid gap-5 border-b-2 border-ink pb-6 sm:grid-cols-[16rem_minmax(0,1fr)] sm:items-end">
        <div>
          <VehicleTile v={v} size="lg" />
          <VehiclePhotoButton setPhoto={setVehiclePhoto.bind(null, v.id)} hasPhoto={Boolean(v.photoUrl)} />
        </div>
        <div className="min-w-0">
          <h1 className="display text-[2rem] sm:text-[2.5rem]">{vehicleLine(v)}</h1>
          <p className="tnum mt-1 text-ink-2">{customerSummary(v, v.spec)}</p>
          {v.spec ? (
            <div className="mt-3">
              <SpecPreview year={v.year} make={v.make} model={v.model} spec={v.spec} />
            </div>
          ) : (
            <p className="mt-2 text-[0.875rem] text-ink-2">
              Engine and transmission not confirmed yet.{" "}
              <a href="?edit=1#edit" className="font-semibold underline decoration-rule underline-offset-2">
                Add the exact configuration
              </a>
            </p>
          )}
          <dl className="mt-4 grid grid-cols-3 border-y border-rule">
            {(
              [
                [String(history.length), history.length === 1 ? "repair on record" : "repairs on record"],
                [String(mechanics.length), mechanics.length === 1 ? "mechanic" : "mechanics"],
                [spent ? usd(spent) : "—", "recorded cost"],
              ] as const
            ).map(([n, label], i) => (
              <div key={label} className={`py-2.5 ${i ? "border-l border-rule-soft pl-3" : "pr-3"}`}>
                <dt className="sr-only">{label}</dt>
                <dd className="num text-[1.625rem]">{n}</dd>
                <p className="text-[0.75rem] text-ink-2">{label}</p>
              </div>
            ))}
          </dl>
        </div>
      </header>
      {sp.saved ? <p className="border border-ink bg-sheet px-4 py-3 text-[0.9375rem]">Saved.</p> : null}

      <div className="flex flex-wrap gap-2">
        <Link href={`/customer/requests/new?make=${encodeURIComponent(v.make)}`} className="btn btn-ink">
          Request a repair for this car
        </Link>
        <Link href={`/customer/mechanics?vehicle=${v.id}`} className="btn btn-quiet">
          Find mechanics who know this car
        </Link>
      </div>

      <section>
        <h2 className="heading text-[1.375rem]">Service history</h2>
        <p className="mt-1 text-[0.9375rem] text-ink-2">Every repair done through Clutch, with who did it, what it cost and the photos they took.</p>
        <ol className="relative mt-5">
          {open.map((r) => (
            <li key={r.id} className="relative flex gap-4 pb-6">
              <span aria-hidden className="absolute top-10 bottom-0 left-[19px] w-0.5 bg-rule-soft" />
              <span className="relative z-10 grid size-10 shrink-0 place-items-center rounded-full border-2 border-dashed border-ink bg-sheet">
                <RepairIcon category={r.repairCategory} size={17} />
              </span>
              <div className="min-w-0 flex-1 pt-1">
                <p className="text-[0.75rem] font-extrabold tracking-[0.06em] uppercase">In progress</p>
                <Link href={`/customer/requests/${r.id}`} className="font-semibold hover:underline">
                  {REPAIR_LABEL[r.repairCategory]}: {r.symptomDescription.slice(0, 80)}
                </Link>
              </div>
            </li>
          ))}
          {history.map((h, i) => {
            const m = repo.getMechanic(h.mechanicId)!;
            const job = h.jobId ? repo.getJob(h.jobId) : undefined;
            const photos = (h.photos ?? []).filter((ph) => ph.url);
            const last = i === history.length - 1;
            return (
              <li key={h.id} id={job ? `repair-${job.id}` : undefined} className="relative flex gap-4 pb-6">
                {!last && <span aria-hidden className="absolute top-10 bottom-0 left-[19px] w-0.5 bg-brand" />}
                <span className="relative z-10 grid size-10 shrink-0 place-items-center rounded-full bg-brand text-sheet">
                  <RepairIcon category={h.repairCategory} size={17} />
                </span>
                <div className="sheet min-w-0 flex-1 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="font-bold">{h.title}</p>
                    <p className="tnum text-[0.8125rem] text-ink-3">
                      {monthYear(h.performedOn, true)}
                      {h.mileage ? ` · ${h.mileage.toLocaleString()} mi` : ""}
                    </p>
                  </div>
                  <p className="text-[0.8125rem] text-ink-2">{REPAIR_LABEL[h.repairCategory]}</p>
                  <div className="mt-3 flex items-center gap-3">
                    <PhotoPrint photoUrl={m.photoUrl} initials={m.displayName.split(" ").map((x) => x[0]).join("")} name={m.displayName} size={36} />
                    <p className="min-w-0 flex-1 text-[0.875rem]">
                      <Link href={`/mechanics/${m.slug}`} className="font-semibold hover:underline">
                        {m.displayName}
                      </Link>
                      {h.valueCents ? <span className="tnum text-ink-2"> · {usd(h.valueCents)}</span> : null}
                    </p>
                    {job ? (
                      <Link href={`/customer/jobs/${job.id}`} className="text-[0.8125rem] font-semibold underline decoration-rule underline-offset-2">
                        Estimate &amp; details
                      </Link>
                    ) : null}
                  </div>
                  {job?.completionNotes ? <p className="mt-2 border-l-2 border-rule pl-3 text-[0.875rem] text-ink-2">{job.completionNotes}</p> : null}
                  {photos.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {photos.map((ph) => (
                        <li key={ph.id}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={ph.url} alt={`${ph.kind} photo`} className="size-16 border border-rule object-cover" />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
          {history.length + open.length === 0 && (
            <li className="flex items-center gap-4 border-y border-rule-soft py-5 text-ink-3">
              <VehicleGlyph model={v.model} width={72} />
              No repairs on Clutch yet. Each one you book is added here automatically.
            </li>
          )}
        </ol>
      </section>

      <details id="edit" open={Boolean(sp.edit)} className="border-t border-rule pt-5">
        <summary className="cursor-pointer font-semibold">Edit details</summary>
        <form action={updateVehicle.bind(null, v.id)} className="mt-4 space-y-4">
          <VehicleFields v={v} />
          <button className="btn btn-ink">Save</button>
        </form>
      </details>
    </div>
  );
}
