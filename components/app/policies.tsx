import { Ban, CalendarClock, CreditCard, LifeBuoy, ShieldCheck } from "lucide-react";

/**
 * What happens around a booking, stated before the customer chooses. Only
 * mechanisms that exist; a workmanship guarantee is the mechanic's own.
 */
export function Policies({ firstName, guarantee, compact = false }: { firstName: string; guarantee?: string; compact?: boolean }) {
  const rows = [
    { icon: CreditCard, title: "Payment", body: `You pay ${firstName} directly after the work. Clutch records the amount but doesn't take or hold payment.` },
    { icon: Ban, title: "Cancelling", body: "Free through Clutch before the appointment. If parts were already bought for you, sort that out with the mechanic." },
    { icon: CalendarClock, title: "Rescheduling", body: `Ask ${firstName} from your repair page. The new time counts once they confirm it.` },
    { icon: LifeBuoy, title: "If something goes wrong", body: "Report it from the repair page. Clutch's trust team reviews the estimate, notes and photos and follows up." },
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
