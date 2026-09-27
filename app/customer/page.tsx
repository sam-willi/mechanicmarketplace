import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Plus, Search, Wrench } from "lucide-react";
import { getRepo } from "@/lib/data";
import { getSession, needs } from "@/lib/session";
import { primarySymptom, vehicleLine } from "@/lib/domain/intake";
import { isWaitingForMatch, needsNewMechanic } from "@/lib/domain/status";
import { repairChip } from "@/lib/domain/journey";
import { monthYear, plural } from "@/lib/format";
import { PhotoPrint } from "@/components/profile/photo";
import { StatusChip } from "@/components/app/status-chip";
import { ConfirmButton } from "@/components/app/confirm-button";
import { discardIntakeDraft } from "@/app/actions/intake";
import { RepairIcon } from "@/components/visual/icons";
import { VehicleTile } from "@/components/visual/vehicle-glyph";
import { Notice } from "@/components/workspace/ui";
import { openingLabel, soonest } from "@/lib/domain/availability";

function openingText(openings: { on: string; time: string }[]) {
  const o = soonest(openings);
  return o ? `Next opening: ${openingLabel(o)}` : "";
}

export const metadata: Metadata = { title: "Home" };

function Block({ title, href, linkLabel, children }: { title: string; href?: string; linkLabel?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="heading text-[1.25rem]">{title}</h2>
        {href ? (
          <Link href={href} className="text-[0.875rem] font-semibold underline decoration-rule underline-offset-2 hover:decoration-ink">
            {linkLabel ?? "See all"}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function greeting() {
  const h = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Los_Angeles" }));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default async function CustomerHome({ searchParams }: { searchParams: Promise<{ welcome?: string; saved?: string }> }) {
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "customer") return null;
  const sp = await searchParams;
  await (await needs(s)).customerHome();
  const vehicles = repo.listVehicles(s.customerId);
  const requests = repo.listRequestsForCustomer(s.customerId);
  const jobs = repo.listJobsForCustomer(s.customerId);
  const open = requests.filter((r) => r.status === "open" || r.status === "quoted");
  const upcoming = jobs.filter((j) => j.status === "scheduled" || j.status === "in_progress" || j.status === "awaiting_customer");
  const history = repo.listCustomerHistory(s.customerId);
  const recentIds = [...new Set(history.map((h) => h.mechanicId))].slice(0, 3);
  const savedIds = repo.listSaved(s.customerId).filter((id) => !recentIds.includes(id));
  const profile = (id: string) => repo.getPublicProfile(repo.getMechanic(id)!.slug)!;
  const noSupply = !(await repo.anyBookable());
  const draft = repo.getDraft(s.customerId);
  const draftVehicle = draft ? (vehicles.find((v) => v.id === draft.vehicleId) ?? (draft.vehicle.make ? draft.vehicle : null)) : null;
  const draftCar = draftVehicle ? [draftVehicle.year, draftVehicle.make, draftVehicle.model].filter(Boolean).join(" ") : "";

  return (
    <div className="space-y-12">
      {/* The one question */}
      <section className="space-y-5">
        <p className="text-[1rem] font-semibold text-ink-2">{sp.welcome ? `Welcome to Clutch, ${s.name.split(" ")[0]}.` : `${greeting()}, ${s.name.split(" ")[0]}.`}</p>
        <h1 className="display text-[2.25rem] sm:text-[3rem]">What does your car need?</h1>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link href="/customer/requests/new" className="group flex items-center gap-4 bg-brand p-5 text-sheet">
            <Wrench size={26} aria-hidden className="shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="heading block text-[1.25rem] text-sheet">Describe the problem</span>
              <span className="block text-[0.875rem] text-on-brand-2">{noSupply ? "Save a request for the first mechanic who fits." : "Get estimates from available mechanics who match your car, repair and area."}</span>
            </span>
            <ArrowRight size={20} aria-hidden className="shrink-0 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link href="/customer/mechanics" className="group sheet flex items-center gap-4 p-5 hover:border-ink">
            <Search size={26} aria-hidden className="shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="heading block text-[1.25rem]">Find a mechanic</span>
              <span className="block text-[0.875rem] text-ink-2">Search by car and repair.</span>
            </span>
            <ArrowRight size={20} aria-hidden className="shrink-0 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
        {noSupply ? (
          <Notice tone="info">
            <p className="font-semibold">Clutch is launching in Los Angeles.</p>
            <p className="mt-1 max-w-[70ch] text-ink-2">
              No mechanic has finished a Clutch profile yet, so there&apos;s no one to book today. You can still describe a repair: Clutch saves it and sends it to a
              mechanic who fits it once one joins. You&apos;ll see replies on the request here.
            </p>
          </Notice>
        ) : null}
        {draft ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border border-ink bg-sheet px-4 py-3">
            <div className="min-w-0">
              <p className="text-[0.9375rem] font-semibold">
                {sp.saved ? "Saved. " : ""}
                Unfinished request{draftCar ? `: ${draftCar}` : ""}
              </p>
              <p className="text-[0.8125rem] text-ink-2">
                Step {Math.min(draft.step, 3) + 1} of 4 · not sent yet
              </p>
            </div>
            <div className="flex items-center gap-2">
              <form action={discardIntakeDraft}>
                <ConfirmButton message="Discard this unfinished request? Your answers will be deleted." className="min-h-11 px-2 text-[0.875rem] text-ink-3 underline decoration-rule underline-offset-2">
                  Discard
                </ConfirmButton>
              </form>
              <Link href="/customer/requests/new" className="btn btn-ink min-h-11 text-sm">
                Finish and send
              </Link>
            </div>
          </div>
        ) : null}
      </section>

      {upcoming.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {upcoming.map((j) => {
            const v = repo.getVehicle(j.vehicleId)!;
            const m = profile(j.mechanicId);
            const st = repairChip(repo.getRequest(j.requestId)!, [], j);
            return (
              <Link key={j.id} href={`/customer/jobs/${j.id}`} className="sheet flex gap-4 p-5 hover:border-ink">
                <PhotoPrint photoUrl={m.photoUrl} initials={m.initials} name={m.displayName} size={52} />
                <div className="min-w-0">
                  <StatusChip {...st} />
                  <p className="mt-2 font-bold">
                    {j.status === "scheduled"
                      ? `${m.firstName} is ${j.confirmedAt ? "confirmed" : "booked"} for ${j.scheduledFor}`
                      : j.status === "in_progress"
                        ? `${m.firstName} is working on your ${v.make}`
                        : `Confirm ${m.firstName} finished the job`}
                  </p>
                  <p className="text-[0.875rem] text-ink-2">
                    {j.title} · {vehicleLine(v)}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <Block title="Open requests" href={open.length ? "/customer/requests" : undefined}>
        {open.length ? (
          <ul className="grid gap-3">
            {open.map((r) => {
              const v = repo.getVehicle(r.vehicleId)!;
              const rq = repo.listQuotesForRequest(r.id).filter((q) => q.status !== "draft");
              const fresh = rq.filter((q) => q.status === "submitted");
              const faces = rq.slice(0, 3).map((q) => profile(q.mechanicId));
              return (
                <li key={r.id}>
                  <Link href={`/customer/requests/${r.id}`} className="sheet grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 p-4 hover:border-ink">
                    <VehicleTile v={v} size="sm" />
                    <div className="min-w-0">
                      <StatusChip {...repairChip(r, rq, undefined)} />
                      <p className="mt-1.5 flex items-center gap-1.5 font-semibold">
                        <RepairIcon category={r.repairCategory} size={15} /> {vehicleLine(v)}
                      </p>
                      <p className="line-clamp-1 text-[0.875rem] text-ink-2">{primarySymptom(r)}</p>
                      <p className="mt-1 text-[0.9375rem] font-bold">
                        {isWaitingForMatch(r)
                          ? "Saved. No mechanic matches it yet"
                          : needsNewMechanic(r, rq)
                          ? `${repo.getMechanic(r.declines!.at(-1)!.mechanicId)?.displayName.split(" ")[0] ?? "Your mechanic"} can't take it. See who else could`
                          : fresh.length
                          ? `${plural(fresh.length, "new estimate")} to review`
                          : r.interested.length
                            ? `${plural(r.interested.length, "mechanic")} interested`
                            : `Sent to ${plural(r.matchedMechanicIds.length, "mechanic")}, waiting for replies`}
                      </p>
                      {faces.length > 0 && (
                        <div className="mt-2 flex -space-x-2" aria-hidden>
                          {faces.map((p) => (
                            <PhotoPrint key={p.id} photoUrl={p.photoUrl} initials={p.initials} name={p.displayName} size={32} />
                          ))}
                        </div>
                      )}
                    </div>
                    <ArrowRight size={18} aria-hidden className="shrink-0 text-ink-3" />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="border-y border-rule py-5 text-[0.9375rem] text-ink-3">No open requests. Requests you send or save appear here.</p>
        )}
      </Block>

      <div className="grid gap-12 lg:grid-cols-2">
        <Block title="Your vehicles" href="/customer/vehicles" linkLabel="Manage">
          <ul className="grid gap-2">
            {vehicles.map((v) => (
              <li key={v.id}>
                <Link href={`/customer/vehicles/${v.id}`} className="sheet flex items-center gap-4 p-3 hover:border-ink">
                  <VehicleTile v={v} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{vehicleLine(v)}</span>
                    <span className="block text-[0.8125rem] text-ink-3">
                      {v.mileage ? `${v.mileage.toLocaleString()} mi` : "Mileage not set"} · {plural(repo.listVehicleHistory(v.id).length, "repair")} on Clutch
                    </span>
                  </span>
                </Link>
              </li>
            ))}
            <li>
              <Link href="/customer/vehicles?add=1" className="flex items-center gap-2 border border-dashed border-rule px-4 py-3 text-[0.9375rem] font-semibold text-ink-2 hover:border-ink hover:text-ink">
                <Plus size={16} aria-hidden /> Add a vehicle
              </Link>
            </li>
          </ul>
        </Block>

        <Block title="Your mechanics" href="/customer/saved" linkLabel="Saved mechanics">
          {recentIds.length + savedIds.length ? (
            <ul className="border-t border-rule">
              {[...recentIds, ...savedIds].slice(0, 4).map((id) => {
                const p = profile(id);
                const last = history.find((h) => h.mechanicId === id);
                return (
                  <li key={id} className="flex items-center gap-3 border-b border-rule-soft py-3">
                    <PhotoPrint photoUrl={p.photoUrl} initials={p.initials} name={p.displayName} size={44} />
                    <div className="min-w-0 flex-1">
                      <Link href={`/mechanics/${p.slug}`} className="font-semibold hover:underline">
                        {p.displayName}
                      </Link>
                      <p className="truncate text-[0.8125rem] text-ink-2">{last ? `Last: ${last.title} · ${monthYear(last.performedOn)}` : "Saved"}</p>
                      <p className="text-[0.75rem] text-ink-3">{openingText(p.openings)}</p>
                    </div>
                    <Link href={`/customer/requests/new?rebook=${p.slug}`} className="btn btn-line min-h-11 px-3 text-sm">
                      {last ? `Need ${p.firstName} again?` : "Request"}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="border-y border-rule py-5 text-[0.9375rem] text-ink-3">Mechanics you hire or save appear here.</p>
          )}
        </Block>
      </div>

      {history.length > 0 && (
        <Block title="Recent repairs" href="/customer/jobs">
          <ul className="border-t border-rule">
            {history.slice(0, 3).map((h) => (
              <li key={h.id} className="flex items-baseline justify-between gap-4 border-b border-rule-soft py-3">
                <span>
                  <span className="font-semibold">{h.title}</span>
                  <span className="block text-[0.8125rem] text-ink-2">
                    {h.year} {h.make} {h.model} · {repo.getMechanic(h.mechanicId)?.displayName}
                  </span>
                </span>
                <span className="tnum shrink-0 text-[0.8125rem] text-ink-3">{monthYear(h.performedOn)}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}
    </div>
  );
}
