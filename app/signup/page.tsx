import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Car, Wrench } from "lucide-react";
import { signUpWithPassword } from "@/app/actions/account";
import { VEHICLE_MAKES } from "@/lib/domain/types";
import { MODEL_YEARS } from "@/lib/domain/intake";
import { Wordmark } from "@/components/brand/wordmark";
import { GoogleButton, OrDivider } from "@/components/auth/google-button";
import { authConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Sign up" };

const SIGNUP_ERRORS: Record<string, string> = {
  missing: "Name and email are required.",
  missing_phone: "Mechanics need a mobile number so customers and Clutch can reach you about jobs.",
  weak_password: "Use a password with at least 8 characters.",
  exists: "There's already an account with that email. Log in instead.",
  signup_failed: "We couldn't create your account. Try again.",
};

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ role?: string; next?: string; error?: string; email?: string; name?: string }> }) {
  const sp = await searchParams;
  const role = sp.role === "mechanic" ? "mechanic" : sp.role === "customer" ? "customer" : null;

  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule">
        <div className="mx-auto flex h-14 max-w-[640px] items-center justify-between px-4">
          <Wordmark />
          <Link href="/login" className="text-[0.9375rem] font-semibold hover:underline">
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
                  <span className="mt-0.5 block text-[0.9375rem] text-ink-2">Find someone you can trust to fix your car.</span>
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
                Sign-up isn&apos;t set up on this server yet. <Link href="/demo" className="link">Try a demo account</Link> instead.
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
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <select name="year" className="input tnum" aria-label="Year" defaultValue="">
                      <option value="">Year</option>
                      {MODEL_YEARS.map((y) => (
                        <option key={y}>{y}</option>
                      ))}
                    </select>
                    <select name="make" className="input" aria-label="Make" defaultValue="">
                      <option value="">Make</option>
                      {VEHICLE_MAKES.map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                    <input name="model" className="input" placeholder="Model" aria-label="Model" />
                    <input name="mileage" inputMode="numeric" className="input tnum" placeholder="Mileage" aria-label="Mileage" />
                  </div>
                </details>
              )}
              <button className="btn btn-ink min-h-12 w-full text-[1rem]">{role === "customer" ? "Create account" : "Continue to your profile"}</button>
              <p className="text-center text-[0.8125rem] text-ink-3">We&apos;ll email you a link to confirm your address.</p>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
