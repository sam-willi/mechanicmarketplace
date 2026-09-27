"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeCheck,
  Bell,
  Briefcase,
  CalendarClock,
  Car,
  DollarSign,
  FileText,
  Heart,
  Home,
  Inbox,
  type LucideIcon,
  Search,
  Settings,
  Star,
  User,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  home: Home,
  search: Search,
  inbox: Inbox,
  file: FileText,
  wrench: Wrench,
  heart: Heart,
  car: Car,
  user: User,
  briefcase: Briefcase,
  calendar: CalendarClock,
  users: Users,
  star: Star,
  badge: BadgeCheck,
  dollar: DollarSign,
  profile: UserRound,
  settings: Settings,
  bell: Bell,
};

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number; exact?: boolean };

function isActive(path: string, item: NavItem) {
  return item.exact ? path === item.href : path === item.href || path.startsWith(`${item.href}/`);
}

/** Customer desktop nav: a quiet row of text links. */
export function TopNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Customer" className="hidden items-center gap-1 lg:flex">
      {items.map((it) => {
        const on = isActive(path, it);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={on ? "page" : undefined}
            className={`relative px-3 py-2 text-[0.9375rem] whitespace-nowrap ${on ? "font-bold text-ink" : "text-ink-2 hover:text-ink"}`}
          >
            {it.label}
            {it.badge ? <span className="tnum ml-1.5 bg-brass px-1.5 text-[0.6875rem] font-extrabold text-brand-night">{it.badge}</span> : null}
            {on ? <span className="absolute inset-x-3 -bottom-[13px] h-[2px] bg-brand" aria-hidden /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** Mechanic desktop nav: a dense, dark operations sidebar. */
export function SideNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Mechanic" className="space-y-px">
      {items.map((it) => {
        const on = isActive(path, it);
        const Icon = ICONS[it.icon];
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={on ? "page" : undefined}
            className={`flex items-center gap-3 px-3 py-2.5 text-[0.9375rem] ${on ? "bg-brand-deep font-bold text-sheet" : "text-on-brand-2 hover:bg-brand-deep/60 hover:text-sheet"}`}
          >
            <Icon size={17} strokeWidth={1.9} aria-hidden />
            <span className="flex-1">{it.label}</span>
            {it.badge ? <span className="tnum min-w-5 bg-brass px-1.5 text-center text-[0.6875rem] font-extrabold text-brand-night">{it.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** Role-specific phone navigation, pinned to the bottom. */
export function BottomNav({ items, tone = "light", hideOn = [], until = "lg" }: { items: NavItem[]; tone?: "light" | "dark"; hideOn?: string[]; until?: "lg" | "xl" }) {
  const path = usePathname();
  const dark = tone === "dark";
  // Full-screen flows (the repair request) own the bottom of the screen.
  if (hideOn.some((p) => path.startsWith(p))) return null;
  return (
    <nav
      aria-label="Primary"
      className={`fixed inset-x-0 bottom-0 z-40 grid border-t pb-[env(safe-area-inset-bottom)] ${until === "xl" ? "xl:hidden" : "lg:hidden"} ${dark ? "border-brand-deep bg-brand" : "border-rule bg-sheet"}`}
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((it) => {
        const on = isActive(path, it);
        const Icon = ICONS[it.icon];
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={on ? "page" : undefined}
            className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-semibold ${
              dark ? (on ? "text-sheet" : "text-[#a9bfb1]") : on ? "text-ink" : "text-ink-3"
            }`}
          >
            <Icon size={21} strokeWidth={on ? 2.3 : 1.8} aria-hidden />
            {it.label}
            {it.badge ? (
              <span className={`tnum absolute top-1.5 left-[calc(50%+6px)] min-w-4 px-1 text-center text-[0.625rem] font-extrabold bg-brass text-brand-night`}>{it.badge}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function BellLink({ href, unread, tone = "light" }: { href: string; unread: number; tone?: "light" | "dark" }) {
  return (
    <Link href={href} className={`relative grid size-11 place-items-center ${tone === "dark" ? "text-sheet" : "text-ink"}`} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
      <Bell size={20} strokeWidth={1.9} aria-hidden />
      {unread ? <span className={`tnum absolute top-1 right-0.5 min-w-4 px-1 text-center text-[0.625rem] font-extrabold bg-brass text-brand-night`}>{unread}</span> : null}
    </Link>
  );
}
