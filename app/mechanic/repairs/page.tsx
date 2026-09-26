import type { Metadata } from "next";
import Link from "next/link";
import { getRepo } from "@/lib/data";
import { getSession, needs } from "@/lib/session";
import { REPAIR_LABEL } from "@/lib/domain/provenance";
import { REPAIR_CATEGORIES, VEHICLE_MAKES, type PastRepair } from "@/lib/domain/types";
import { monthYear } from "@/lib/format";
import { addPastRepair, attachRepairPhotos, requestConfirmation } from "@/app/actions/mechanic";
import { RepairPhotoUploader } from "@/components/mechanic/photo-uploader";
import { RepairIcon } from "@/components/visual/icons";
import { Field, NeedsPersona, PageTitle } from "@/components/workspace/ui";
import { Tick } from "@/components/trust/marks";

export const metadata: Metadata = { title: "Repair record" };

export default async function RepairsPage() {
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "mechanic") return <NeedsPersona role="mechanic" />;
  await (await needs(s)).ownSources();
  const src = repo.getMechanicSources(s.mechanicId);
  const confs = repo.listConfirmations(s.mechanicId);
  const byDate = (a: PastRepair, b: PastRepair) => (a.performedOn < b.performedOn ? 1 : -1);
  const self = src.pastRepairs.filter((r) => r.source === "self").sort(byDate);
  const verified = src.pastRepairs.filter((r) => r.source !== "self").sort(byDate);
  const pendingConf = (id: string) => confs.find((c) => c.pastRepairId === id && !c.response);
  const denied = (id: string) => confs.find((c) => c.pastRepairId === id && c.response === "denied");
  const reviewV = (id: string) => src.verifications.find((v) => v.subjectId === id);

  return (
    <div className="space-y-12">
      <PageTitle
        title="Repair record"
        note="Clutch jobs are added automatically. Earlier work stays self-reported until confirmed."
      />

      <section className="space-y-4">
        <h2 className="heading text-[1.375rem]">Add a previous repair</h2>
        <form action={addPastRepair} className="sheet grid gap-3 p-4 sm:grid-cols-6 sm:p-5">
          <Field label="Year">
            <input name="year" inputMode="numeric" required className="input" placeholder="2016" />
          </Field>
          <Field label="Make" className="sm:col-span-2">
            <select name="make" required className="input" defaultValue="">
              <option value="" disabled>
                Choose
              </option>
              {VEHICLE_MAKES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Model" className="sm:col-span-3">
            <input name="model" required className="input" placeholder="Accord" />
          </Field>
          <Field label="Repair type" className="sm:col-span-2">
            <select name="repairCategory" required className="input" defaultValue="">
              <option value="" disabled>
                Choose
              </option>
              {REPAIR_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {REPAIR_LABEL[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="What you did" className="sm:col-span-3">
            <input name="title" required className="input" placeholder="Front brake pads + rotors" />
          </Field>
          <Field label="Month">
            <input name="performedOn" type="month" className="input" />
          </Field>
          <Field label="Photo (optional)" className="sm:col-span-3">
            <input name="photo" type="file" accept="image/*" className="block w-full py-2 text-[0.875rem]" />
          </Field>
          <Field label="Invoice (optional)" className="sm:col-span-3">
            <input name="invoice" type="file" accept=".pdf,image/*" className="block w-full py-2 text-[0.875rem]" />
          </Field>
          <div className="border-t border-rule-soft pt-3 sm:col-span-6">
            <p className="text-[0.9375rem] font-semibold text-ink">Ask the customer to confirm it</p>
            <p className="text-[0.875rem] text-ink-2">They get a private link with a yes/no question. Their details are never shown publicly.</p>
          </div>
          <Field label="Customer first name" className="sm:col-span-2">
            <input name="contactName" className="input" />
          </Field>
          <Field label="Their phone or email" className="sm:col-span-4">
            <input name="contact" className="input" placeholder="(213) 555-0100" />
          </Field>
          <button className="btn btn-ink sm:col-span-6 sm:justify-self-start">Add repair</button>
        </form>
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-3 border-t-2 border-dashed border-pencil pt-3">
          <h2 className="heading text-[1.375rem]">Self-reported</h2>
          <p className="text-[0.8125rem] text-pencil">Shown on your profile as your own words</p>
        </div>
        <ul className="border-t border-rule">
          {self.map((r) => {
            const pc = pendingConf(r.id);
            const d = denied(r.id);
            const v = reviewV(r.id);
            return (
              <li key={r.id} className="grid gap-3 border-b border-rule-soft py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:gap-8">
                <div>
                  <p className="flex items-center gap-2 font-semibold text-ink">
                    <Tick state="self" size={14} /> {r.year} {r.make} {r.model}
                  </p>
                  <p className="text-[0.9375rem] text-ink-2">
                    {r.title} <span className="tnum text-ink-3">· {monthYear(r.performedOn)}</span>
                  </p>
                  {r.evidence.length ? <p className="mt-0.5 text-[0.8125rem] text-ink-3">Files: {r.evidence.map((e) => e.name).join(", ")}</p> : null}
                </div>
                <div>
                  {pc ? (
                    <div className="space-y-1.5 text-[0.875rem]">
                      <p className="text-ink-2">
                        Confirmation link for {pc.contactName}, created {monthYear(pc.sentAt)}. Waiting for their answer.
                      </p>
                      <p className="text-ink-3">
                        Clutch doesn&apos;t send texts or emails yet. Send them this link yourself:{" "}
                        <Link href={`/confirm/${pc.token}`} className="link text-ink">
                          /confirm/{pc.token}
                        </Link>
                      </p>
                    </div>
                  ) : v?.status === "pending" ? (
                    <p className="text-[0.875rem] text-ink-2">A Clutch reviewer is checking the files you attached.</p>
                  ) : (
                    <form action={requestConfirmation.bind(null, r.id)} className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_auto]">
                      <input name="contactName" placeholder="First name" className="input min-h-11 py-1 text-sm" required />
                      <input name="contact" placeholder="Phone or email" className="input min-h-11 py-1 text-sm" required />
                      <button className="btn btn-line min-h-11 text-sm">Create confirmation link</button>
                      {d ? <p className="text-[0.8125rem] text-alert sm:col-span-3">{d.contactName} didn&apos;t recognise this repair last time.</p> : null}
                    </form>
                  )}
                </div>
              </li>
            );
          })}
          {self.length === 0 && <li className="border-b border-rule-soft py-5 text-[0.9375rem] text-ink-3">No self-reported repairs.</li>}
        </ul>
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-3 border-t-2 border-ink pt-3">
          <h2 className="heading text-[1.375rem]">Verified</h2>
          <p className="tnum text-[0.8125rem] text-ink-3">{verified.length} repairs count on your profile</p>
        </div>
        <ul className="border-t border-rule">
          {verified.map((r) => (
            <li key={r.id} className="border-b border-rule-soft py-3">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4">
                <div className="flex min-w-0 gap-3">
                  <span className="grid size-10 shrink-0 place-items-center border border-brand-tint bg-brand-wash text-brand" aria-hidden>
                    <RepairIcon category={r.repairCategory} size={17} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">
                      {r.year} {r.make} {r.model}
                    </p>
                    <p className="text-[0.9375rem] text-ink-2">
                      {r.title} <span className="tnum text-ink-3">· {monthYear(r.performedOn)}</span>
                    </p>
                  </div>
                </div>
                <p className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-carbon">
                  <Tick size={14} /> {r.source === "platform" ? "Verified through a Clutch job" : r.source === "document" ? "Document reviewed by Clutch" : "Confirmed by a past customer"}
                </p>
              </div>
              {(r.photos ?? []).some((ph) => ph.url) && (
                <ul className="mt-2 flex flex-wrap gap-2 pl-[3.25rem]">
                  {(r.photos ?? []).filter((ph) => ph.url).map((ph) => (
                    <li key={ph.id}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={ph.url} alt={`${ph.kind} photo`} className="size-14 border border-rule object-cover" />
                      <p className="text-[0.625rem] text-ink-3">{ph.demo ? "Demo photo" : ph.source === "job" ? "Verified photo" : "Your upload"}</p>
                    </li>
                  ))}
                </ul>
              )}
              <details className="mt-2 pl-[3.25rem]">
                <summary className="cursor-pointer text-[0.8125rem] font-semibold underline decoration-rule underline-offset-2">Add photos</summary>
                <div className="mt-2">
                  <RepairPhotoUploader
                    attach={attachRepairPhotos.bind(null, r.id)}
                    note="Shown as a mechanic-uploaded photo. Only Clutch job photos are labelled verified."
                  />
                </div>
              </details>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
