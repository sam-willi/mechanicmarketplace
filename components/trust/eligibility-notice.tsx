import { ShieldAlert, Clock } from "lucide-react";
import type { Eligibility } from "@/lib/domain/eligibility";

/**
 * Shown next to the primary action whenever screening affects it: a hard stop
 * when the mechanic can't be booked, a gentle note when something expires soon.
 */
export function EligibilityNotice({ e, audience = "customer", className = "", compact = false }: { e: Eligibility; audience?: "customer" | "mechanic"; className?: string; compact?: boolean }) {
  if (e.tone === "ok") return null;
  const stop = e.tone === "stop";
  const Icon = stop ? ShieldAlert : Clock;
  return (
    <div role={stop ? "alert" : "status"} className={`flex gap-2.5 border px-3 py-2.5 text-[0.875rem] ${stop ? "border-alert bg-alert-wash text-alert" : "border-amber/60 bg-amber-wash text-amber"} ${className}`}>
      <Icon size={17} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-bold">{stop ? (audience === "customer" ? "Can't be booked right now" : "You can't send estimates or take bookings") : "Screening renewal due soon"}</p>
        <p className="text-ink">
          {compact
            ? e.blocking.length === 1
              ? e.blocking[0].label
              : e.blocking.length
                ? `${e.blocking.length} required checks aren't current`
                : e.expiring.map((x) => `${x.name} renews ${x.when}`).join(", ")
            : audience === "customer"
              ? e.customerLine
              : e.mechanicLine}
        </p>
      </div>
    </div>
  );
}
