import { notFound } from "next/navigation";
import { demoLoginsEnabled } from "@/lib/supabase/config";
import type { Metadata } from "next";
import Link from "next/link";
import { ready, repo } from "@/lib/data";
import { getAccount } from "@/lib/session";
import { demoSignIn } from "@/app/actions/account";
import { SiteFooter, SiteHeader } from "@/components/site/site-header";

export const metadata: Metadata = { title: "Demo accounts" };

function Account({ userId, mode, title, detail, current }: { userId: string; mode: string; title: string; detail: string; current?: string }) {
  return (
    <form action={demoSignIn} className="contents">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="mode" value={mode} />
      <button type="submit" className={`grid w-full gap-0.5 border-b border-rule-soft px-1 py-3.5 text-left hover:bg-sheet ${current === userId ? "bg-sheet" : ""}`}>
        <span className="flex items-center justify-between gap-3">
          <span className="font-semibold text-ink">{title}</span>
          <span className="text-[0.8125rem] text-ink-3">{current === userId ? "Signed in" : `Sign in as ${mode}`}</span>
        </span>
        <span className="text-[0.875rem] text-ink-2">{detail}</span>
      </button>
    </form>
  );
}

export default async function DemoPage() {
  await ready();
  if (!demoLoginsEnabled()) notFound();
  const acct = await getAccount();
  const mechanics = repo.listPublicProfiles();
  const current = acct?.user.id;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[760px] px-4 pt-10 sm:px-6">
        <h1 className="display text-[2.5rem]">Demo accounts</h1>
        <p className="mt-3 max-w-[60ch] text-ink-2">
          Shared sample accounts with fictional data, for trying Clutch without signing up. Anyone can use them, so don&apos;t enter anything real. One login can hold both roles;
          Derek is set up that way, so you can switch between his mechanic and customer modes.
        </p>

        <h2 className="field-label mt-10">Customer app</h2>
        <div className="mt-2 border-t border-rule">
          <Account current={current} userId="user-maya" mode="customer" title="Maya Chen" detail="2017 BMW 330i with an open brake request, three estimates and a question waiting." />
          <Account current={current} userId="user-derek-hall" mode="customer" title="Derek Hall (customer mode)" detail="Same login as mechanic Derek, hiring help for his own truck." />
        </div>

        <h2 className="field-label mt-10">Mechanic app</h2>
        <div className="mt-2 border-t border-rule">
          {mechanics.map((m) => (
            <Account
              key={m.id}
              current={current}
              userId={repo.getMechanic(m.id)!.userId}
              mode="mechanic"
              title={m.displayName}
              detail={`${m.reputation.verifiedRepairs} verified repairs · ${m.city}${m.slug === "derek-hall" ? " · primary demo, also has customer mode" : m.slug === "marcus-webb" ? " · new, verification in progress" : m.slug === "luis-romero" ? " · proof from customer confirmations" : ""}`}
            />
          ))}
        </div>

        <h2 className="field-label mt-10">Clutch staff</h2>
        <div className="mt-2 border-t border-rule">
          <Account current={current} userId="user-admin" mode="admin" title="Verification reviewer" detail="Approve, reject or request more information on submitted evidence." />
        </div>

        <h2 className="field-label mt-12">Also try</h2>
        <ul className="mt-2 space-y-2 text-[0.9375rem]">
          <li>
            <Link className="link" href="/signup">Sign up as a new customer or mechanic</Link>
          </li>
          <li>
            <Link className="link" href="/mechanics/derek-hall?repair=brakes&make=BMW">A public profile opened from a BMW brake-job link</Link>
          </li>
          <li>
            <Link className="link" href="/mechanics/derek-hall?variant=low">The low-evidence experiment arm</Link>
          </li>
          <li>
            <Link className="link" href="/confirm/derek-c300">A past customer confirming a repair</Link>
          </li>
        </ul>
      </main>
      <SiteFooter />
    </>
  );
}
