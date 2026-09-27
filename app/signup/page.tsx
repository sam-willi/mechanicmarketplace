import { VehicleFields } from "@/components/app/vehicle-form";
import type { Metadata } from "next";
import Link from "next/link";
import { SubmitButton } from "@/components/auth/submit-button";
import { getAccount } from "@/lib/session";
import { homeFor } from "@/lib/auth/provision";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, Car, Wrench } from "lucide-react";
import { exitDemoToSignup, signUpWithPassword } from "@/app/actions/account";
import { requestScope } from "@/lib/data";
import { Wordmark } from "@/components/brand/wordmark";
import { GoogleButton, OrDivider } from "@/components/auth/google-button";
import { authConfigured, demoLoginsEnabled } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Sign up" };

const SIGNUP_ERRORS: Record<string, string> = {
  missing: "Name and email are required.",
  missing_phone: "Mechanics need a mobile number so customers and Clutch can reach you about jobs.",
  weak_password: "Use a password with at least 8 characters.",
  exists: "There's already an account with that email. Log in instead, or reset your password.",
  bad_email: "That email address doesn't look right. Check it and try again.",
  too_many: "Too many attempts. Wait a few minutes and try again.",
  unavailable: "We couldn't reach the sign-up service. Check your connection and try again.",
  signup_closed: "New sign-ups are paused right now. Try again later.",
  signup_failed: "We couldn't create your account. Try again.",
};

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ role?: string; next?: string; error?: string; email?: string; name?: string }> }) {
  const sp = await searchParams;
  // Already signed in to a real account: go to it rather than sign up twice.
  const acct = await getAccount();
  if (acct && !acct.user.demo) redirect(homeFor(acct.user, sp.next));
  // Coming from the customer app (e.g. a car search), they're here as a customer.
  const role = sp.role === "mechanic" ? "mechanic" : sp.role === "customer" || sp.next?.startsWith("/customer") ? "customer" : null;
  // Opened from the demo: a real account is never created inside the demo shell. Leave it first.
  if ((await requestScope()) === "demo") return <LeaveDemoFirst role={role} next={sp.next} />;

  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule">
        <div className="mx-auto flex h-14 max-w-[640px] items-center justify-between px-4">
          <Wordmark />
          <Link href={`/login${sp.next ? `?next=${encodeURIComponent(sp.next)}` : ""}`} className="text-[0.9375rem] font-semibold hover:underline">
            Log in
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-[640px] px-4 pt-10 pb-20">
        {!role ? (
          <>
            <h1 className="display text-[2.25rem] sm:text-[2.75rem]">How do you want to use Clutch?</h1>
            <p className="mt-2 text-ink-2">One account works for both. You can add the other later.</p>
            <div className="mt-8 grid gap-3">
              <Link href={`/signup?role=customer${sp.next ? `&next=${encodeURIComponent(sp.next)}` : ""}`} className="group sheet flex items-center gap-4 p-5 hover:border-ink">
                <span className="grid size-12 shrink-0 place-items-center bg-paper">
                  <Car size={24} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="heading block text-[1.375rem]">I need a mechanic</span>
                  <span className="mt-0.5 block text-[0.9375rem] text-ink-2">Find a mechanic for your car and see what Clutch has verified about them.</span>
                </span>
                <ArrowRight size={20} className="shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
              <Link href="/signup?role=mechanic" className="group flex items-center gap-4 bg-brand-deep p-5 text-sheet">
                <span className="grid size-12 shrink-0 place-items-center bg-brand-deep">
                  <Wrench size={24} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="heading block text-[1.375rem] text-sheet">I&apos;m a mechanic</span>
                  <span className="mt-0.5 block text-[0.9375rem] text-on-brand-2">Build your independent business with proof of your work.</span>
                </span>
                <ArrowRight size={20} className="shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </div>
          </>
        ) : (
          <>
            <Link href="/signup" className="inline-flex items-center gap-1.5 text-[0.875rem] text-ink-3 hover:text-ink">
              <ArrowLeft size={14} aria-hidden /> Change
            </Link>
            <h1 className="display mt-3 text-[2.25rem]">{role === "customer" ? "Create your account" : "Join as a mechanic"}</h1>
            <p className="mt-2 text-ink-2">
              {role === "customer"
                ? "Just the basics. You can search and post a request right after."
                : "Start with your contact details. Next you'll build your profile: services, pricing, experience and verification."}
            </p>
            {sp.error ? (
              <p className="mt-4 border border-alert bg-alert-wash px-3 py-2 text-[0.9375rem]" role="alert">
                {SIGNUP_ERRORS[sp.error] ?? SIGNUP_ERRORS.signup_failed}
              </p>
            ) : null}
            {!authConfigured() ? (
              <p className="mt-6 border border-rule bg-sheet px-3 py-2 text-[0.9375rem] text-ink-2">
                Sign-up isn&apos;t set up on this server yet.{" "}
                {demoLoginsEnabled() ? (
                  <>
                    <Link href="/demo" className="link">Try a demo account</Link> instead.
                  </>
                ) : null}
              </p>
            ) : (
              <>
                <div className="mt-6">
                  <GoogleButton role={role} next={sp.next} label="Sign up with Google" />
                </div>
                <OrDivider />
              </>
            )}
            <form action={signUpWithPassword} className={`space-y-4 ${authConfigured() ? "" : "hidden"}`}>
              <input type="hidden" name="role" value={role} />
              <input type="hidden" name="next" value={sp.next ?? ""} />
              <label className="block">
                <span className="field-label">Full name</span>
                <input name="name" required autoComplete="name" defaultValue={sp.name} className="input mt-1" />
              </label>
              <label className="block">
                <span className="field-label">Email</span>
                <input name="email" type="email" required autoComplete="email" defaultValue={sp.email} className="input mt-1" />
              </label>
              <label className="block">
                <span className="field-label">Password</span>
                <input name="password" type="password" required minLength={8} autoComplete="new-password" className="input mt-1" />
                <span className="mt-1 block text-[0.8125rem] text-ink-3">At least 8 characters.</span>
              </label>
              <label className="block">
                <span className="field-label">Mobile phone {role === "customer" ? "(optional)" : ""}</span>
                <input name="phone" type="tel" required={role === "mechanic"} autoComplete="tel" className="input mt-1" />
                <span className="mt-1 block text-[0.8125rem] text-ink-3">For updates about your {role === "customer" ? "requests" : "jobs"}. Never shown publicly.</span>
              </label>
              {role === "customer" && (
                <details className="sheet p-4">
                  <summary className="cursor-pointer font-semibold">Add your car now (optional)</summary>
                  <p className="mt-2 text-[0.875rem] text-ink-2">Year first, then make and model; the engine and transmission options narrow to what your car could have. After you sign in, adding your VIN confirms it exactly.</p>
                  <div className="mt-3">
                    <VehicleFields showVin={false} />
                  </div>
                </details>
              )}
              <SubmitButton className="btn btn-ink min-h-12 w-full text-[1rem]" pending="Creating your account…">
                {role === "customer" ? "Create account" : "Continue to your profile"}
              </SubmitButton>
              <p className="text-center text-[0.8125rem] text-ink-3">We&apos;ll email you a link to confirm your address.</p>
            </form>
          </>
        )}
      </main>
    </div>
  );
}

