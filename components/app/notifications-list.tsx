import Link from "next/link";
import {
  BadgeCheck,
  Bell,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  Eye,
  FileText,
  Hand,
  MapPin,
  MessageCircleQuestion,
  Repeat,
  ShieldAlert,
  Sparkles,
  Star,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { AppMode, AppNotification, NotificationKind } from "@/lib/domain/types";

const ICON: Partial<Record<NotificationKind, LucideIcon>> = {
  mechanic_interested: Hand,
  mechanic_question: MessageCircleQuestion,
  customer_question: MessageCircleQuestion,
  customer_answered: MessageCircleQuestion,
  new_quote: FileText,
  quote_updated: FileText,
  quote_viewed: Eye,
  quote_accepted: CheckCircle2,
  job_scheduled: CalendarClock,
  appointment_confirmed: CalendarCheck,
  upcoming_appointment: CalendarClock,
  job_reminder: CalendarClock,
  mechanic_checked_in: MapPin,
  repair_completed: Wrench,
  review_requested: Star,
  new_review: Star,
  new_opportunity: Sparkles,
  customer_rebooked: Repeat,
  verification_update: BadgeCheck,
  verification_expiring: ShieldAlert,
  diagnosis_shared: Wrench,
  scope_change_requested: FileText,
  scope_change_answered: CheckCircle2,
};
import { markNotificationsRead } from "@/app/actions/account";

function ago(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins || 1}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function Icon({ kind }: { kind: NotificationKind }) {
  const I = ICON[kind] ?? Bell;
  return <I size={17} aria-hidden />;
}

/** Role-aware notifications: this list only ever holds one mode's events. */
export function NotificationsList({ items, mode }: { items: AppNotification[]; mode: AppMode }) {
  const unread = items.filter((n) => !n.read).length;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-ink pb-4">
        <div>
          <h1 className="display text-[2rem]">Notifications</h1>
          <p className="mt-1 text-ink-2">{mode === "customer" ? "Updates on your requests and repairs." : "Requests, replies, bookings and reviews."}</p>
        </div>
        {unread ? (
          <form action={markNotificationsRead.bind(null, mode)}>
            <button className="btn btn-quiet min-h-11 text-sm">Mark all read</button>
          </form>
        ) : null}
      </div>
      <ul className="border-t border-rule">
        {items.map((n) => (
          <li key={n.id} className="border-b border-rule-soft">
            <Link href={n.href} className="flex gap-3 py-3.5 hover:bg-sheet sm:px-2">
              <span className="relative mt-0.5 shrink-0">
                <span className={`grid size-9 place-items-center border ${n.kind === "verification_expiring" ? "border-amber bg-amber-wash" : "border-rule bg-sheet"}`}>
                  <Icon kind={n.kind} />
                </span>
                {!n.read ? <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-brand ring-2 ring-paper" aria-label="Unread" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block ${n.read ? "text-ink-2" : "font-semibold text-ink"}`}>{n.title}</span>
                {n.body ? <span className="line-clamp-2 block text-[0.875rem] text-ink-2">{n.body}</span> : null}
              </span>
              <span className="tnum shrink-0 text-[0.75rem] text-ink-3">{ago(n.createdAt)}</span>
            </Link>
          </li>
        ))}
        {items.length === 0 && <li className="py-6 text-ink-3">Nothing yet. Updates on your requests and repairs appear here, in Clutch.</li>}
      </ul>
    </div>
  );
}
