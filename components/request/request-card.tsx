import Link from "next/link";
import { AlertTriangle, CalendarClock, MapPin, MoreHorizontal, Target } from "lucide-react";
import { jobStatus, primarySymptom, urgencyLabel, vehicleLine } from "@/lib/domain/intake";
import { quoteReadiness } from "@/lib/domain/readiness";
import type { RepairRequest, Vehicle } from "@/lib/domain/types";
import { declineRequest } from "@/app/actions/mechanic";
import { VehicleTile } from "@/components/visual/vehicle-glyph";
import { ConfirmButton } from "@/components/app/confirm-button";
import { StatusBadge } from "./request-summary";

type State = "new" | "interested" | "draft" | "sent" | "approved" | "not_chosen" | "declined";

/** The one gap worth flagging on a card: anything that blocks quoting, else a missing VIN. */
function keyGap(r: RepairRequest, v: Vehicle) {
  const gaps = quoteReadiness(r, v).gaps;
  const g = gaps.find((x) => x.blocks) ?? gaps.find((x) => x.text.startsWith("No VIN"));
  return g ? (g.text.startsWith("No VIN") ? "Missing VIN" : g.text) : null;
}

/**
 * A repair request at a glance: the car, the problem, distance, timing and
 * condition, one match reason and one gap. Everything else is on the request.
 */
export function RequestCard({
  r,
  v,
  distanceMi,
  state,
  isReturning,
  reason,
  experience,
}: {
  r: RepairRequest;
  v: Vehicle;
  distanceMi?: number;
  state: State;
  isReturning?: boolean;
  /** Why this request matched this mechanic, in terms of their own verified work. */
  reason?: string;
  experience?: string[];
}) {
  const status = jobStatus(r);
  const href = `/mechanic/requests/${r.id}`;
  const actionable = state === "new" || state === "interested" || state === "draft";
  const match = experience?.[0] ?? reason;
  const gap = actionable ? keyGap(r, v) : null;
  const picked = Boolean(r.requestedMechanicId && !r.declinedBy.includes(r.requestedMechanicId));

  return (
    <article className="sheet flex flex-col">
      <div className="flex-1 space-y-2.5 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <VehicleTile v={v} size="sm" className="hidden sm:flex" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="heading text-[1.1875rem] leading-tight">
                <Link href={href} className="hover:underline">
                  {vehicleLine(v)}
                </Link>
                {v.mileage ? <span className="tnum font-medium text-ink-2"> · {Math.round(v.mileage / 1000)}k mi</span> : null}
              </h3>
              <StatusBadge tone={status.tone}>{status.headline}</StatusBadge>
            </div>
            <p className="mt-1 line-clamp-2 text-[1rem] leading-snug">{primarySymptom(r)}</p>
          </div>
        </div>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.875rem] text-ink-2">
          {distanceMi !== undefined ? (
            <span className="inline-flex items-center gap-1.5">
              <MapPin size={14} aria-hidden /> {distanceMi < 1 ? "Under a mile" : `${distanceMi.toFixed(1)} mi`}
            </span>
          ) : null}
          <span className={`inline-flex items-center gap-1.5 ${r.urgency === "stranded" ? "font-semibold text-alert" : ""}`}>
            <CalendarClock size={14} aria-hidden /> {urgencyLabel(r.urgency) ?? "No timing given"}
          </span>
          {isReturning ? <span className="font-semibold text-ink">Returning customer</span> : null}
          {picked && actionable ? <span className="font-semibold text-ink">Asked for you</span> : null}
        </p>
        {match ? (
          <p className="flex items-center gap-1.5 text-[0.875rem]">
            <Target size={14} className="shrink-0 text-brand" aria-hidden /> <span className="font-semibold">Matched:</span> {match}
          </p>
        ) : null}
        {gap ? (
          <p className="flex items-center gap-1.5 text-[0.875rem] font-semibold text-amber">
            <AlertTriangle size={14} className="shrink-0" aria-hidden /> {gap}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-3 border-t border-rule-soft px-4 py-3 sm:px-5">
        {actionable ? (
          <>
            <Link href={`${href}#estimate`} className="btn btn-ink min-h-11 text-sm">
              {state === "draft" ? "Finish your estimate" : "Review and estimate"}
            </Link>
            {state === "draft" ? <span className="text-[0.8125rem] text-ink-2">Draft saved</span> : null}
            <details className="relative ml-auto">
              <summary className="grid size-11 cursor-pointer list-none place-items-center text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden" aria-label="More actions">
                <MoreHorizontal size={20} aria-hidden />
              </summary>
              <div className="absolute right-0 bottom-full z-20 mb-1 w-56 border border-rule bg-sheet p-1 shadow-[0_12px_30px_-14px_rgba(15,28,48,0.45)]">
                <form action={declineRequest.bind(null, r.id)}>
                  <ConfirmButton
                    message={
                      picked
                        ? `Decline this ${vehicleLine(v)} request? The customer asked for you, so they'll be told and shown other mechanics.`
                        : `Decline this ${vehicleLine(v)} request? It leaves your list.`
                    }
                    className="w-full px-3 py-2.5 text-left text-[0.9375rem] hover:bg-paper"
                  >
                    Decline request
                  </ConfirmButton>
                </form>
              </div>
            </details>
          </>
        ) : (
          <>
            <Link href={href} className="btn btn-line min-h-11 text-sm">
              Review request
            </Link>
            <span className="ml-auto text-right text-[0.875rem] font-semibold text-ink-2">
              {state === "sent" ? "Customer deciding" : state === "approved" ? "Estimate approved" : state === "not_chosen" ? "Customer chose someone else" : "Declined"}
            </span>
          </>
        )}
      </div>
    </article>
  );
}
