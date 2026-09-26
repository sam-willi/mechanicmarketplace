import { Check } from "lucide-react";
import { cancelJobAsMechanic, confirmAppointment } from "@/app/actions/mechanic";
import { DeclineForm } from "./decline-form";

/**
 * Confirm a booked appointment, or say you can't make it: a big green check
 * and a big red X. Confirming is one tap; cancelling asks for a reason first.
 */
export function ConfirmDecide({ jobId, when, first, compact = false }: { jobId: string; when: string; first: string; compact?: boolean }) {
  return (
    <div className={`grid gap-3 ${compact ? "" : "sm:grid-cols-2"} sm:items-start`}>
      <form action={confirmAppointment.bind(null, jobId)}>
        <button className="flex min-h-16 w-full items-center justify-center gap-2 border-2 border-go bg-go px-5 text-[1.0625rem] font-bold text-white hover:brightness-110">
          <Check size={24} strokeWidth={3} aria-hidden /> Confirm{when ? ` ${when}` : ""}
        </button>
      </form>
      <DeclineForm
        big
        danger
        action={cancelJobAsMechanic.bind(null, jobId)}
        summary="Can't make it"
        note={`${first} is told right away and shown other mechanics who could do it. Cancelling booked work affects your record.`}
        confirm={`Cancel this job with ${first}? It can't be undone.`}
        submit="Cancel the job"
      />
    </div>
  );
}
