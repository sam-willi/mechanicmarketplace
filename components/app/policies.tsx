import { Ban, CalendarClock, CreditCard, LifeBuoy, ShieldCheck } from "lucide-react";

/**
 * What happens around a booking, stated before the customer chooses. Only
 * mechanisms that exist; a workmanship guarantee is the mechanic's own.
 */
export function Policies({ firstName, guarantee, compact = false }: { firstName: string; guarantee?: string; compact?: boolean }) {
  const rows = [
    {
      icon: CreditCard,
      title: "Payment",
      body: `You pay ${firstName} directly after the work. Each of you can note the amount and whether it's paid; Clutch keeps what you enter but doesn't take, hold or refund money.`,
    },
    {
      icon: Ban,
      title: "Cancelling",
      body: `Either of you can cancel in Clutch until work starts; Clutch charges no fee. After ${firstName} starts, talk to them, or report a problem. If parts were already bought for you, sort that out with ${firstName}.`,
    },
    { icon: CalendarClock, title: "Rescheduling", body: `Suggest a new time from your repair page. The booking only changes once ${firstName} accepts it (and ${firstName} can suggest one too).` },
    {
      icon: LifeBuoy,
      title: "If something goes wrong",
      body: "Report it from the repair page. Clutch staff see the estimate, the job's history and photos, and reply in the app. There's no set response time, and Clutch can't move money or rule on disputes.",
    },
    {
      icon: ShieldCheck,
      title: "Workmanship",
      body: guarantee ? `${firstName}'s own guarantee: ${guarantee} Offered by ${firstName}, not Clutch.` : `${firstName} hasn't listed a written guarantee. Ask before you book.`,
    },
  ];
  return (
    <ul className={`grid gap-x-6 gap-y-3 ${compact ? "" : "sm:grid-cols-2"}`}>
      {rows.map((r) => (
        <li key={r.title} className="flex gap-2.5 text-[0.875rem]">
          <r.icon size={16} className="mt-0.5 shrink-0 text-ink-2" aria-hidden />
          <span>
            <span className="font-semibold">{r.title}.</span> <span className="text-ink-2">{r.body}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
