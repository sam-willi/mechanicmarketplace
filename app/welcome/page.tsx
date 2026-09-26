import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ArrowRight, Car, Wrench } from "lucide-react";
import { completeSignup } from "@/app/actions/account";
import { needsIn, readyRepo } from "@/lib/data";
import { getAuthUser } from "@/lib/session";
import { homeFor, provisionUser } from "@/lib/auth/provision";
import { AuthShell, Notice } from "@/components/auth/auth-shell";

export const metadata: Metadata = { title: "Welcome to Clutch" };

/** Signed in (e.g. with Google) but no Clutch account yet: pick how you'll use it. */
export default async function Welcome({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  // Supabase accounts are always real: look them up in the live store.
  const repo = await readyRepo("live");
  const sp = await searchParams;
  const auth = await getAuthUser();
  if (!auth) redirect("/login");
  await (await needsIn("live", { userId: auth.id, staff: false })).account(auth.id);
  const existing = repo.getUser(auth.id);
  if (existing) redirect(homeFor(existing, sp.next));
  const next = sp.next ?? "";
  // They already chose a role at sign-up: finish setting up the account instead of asking again.
  const chosen = auth.meta.role === "customer" || auth.meta.role === "mechanic" ? auth.meta.role : null;
  let setupFailed = sp.error === "setup_failed";
  if (chosen) {
    let user;
    try {
      user = await provisionUser(auth, chosen);
    } catch (e) {
      console.error("[auth] account setup retry failed:", (e as Error).message);
      setupFailed = true;
    }
    if (user) redirect(chosen === "mechanic" ? "/mechanic/onboarding" : homeFor(user, next || "/customer?welcome=1"));
  }
  return (
    <AuthShell>
      <p className="text-[0.9375rem] text-ink-2">
        Signed in as <span className="font-semibold text-ink">{auth.email}</span>
      </p>
      {setupFailed ? (
        <Notice tone="alert">We couldn&apos;t finish setting up your account. Your sign-in worked, so nothing is lost. Choose below to try again.</Notice>
      ) : null}
      <h1 className="display mt-2 text-[2.25rem] sm:text-[2.75rem]">How do you want to use Clutch?</h1>
      <p className="mt-2 text-ink-2">One account works for both. You can add the other later.</p>
      <div className="mt-8 grid gap-3">
        <form action={completeSignup.bind(null, "customer", next)}>
          <button className="group sheet flex w-full items-center gap-4 p-5 text-left hover:border-ink">
            <span className="grid size-12 shrink-0 place-items-center bg-paper">
              <Car size={24} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="heading block text-[1.375rem]">I need a mechanic</span>
              <span className="mt-0.5 block text-[0.9375rem] text-ink-2">Find someone you can trust to fix your car.</span>
            </span>
            <ArrowRight size={20} className="shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </button>
        </form>
        <form action={completeSignup.bind(null, "mechanic", next)}>
          <button className="group flex w-full items-center gap-4 bg-brand-deep p-5 text-left text-sheet">
            <span className="grid size-12 shrink-0 place-items-center bg-brand-deep">
              <Wrench size={24} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="heading block text-[1.375rem] text-sheet">I&apos;m a mechanic</span>
              <span className="mt-0.5 block text-[0.9375rem] text-on-brand-2">Build your independent business with proof of your work.</span>
            </span>
            <ArrowRight size={20} className="shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </button>
        </form>
      </div>
    </AuthShell>
  );
}