/** Shown instead of the sign-up form while this browser is in the demo marketplace. */
function LeaveDemoFirst({ role, next }: { role: "customer" | "mechanic" | null; next?: string }) {
  return (
    <main className="mx-auto max-w-[520px] px-4 pt-14 pb-16">
      <p className="flex items-center gap-2 text-[0.8125rem] font-semibold text-ink-3">
        <span className="border border-ink-3 px-1.5 text-[0.6875rem] font-extrabold tracking-[0.08em] uppercase">Demo</span>
        You&apos;re in the demo
      </p>
      <h1 className="display mt-2 text-[2rem]">Create a real account</h1>
      <p className="mt-3 text-ink-2">
        Real accounts are separate from the demo: they use your own email, and nothing from the demo comes with you. Leave the demo to continue.
      </p>
      <form action={exitDemoToSignup} className="mt-6">
        <input type="hidden" name="role" value={role ?? ""} />
        <input type="hidden" name="next" value={next ?? ""} />
        <SubmitButton className="btn btn-ink min-h-12 w-full text-[1rem]" pending="Leaving the demo…">
          Leave the demo and sign up
        </SubmitButton>
      </form>
      <Link href="/demo" className="btn btn-quiet mt-2 min-h-11 w-full">
        Stay in the demo
      </Link>
    </main>
  );
}
