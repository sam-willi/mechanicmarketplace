import type { Metadata } from "next";
import { getRepo } from "@/lib/data";
import { getSession, needs } from "@/lib/session";
import { findArea } from "@/lib/domain/areas";
import { KNOWN_SERVICES } from "@/lib/domain/intake";
import { emptyDraft } from "@/lib/domain/intake-draft";
import { PhotoPrint } from "@/components/profile/photo";
import { RequestWizard } from "@/components/request/request-wizard";
import { emailAlertsOn } from "@/lib/notify/config";

export const metadata: Metadata = { title: "Request a repair" };

export default async function RequestPage({
  searchParams,
}: {
  searchParams: Promise<{ mechanic?: string; repair?: string; make?: string; rebook?: string; new?: string; area?: string; mode?: string }>;
}) {
  const repo = await getRepo();
  const s = await getSession();
  const sp = await searchParams;
  if (s.role !== "customer") return null;
  const slug = sp.rebook ?? sp.mechanic;
  await (await needs(s)).newRequest(slug);
  const vehicles = repo.listVehicles(s.customerId);
  const target = slug ? repo.getPublicProfile(slug) : null;
  const rebook = Boolean(sp.rebook && target);
  const noSupply = !(await repo.anyBookable());

  // Resume a saved draft for the same destination; otherwise start fresh.
  const saved = repo.getDraft(s.customerId);
  const sameTarget = saved && (saved.directTo ?? saved.rebookOf ?? null) === (target?.id ?? null);
  const resumed = Boolean(saved && sameTarget && !sp.new);
  const matchCar = vehicles.find((v) => v.make === sp.make) ?? vehicles[0];
  const initial = resumed
    ? saved!
    : emptyDraft({
        vehicleId: matchCar?.id ?? "new",
        vehicle: {
          year: "",
          make: sp.make && !matchCar ? sp.make : "",
          model: "",
          trim: "",
          engine: "",
          transmission: "",
          vin: "",
          mileage: matchCar?.mileage ? matchCar.mileage.toLocaleString() : "",
        },
        knownService: KNOWN_SERVICES.some((k) => k.value === sp.repair) ? sp.repair! : "",
        // Carried over from a search, so nothing has to be entered twice.
        area: findArea(sp.area)?.key ?? "",
        directTo: rebook ? undefined : target?.id,
        rebookOf: rebook ? target?.id : undefined,
      });

  return (
    <>
      <div className="mx-auto max-w-[760px]">
        <h1 className="text-[0.9375rem] font-bold text-ink-2">
          {target ? (rebook ? `Book ${target.firstName} again` : `Request an estimate from ${target.firstName}`) : noSupply ? "Describe a repair" : "Get written estimates for a repair"}
        </h1>
        {target ? (
          <div className="mt-3 flex items-center gap-3">
            <PhotoPrint photoUrl={target.photoUrl} initials={target.initials} name={target.displayName} size={44} />
            <p className="text-[0.875rem] text-ink-2">
              <span className="font-bold text-ink">{target.displayName}</span> · {target.reputation.verifiedRepairs} verified repairs
            </p>
          </div>
        ) : null}
        <div className="mt-6">
          <RequestWizard
            initial={initial}
            resumed={resumed}
            vehicles={vehicles}
            customerId={s.customerId}
            target={target ? { id: target.id, firstName: target.firstName, displayName: target.displayName } : null}
            rebook={rebook}
            noSupply={noSupply}
            alertsOn={emailAlertsOn()}
          />
        </div>
      </div>
    </>
  );
}
