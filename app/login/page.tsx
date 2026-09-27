import type { Metadata } from "next";
import Link from "next/link";
import { SubmitButton } from "@/components/auth/submit-button";
import { getAccount } from "@/lib/session";
import { homeFor } from "@/lib/auth/provision";
import { redirect } from "next/navigation";
import { demoSignIn, resendConfirmation, signInWithPassword } from "@/app/actions/account";
import { readyRepo } from "@/lib/data";
import { Wordmark } from "@/components/brand/wordmark";
import { GoogleButton, OrDivider } from "@/components/auth/google-button";
import { authConfigured, demoLoginsEnabled } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Log in" };

const ERRORS: Record<string, string> = {
  invalid: "That email and password don't match. Check them, or reset your password.",
  unconfirmed: "Confirm your email first. We sent you a link when you signed up.",
  unknown: "That demo account doesn't exist.",
  unavailable: "We couldn't reach the sign-in service. Try again in a moment.",
  auth_unconfigured: "Sign-in isn't set up on this server yet.",
  auth_cancelled: "Sign-in was cancelled.",
  link_expired: "That link has expired or was already used. Log in, or request a new link.",
  confirmed_login: "Your email is confirmed. Log in to continue.",
  too_many: "Too many attempts. Wait a few minutes and try again.",
  google_failed: "Google sign-in didn't work. Try again.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; email?: string; error?: string; exists?: string; reset?: string }> }) {
  const sp = await searchParams;
  const auth = authConfigured();
  // Already signed in to a real account: take them where they were going.
  const acct = await getAccount();
  if (acct && !acct.user.demo) redirect(homeFor(acct.user, sp.next));
  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule">
        <div className="mx-auto flex h-14 max-w-[560px] items-center justify-between px-4">
          <Wordmark />
          <Link href={`/signup${sp.next ? `?next=${encodeURIComponent(sp.next)}` : ""}`} className="text-[0.9375rem] font-semibold hover:underline">
            Sign up
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-[560px] px-4 pt-10 pb-20">
        <h1 className="display text-[2.25rem]">Log in</h1>
        {sp.next?.startsWith("/customer/mechanics") ? <p className="mt-2 text-ink-2">Log in or create an account to see mechanics for your car.</p> : null}
        {sp.exists ? <p className="mt-3 border border-ink bg-sheet px-3 py-2 text-[0.9375rem]">You already have an account with that email. Log in below.</p> : null}
        {sp.reset ? <p className="mt-3 border border-ink bg-sheet px-3 py-2 text-[0.9375rem]">Password updated. Log in with your new password.</p> : null}
        {sp.error === "confirmed_login" ? (
          <p className="mt-3 border border-go bg-go-wash px-3 py-2 text-[0.9375rem]" role="status">
            {ERRORS.confirmed_login}
          </p>
        ) : sp.error ? (
          <p className="mt-3 border border-alert bg-alert-wash px-3 py-2 text-[0.9375rem]" role="alert">
            {ERRORS[sp.error] ?? ERRORS.unknown}
          </p>
        ) : null}
        {!auth ? (
          <p className="mt-6 border border-rule bg-sheet px-3 py-2 text-[0.9375rem] text-ink-2">Sign-in isn&apos;t set up on this server yet.{demoLoginsEnabled() ? " You can still look around with a demo account below." : ""}</p>
        ) : (
          <>
            <div className="mt-6">
              <GoogleButton next={sp.next} />
            </div>
            <OrDivider />
            <form action={signInWithPassword} className="space-y-3">
              <input type="hidden" name="next" value={sp.next ?? ""} />
              <label className="block">
                <span className="field-label">Email</span>
                <input name="email" type="email" required defaultValue={sp.email} autoComplete="email" className="input mt-1" />
              </label>
              <label className="block">
                <span className="flex items-baseline justify-between">
                  <span className="field-label">Password</span>
                  <Link href={`/forgot-password${sp.email ? `?email=${encodeURIComponent(sp.email)}` : ""}`} className="text-[0.8125rem] underline decoration-rule underline-offset-2 hover:decoration-ink">
                    Forgot password?
                  </Link>
                </span>
                <input name="password" type="password" required autoComplete="current-password" className="input mt-1" />
              </label>
              <SubmitButton pending="Logging in…">Log in</SubmitButton>
            </form>
            {sp.error === "unconfirmed" && sp.email ? (
              <form action={resendConfirmation} className="mt-3">
                <input type="hidden" name="email" value={sp.email} />
                <button className="text-[0.875rem] font-semibold underline decoration-rule underline-offset-2">Send the confirmation email again</button>
              </form>
            ) : null}
            <p className="mt-6 text-[0.9375rem] text-ink-2">
              New to Clutch?{" "}
              <Link href={`/signup${sp.next ? `?next=${encodeURIComponent(sp.next)}` : ""}`} className="font-semibold underline decoration-rule underline-offset-2">
                Create an account
              </Link>
            </p>
          </>
        )}

        {demoLoginsEnabled() ? <DemoAccounts next={sp.next} /> : null}
      </main>
    </div>
  );
}

async function DemoAccounts({ next }: { next?: string }) {
  // The chooser lists accounts from the demo store only; each must exist there and be flagged demo.
  const repo = await readyRepo("demo");
  const demo = [
    { id: "user-maya", mode: "customer", title: "Maya Chen", detail: "Customer · BMW brake request with three estimates" },
    { id: "user-derek-hall", mode: "mechanic", title: "Derek Hall", detail: "Mechanic · requests, estimates and a booked job" },
  ];
  return (
    <section aria-labelledby="demo-title" className="mt-14 border border-dashed border-rule bg-paper px-4 pt-3 pb-4">
      <h2 id="demo-title" className="flex items-center gap-2 text-[0.9375rem] font-semibold text-ink-2">
        <span className="border border-ink-3 px-1.5 text-[0.6875rem] font-extrabold tracking-[0.08em] text-ink-3 uppercase">Demo</span>
        Demo accounts · testing only
      </h2>
      <p className="mt-1 text-[0.8125rem] text-ink-3">Shared sample accounts with fictional data, for trying both sides of Clutch. Not your account: anyone can use these, so don&apos;t enter anything real.</p>
      <div className="mt-2 border-t border-rule-soft">
        {demo
          .filter((d) => repo.getUser(d.id)?.demo)
          // The reviewer can't open customer or mechanic pages, so don't offer it on the way to one.
          .filter((d) => d.mode !== "admin" || !(next?.startsWith("/customer") || next?.startsWith("/mechanic")))
          .map((d) => (
            <form key={d.id} action={demoSignIn}>
              <input type="hidden" name="userId" value={d.id} />
              <input type="hidden" name="mode" value={d.mode} />
              <input type="hidden" name="next" value={next ?? ""} />
              <button className="grid w-full gap-0.5 border-b border-rule-soft px-1 py-2.5 text-left hover:bg-sheet">
                <span className="text-[0.9375rem] font-semibold text-ink-2">{d.title}</span>
                <span className="text-[0.8125rem] text-ink-3">{d.detail}</span>
              </button>
            </form>
          ))}
      </div>
      <p className="mt-3 text-[0.8125rem]">
        <Link href="/demo" className="link text-ink-2">
          More demo scenarios
        </Link>
      </p>
    </section>
  );
}
