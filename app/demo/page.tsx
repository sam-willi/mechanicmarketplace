import { notFound } from "next/navigation";
import { demoLoginsEnabled } from "@/lib/supabase/config";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { readyRepo } from "@/lib/data";
import { getAccount } from "@/lib/session";
import { demoSignIn, enterDemo } from "@/app/actions/account";
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

/** One of the two main demo accounts: who, which side, and what you can try, as one big button. */
function Primary({ userId, mode, who, role, what, current }: { userId: string; mode: string; who: string; role: string; what: string; current?: string }) {
  return (
    <form action={demoSignIn}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="mode" value={mode} />
      <button type="submit" className="grid h-full w-full gap-1 border-2 border-ink bg-sheet p-4 text-left hover:bg-paper">
        <span className="text-[0.8125rem] font-bold text-ink-2">{role}</span>
        <span className="heading text-[1.25rem] text-ink">{who}</span>
        <span className="text-[0.9375rem] text-ink-2">{what}</span>
        <span className="mt-2 inline-flex items-center gap-1 font-semibold text-ink">
          {current === userId ? "Signed in: open" : "Sign in"} <ArrowRight size={16} aria-hidden />
        </span>
      </button>
    </form>
  );
}

/** Opens a page inside the demo marketplace (sets the demo scope first). */
function DemoLink({ next, children }: { next: string; children: React.ReactNode }) {
  return (
    <form action={enterDemo} className="contents">
      <input type="hidden" name="next" value={next} />
      <button type="submit" className="link text-left">
        {children}
      </button>
    </form>
  );
}

export default async function DemoPage() {
  if (!demoLoginsEnabled()) notFound();
  // The chooser lists the demo store's accounts, whichever marketplace this browser is in now.
  const repo = await readyRepo("demo");
  const acct = await getAccount();
  const mechanics = repo.listPublicProfiles();
  const current = acct?.user.id;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[760px] px-4 pt-10 sm:px-6">
        <p className="flex items-center gap-2 text-[0.8125rem] font-semibold text-ink-3">
          <span className="border border-ink-3 px-1.5 text-[0.6875rem] font-extrabold tracking-[0.08em] uppercase">Demo</span>
          Fictional data, kept apart from real accounts
        </p>
        <h1 className="display mt-2 text-[2.25rem] sm:text-[2.5rem]">Try Clutch as…</h1>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Primary current={current} userId="user-maya" mode="customer" who="Maya Chen" role="A customer" what="Compare three estimates for her BMW's brakes, and book one." />
          <Primary current={current} userId="user-derek-hall" mode="mechanic" who="Derek Hall" role="A mechanic" what="Answer repair requests, send an estimate, and run a booked job." />
        </div>

        <details className="group mt-8 border-t border-rule">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-2 font-semibold [&::-webkit-details-marker]:hidden">
            More demo scenarios
            <ChevronDown size={18} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <p className="max-w-[60ch] text-[0.875rem] text-ink-2">Other accounts in the same fictional marketplace. Anyone can use them, so don&apos;t enter anything real.</p>
          <h2 className="field-label mt-5">Customers</h2>
          <div className="mt-2 border-t border-rule">
            <Account current={current} userId="user-derek-hall" mode="customer" title="Derek Hall (customer mode)" detail="One login, both roles: Derek hiring help for his own truck." />
          </div>
          <h2 className="field-label mt-6">Mechanics</h2>
          <div className="mt-2 border-t border-rule">
            {mechanics
              .filter((m) => m.slug !== "derek-hall")
              .map((m) => (
                <Account
                  key={m.id}
                  current={current}
                  userId={repo.getMechanic(m.id)!.userId}
                  mode="mechanic"
                  title={m.displayName}
                  detail={`${m.reputation.verifiedRepairs} verified repairs · ${m.city}${m.slug === "marcus-webb" ? " · new, verification in progress" : m.slug === "luis-romero" ? " · proof from customer confirmations" : ""}`}
                />
              ))}
          </div>
          <h2 className="field-label mt-6">Clutch staff</h2>
          <div className="mt-2 border-t border-rule">
            <Account current={current} userId="user-admin" mode="admin" title="Verification reviewer" detail="Approve, reject or ask for more on submitted evidence." />
          </div>
          <h2 className="field-label mt-6">Without an account</h2>
          <ul className="mt-2 space-y-2 pb-4 text-[0.9375rem]">
            <li>
              <DemoLink next="/mechanics">Browse the demo marketplace</DemoLink>
            </li>
            <li>
              <DemoLink next="/mechanics/derek-hall?repair=brakes&make=BMW">A profile opened from a BMW brake-job link</DemoLink>
            </li>
            <li>
              <DemoLink next="/mechanics/derek-hall?variant=low">The low-evidence experiment arm</DemoLink>
            </li>
            <li>
              <DemoLink next="/confirm/derek-c300">A past customer confirming a repair</DemoLink>
            </li>
          </ul>
        </details>

        <section aria-labelledby="real-title" className="mt-10 border-2 border-ink bg-sheet p-5">
          <h2 id="real-title" className="heading text-[1.25rem]">
            Using Clutch for real?
          </h2>
          <p className="mt-1 text-[0.9375rem] text-ink-2">Real accounts are separate from the demo: nothing you do there is fictional.</p>
          <Link href="/signup" className="btn btn-line mt-3 min-h-11">
            Create a real account
          </Link>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
