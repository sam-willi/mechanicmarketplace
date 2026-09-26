import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getRepo } from "@/lib/data";
import { getAccount, getAuthUser, getSession, needs } from "@/lib/session";
import { addCustomerRole } from "@/app/actions/account";
import { Wordmark } from "@/components/brand/wordmark";
import { AccountMenu } from "@/components/app/account-menu";
import { StaffOnlyNotice } from "@/components/app/staff-only";
import { ModeSwitch, SwitchedToast } from "@/components/app/mode-switch";
import { BellLink, BottomNav, TopNav, type NavItem } from "@/components/app/nav";
import { needsNewMechanic } from "@/lib/domain/status";

/**
 * Customer Clutch: "Find someone you trust to fix your car."
 * Calm, low-density shell. No mechanic-business features live here.
 */
export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const repo = await getRepo();
  const s = await getSession();
  const path = (await headers()).get("x-clutch-path") ?? "/customer";
  const switched = (await headers()).get("x-clutch-switched") === "customer" ? "customer" : "";
  if (s.role === "guest" && !(await getAccount())) {
    if (await getAuthUser()) redirect(`/welcome?next=${encodeURIComponent(path)}`);
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  if (s.role === "admin") return <StaffOnlyNotice name={s.name} area="customer" />;
  const acct = (await getAccount())!;

  if (s.role !== "customer") {
    return (
      <div className="min-h-dvh">
        <header className="border-b border-rule">
          <div className="mx-auto flex h-14 max-w-[1100px] items-center px-4 sm:px-6">
            <Wordmark href="/mechanic" />
          </div>
        </header>
        <main className="mx-auto max-w-[560px] px-4 py-20 text-center">
          <h1 className="display text-[2rem]">Hire a mechanic for your own car?</h1>
          <p className="mt-3 text-ink-2">Your Clutch account is set up as a mechanic. Add customer mode to the same login to post repair requests and book other mechanics.</p>
          <form action={addCustomerRole} className="mt-6">
            <button className="btn btn-ink">Add customer mode</button>
          </form>
          <Link href="/mechanic" className="mt-4 inline-block text-[0.875rem] underline decoration-rule underline-offset-2">
            Back to your mechanic dashboard
          </Link>
        </main>
      </div>
    );
  }

  await (await needs(s)).customerShell();
  const unread = repo.listNotifications(s.userId, "customer").filter((n) => !n.read).length;
  // Requests that need the customer: new estimates to compare, or a pick who couldn't take it.
  const needsYou = repo
    .listRequestsForCustomer(s.customerId)
    .filter((r) => r.status === "open" || r.status === "quoted")
    .filter((r) => {
      const q = repo.listQuotesForRequest(r.id);
      return q.some((x) => x.status === "submitted") || needsNewMechanic(r, q);
    }).length;

  // Four destinations. Vehicles, saved mechanics and notifications live in the account menu.
  const nav: NavItem[] = [
    { href: "/customer", label: "Home", icon: "home", exact: true },
    { href: "/customer/mechanics", label: "Find", icon: "search" },
    { href: "/customer/requests", label: "Requests", icon: "inbox", badge: needsYou || undefined },
    { href: "/customer/jobs", label: "Repairs", icon: "wrench" },
  ];

  return (
    <div className="min-h-dvh">
      <SwitchedToast mode={switched} />
      <header className="sticky top-0 z-30 border-b border-rule bg-paper/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-[1100px] items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Wordmark href="/customer" />
            <TopNav items={nav} />
          </div>
          <div className="flex items-center gap-1">
            {acct.mechanic ? <ModeSwitch to="mechanic" /> : null}
            <BellLink href="/customer/notifications" unread={unread} />
            <AccountMenu staff={s.roles.includes("admin")} name={s.name} mode="customer" hasCustomer hasMechanic={Boolean(acct.mechanic)} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1100px] px-4 pt-6 pb-28 sm:px-6 sm:pt-10 lg:pb-20">{children}</main>
      <BottomNav items={nav} hideOn={["/customer/requests/new"]} />
    </div>
  );
}
