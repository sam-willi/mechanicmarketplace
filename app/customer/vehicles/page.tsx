import type { Metadata } from "next";
import Link from "next/link";
import { Car, Plus } from "lucide-react";
import { ready, repo } from "@/lib/data";
import { getSession } from "@/lib/session";
import { transmissionLabel, vehicleLine } from "@/lib/domain/intake";
import { monthYear } from "@/lib/format";
import { addVehicle } from "@/app/actions/customer";
import { VehicleFields } from "@/components/app/vehicle-form";

export const metadata: Metadata = { title: "My Vehicles" };

export default async function Vehicles({ searchParams }: { searchParams: Promise<{ add?: string; error?: string }> }) {
  await ready();
  const s = await getSession();
  if (s.role !== "customer") return null;
  const sp = await searchParams;
  const vehicles = repo.listVehicles(s.customerId);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-ink pb-4">
        <div>
          <h1 className="display text-[2rem] sm:text-[2.5rem]">My Vehicles</h1>
          <p className="mt-1 text-ink-2">Each car keeps its own repair history: a maintenance record that grows with every job.</p>
        </div>
        {!sp.add && (
          <Link href="/customer/vehicles?add=1" className="btn btn-line">
            <Plus size={16} aria-hidden /> Add a vehicle
          </Link>
        )}
      </div>

      {sp.add && (
        <form action={addVehicle} className="sheet space-y-4 p-5">
          <h2 className="heading text-[1.25rem]">Add a vehicle</h2>
          {sp.error ? <p className="text-[0.9375rem] text-alert">Choose a make and enter the model.</p> : null}
          <VehicleFields />
          <div className="flex gap-2">
            <button className="btn btn-ink">Save vehicle</button>
            <Link href="/customer/vehicles" className="btn btn-quiet">
              Cancel
            </Link>
          </div>
        </form>
      )}

      <ul className="grid gap-4 md:grid-cols-2">
        {vehicles.map((v) => {
          const history = repo.listVehicleHistory(v.id);
          return (
            <li key={v.id}>
              <Link href={`/customer/vehicles/${v.id}`} className="sheet block p-5 hover:border-ink">
                <div className="flex items-start gap-3">
                  <Car size={22} aria-hidden className="mt-1 shrink-0 text-ink-2" />
                  <div className="min-w-0">
                    <p className="heading text-[1.25rem]">{vehicleLine(v)}</p>
                    <p className="tnum text-[0.875rem] text-ink-2">
                      {[v.engine, transmissionLabel(v.transmission), v.mileage ? `${v.mileage.toLocaleString()} mi` : null].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-[0.8125rem] text-ink-3">{v.vin ? `VIN …${v.vin.slice(-6)}` : "No VIN yet"}</p>
                  </div>
                </div>
                <ul className="mt-4 border-t border-rule-soft pt-3 text-[0.875rem]">
                  {history.slice(0, 3).map((h) => (
                    <li key={h.id} className="flex justify-between gap-3 py-1">
                      <span>
                        {h.title} <span className="text-ink-3">· {repo.getMechanic(h.mechanicId)?.displayName}</span>
                      </span>
                      <span className="tnum shrink-0 text-ink-3">{monthYear(h.performedOn)}</span>
                    </li>
                  ))}
                  {history.length === 0 && <li className="text-ink-3">No Clutch repairs yet.</li>}
                </ul>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
