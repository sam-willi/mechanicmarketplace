import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getRepo } from "@/lib/data";
import { getSession, needs } from "@/lib/session";
import { AREAS } from "@/lib/domain/areas";
import { URGENCY, vehicleLine } from "@/lib/domain/intake";
import { REPAIR_LABEL } from "@/lib/domain/provenance";
import { REPAIR_CATEGORIES } from "@/lib/domain/types";
import { editRequest } from "@/app/actions/customer";
import { Field } from "@/components/workspace/ui";
import { SubmitButton } from "@/components/auth/submit-button";

export const metadata: Metadata = { title: "Edit request" };

/** Change a request before any mechanic has responded to it. */
export default async function EditRequest({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "customer") return null;
  const { id } = await params;
  await (await needs(s)).customerRequest(id);
  const sp = await searchParams;
  const r = repo.getRequest(id);
  if (!r || r.customerId !== s.customerId) notFound();
  const v = repo.getVehicle(r.vehicleId)!;
  const responded = repo.listQuotesForRequest(r.id).some((q) => q.status !== "draft") || r.interested.length > 0 || r.questions.length > 0;
  const editable = r.status === "open" && !responded;

  return (
    <div className="mx-auto max-w-[680px]">
      <Link href={`/customer/requests/${r.id}`} className="inline-flex items-center gap-1.5 text-[0.875rem] text-ink-3 hover:text-ink">
        <ArrowLeft size={14} aria-hidden /> Back to the request
      </Link>
      <h1 className="display mt-3 text-[2rem]">Edit your request</h1>
      <p className="mt-1 text-ink-2">{vehicleLine(v)}</p>

      {!editable ? (
        <p className="mt-6 border-l-4 border-brass bg-sheet px-4 py-3 text-[0.9375rem]">
          {r.status === "cancelled"
            ? "This request is cancelled, so it can't be changed."
            : "A mechanic has already responded to this request, so it can't be changed. You can cancel it from the request page and send a new one."}
        </p>
      ) : (
        <form action={editRequest.bind(null, r.id)} className="mt-6 space-y-5">
          {sp.error ? (
            <p role="alert" className="border-l-4 border-alert bg-sheet px-4 py-3 text-[0.9375rem]">
              {sp.error}
            </p>
          ) : null}
          <Field label="What is the car doing?">
            <textarea name="symptomDescription" required minLength={10} maxLength={2000} rows={5} defaultValue={r.symptomDescription} className="input" />
          </Field>
          <Field label="Kind of repair">
            <select name="repairCategory" defaultValue={r.repairCategory} className="input">
              {REPAIR_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {REPAIR_LABEL[c]}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Area the car is in">
              <select name="area" required defaultValue={r.location.area ?? ""} className="input">
                <option value="" disabled>
                  Choose an area
                </option>
                {AREAS.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="How soon">
              <select name="urgency" defaultValue={r.urgency ?? ""} className="input">
                <option value="">Not set</option>
                {URGENCY.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="When works for you?">
            <input name="preferredTimes" maxLength={200} defaultValue={r.preferredTimes} className="input" placeholder="e.g. Saturday morning, or weekdays after 5pm" />
          </Field>
          <p className="text-[0.8125rem] text-ink-3">To change the car, photos or address, cancel this request and send a new one.</p>
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton className="btn btn-ink min-h-11" pending="Saving…">
              Save changes
            </SubmitButton>
            <Link href={`/customer/requests/${r.id}`} className="min-h-11 px-2 py-2.5 font-semibold text-ink-2 underline decoration-rule underline-offset-2">
              Discard changes
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
