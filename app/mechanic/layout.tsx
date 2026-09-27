import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { ExternalLink } from "lucide-react";
import { getRepo } from "@/lib/data";
import { getAccount, getAuthUser, getSession, needs } from "@/lib/session";
import { effectiveStatus } from "@/lib/verification/lifecycle";
import { Logo } from "@/components/brand/wordmark";
import { AccountMenu } from "@/components/app/account-menu";
import { StaffOnlyNotice } from "@/components/app/staff-only";
import { ModeSwitch, SwitchedToast } from "@/components/app/mode-switch";
import { BellLink, BottomNav, SideNav, type NavItem } from "@/components/app/nav";

/**
 * Mechanic Clutch: "Build your independent mechanic business."
 * Operational, information-dense shell with its own navigation.
 */
export default async function MechanicLayout({ children }: { children: React.ReactNode }) {
  const repo = await getRepo();
  const s = await getSession();
  const path = (await headers()).get("x-clutch-path") ?? "/mechanic";
  // A new mechanic account has no mechanic profile yet, so it resolves to "guest"; let it reach onboarding.
  const signedIn = s.role !== "guest" || (await getAccount()) !== null;
  if (!signedIn) {
    if (await getAuthUser()) redirect(`/welcome?next=${encodeURIComponent(path)}`);
    if (path.startsWith("/mechanic/onboarding")) redirect("/signup?role=mechanic");
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  if (s.role === "admin") return <StaffOnlyNotice name={s.name} area="mechanic" />;

  // Onboarding is open to signed-in accounts that don't have the mechanic role yet.
  if (s.role !== "mechanic") {
    if (path.startsWith("/mechanic/onboarding")) {
      return (
        <div className="min-h-dvh">
          <header className="bg-brand-night text-sheet">
            <div className="mx-auto flex h-14 max-w-[1100px] items-center px-4 sm:px-6">
              <Link href="/" aria-label="Clutch home" className="inline-flex min-h-11 items-center text-sheet">
                <Logo height={22} />
              </Link>
              <span className="ml-3 text-[0.8125rem] font-semibold text-[#a9bfb1]">for mechanics</span>
            </div>
          </header>
          <main className="mx-auto max-w-[1100px] px-4 py-8 sm:px-6">{children}</main>
        </div>
      );
    }
    redirect("/mechanic/onboarding");
  }

  const acct = (await getAccount())!;
  await (await needs(s)).mechanicShell();
  const m = repo.getMechanic(s.mechanicId)!;
  const unread = repo.listNotifications(s.userId, "mechanic").filter((n) => !n.read).length;
  const quotes = repo.listQuotesForMechanic(s.mechanicId);
  const openOpps = repo
    .listRequestsForMechanic(s.mechanicId)
    .filter((r) => (r.status === "open" || r.status === "quoted") && !r.declinedBy.includes(s.mechanicId) && !quotes.some((q) => q.requestId === r.id && q.status !== "draft")).length;
  const attention = repo
    .listVerifications({ mechanicId: s.mechanicId })
    .filter((v) => ["needs_info", "rejected", "expired", "reverification_required"].includes(effectiveStatus(v.status, v.expiresAt))).length;
  const activeJobs = repo.listJobsForMechanic(s.mechanicId).filter((j) => j.status === "scheduled" || j.status === "in_progress").length;
  const unansweredQuoteQs = quotes.reduce((n, q) => n + q.customerQuestions.filter((x) => !x.answer).length, 0);

  const side: NavItem[] = [
    { href: "/mechanic", label: "Home", icon: "home", exact: true },
    { href: "/mechanic/requests", label: "Repair Requests", icon: "briefcase", badge: openOpps || undefined },
    { href: "/mechanic/quotes", label: "Estimates", icon: "file", badge: unansweredQuoteQs || undefined },
    { href: "/mechanic/jobs", label: "Jobs", icon: "calendar", badge: activeJobs || undefined },
    { href: "/mechanic/customers", label: "Customers", icon: "users" },
    { href: "/mechanic/reputation", label: "Reputation", icon: "star" },
    { href: "/mechanic/verification", label: "Verification", icon: "badge", badge: attention || undefined },
    { href: "/mechanic/earnings", label: "Earnings", icon: "dollar" },
    { href: "/mechanic/profile", label: "Public Profile", icon: "profile" },
    { href: "/mechanic/settings", label: "Settings", icon: "settings" },
  ];
  const bottom: NavItem[] = [
    { href: "/mechanic", label: "Home", icon: "home", exact: true },
    { href: "/mechanic/requests", label: "Requests", icon: "briefcase", badge: openOpps || undefined },
    { href: "/mechanic/jobs", label: "Jobs", icon: "calendar" },
    { href: "/mechanic/customers", label: "Customers", icon: "users" },
    { href: "/mechanic/profile", label: "Profile", icon: "profile" },
  ];

  const switched = (await headers()).get("x-clutch-switched") === "mechanic" ? "mechanic" : "";
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <SwitchedToast mode={switched} />
      {/* Desktop operations sidebar */}
      <aside className="hidden bg-brand-night text-sheet lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
        <div className="px-5 pt-5 pb-4">
          <Link href="/mechanic" aria-label="Clutch mechanic home" className="text-sheet">
            <Logo height={22} />
          </Link>
          <p className="mt-1 text-[0.75rem] font-semibold tracking-[0.06em] text-[#a9bfb1] uppercase">Mechanic</p>
        </div>
        <div className="flex-1 overflow-y-auto px-2">
          <SideNav items={side} />
        </div>
        <div className="border-t border-brand-deep px-5 py-4">
          <p className="font-semibold">{m.displayName}</p>
          <Link href={`/mechanics/${m.slug}`} className="mt-0.5 inline-flex items-center gap-1 text-[0.8125rem] text-on-brand-2 hover:text-sheet">
            View my public profile <ExternalLink size={12} aria-hidden />
          </Link>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 border-b border-brand-deep bg-brand-night text-sheet lg:border-rule lg:bg-paper/95 lg:text-ink lg:backdrop-blur-sm">
          <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
            <Link href="/mechanic" aria-label="Clutch mechanic home" className="inline-flex min-h-11 items-center text-sheet lg:hidden">
              <Logo height={20} />
            </Link>
            <span className="hidden lg:block" />
            <div className="flex items-center gap-1">
              {acct.customer ? (
                <>
                  <span className="lg:hidden">
                    <ModeSwitch to="customer" tone="dark" />
                  </span>
                  <span className="hidden lg:block">
                    <ModeSwitch to="customer" />
                  </span>
                </>
              ) : null}
              <span className="lg:hidden">
                <BellLink href="/mechanic/notifications" unread={unread} tone="dark" />
              </span>
              <span className="hidden lg:block">
                <BellLink href="/mechanic/notifications" unread={unread} />
              </span>
              <span className="lg:hidden">
                <AccountMenu staff={s.roles.includes("admin")} name={s.name} mode="mechanic" hasCustomer={Boolean(acct.customer)} hasMechanic tone="dark" />
              </span>
              <span className="hidden lg:block">
                <AccountMenu staff={s.roles.includes("admin")} name={s.name} mode="mechanic" hasCustomer={Boolean(acct.customer)} hasMechanic />
              </span>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1180px] px-4 pt-6 pb-28 sm:px-6 lg:px-8 lg:pt-8 lg:pb-16">{children}</main>
      </div>
      <BottomNav items={bottom} tone="dark" />
    </div>
  );
}
