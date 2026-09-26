import type { Metadata } from "next";
import Link from "next/link";
import { demoSignIn, resendConfirmation, signInWithPassword } from "@/app/actions/account";
import { ready, repo } from "@/lib/data";
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
  link_expired: "That link has expired or was already used. Try again.",
  google_failed: "Google sign-in didn't work. Try again.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; email?: string; error?: string; exists?: string; reset?: string }> }) {
  await ready();
  const sp = await searchParams;
  const auth = authConfigured();
  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule">
        <div className="mx-auto flex h-14 max-w-[560px] items-center justify-between px-4">
          <Wordmark />
          <Link href="/signup" className="text-[0.9375rem] font-semibold hover:underline">
            Sign up
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-[560px] px-4 pt-10 pb-20">
        <h1 className="display text-[2.25rem]">Log in</h1>
        {sp.exists ? <p className="mt-3 border border-ink bg-sheet px-3 py-2 text-[0.9375rem]">You already have an account with that email. Log in below.</p> : null}
        {sp.reset ? <p className="mt-3 border border-ink bg-sheet px-3 py-2 text-[0.9375rem]">Password updated. Log in with your new password.</p> : null}
        {sp.error ? <p className="mt-3 border border-alert bg-alert-wash px-3 py-2 text-[0.9375rem]" role="alert">{ERRORS[sp.error] ?? ERRORS.unknown}</p> : null}
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
              <button className="btn btn-ink min-h-12 w-full">Log in</button>
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

function DemoAccounts({ next }: { next?: string }) {
  const derek = repo.getUser("user-derek-hall");
  const maya = repo.getUser("user-maya");
  const demo = [
    { id: "user-maya", mode: "customer", title: "Maya Chen", detail: "Customer · BMW brake request with three estimates" },
    { id: "user-derek-hall", mode: "mechanic", title: "Derek Hall", detail: "Mechanic and customer · one login, both modes" },
    { id: "user-marcus-webb", mode: "mechanic", title: "Marcus Webb", detail: "New mechanic · verification in progress" },
    { id: "user-admin", mode: "admin", title: "Verification reviewer", detail: "Clutch staff · review queue" },
  ];
  return (
    <section>
      <h2 className="field-label mt-12">Or look around with a demo account</h2>
      <p className="mt-1 text-[0.8125rem] text-ink-3">Shared sample accounts with fictional data. Anyone can use them, so don&apos;t enter anything real.</p>
      <div className="mt-2 border-t border-rule">
        {demo
          .filter((d) => (d.id === "user-derek-hall" ? derek : d.id === "user-maya" ? maya : true))
          .map((d) => (
            <form key={d.id} action={demoSignIn}>
              <input type="hidden" name="userId" value={d.id} />
              <input type="hidden" name="mode" value={d.mode} />
              <input type="hidden" name="next" value={next ?? ""} />
              <button className="grid w-full gap-0.5 border-b border-rule-soft px-1 py-3.5 text-left hover:bg-sheet">
                <span className="font-semibold">{d.title}</span>
                <span className="text-[0.875rem] text-ink-2">{d.detail}</span>
              </button>
            </form>
          ))}
      </div>
      <p className="mt-4 text-[0.875rem]">
        <Link href="/demo" className="link">
          All demo accounts
        </Link>
      </p>
    </section>
  );
}
