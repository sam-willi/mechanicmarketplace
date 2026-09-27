import { Check } from "lucide-react";
import { cancelJobAsMechanic, confirmAppointment } from "@/app/actions/mechanic";
import { DeclineForm } from "./decline-form";

/**
 * Confirm a booked appointment, or say you can't make it. Confirming is the one primary action
 * (one tap); cancelling is secondary and asks for a reason, then confirmation, first.
 */
export function ConfirmDecide({ jobId, when, first, compact = false }: { jobId: string; when: string; first: string; compact?: boolean }) {
  return (
    <div className={`grid gap-3 ${compact ? "" : "sm:grid-cols-2"} sm:items-start`}>
      <form action={confirmAppointment.bind(null, jobId)}>
        <button className="btn btn-ink min-h-14 w-full text-[1.0625rem]">
          <Check size={20} strokeWidth={2.5} aria-hidden /> Confirm{when ? ` ${when}` : ""}
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
