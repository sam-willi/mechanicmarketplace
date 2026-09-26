import type { Metadata } from "next";
import Link from "next/link";
import { updatePassword } from "@/app/actions/account";
import { getAuthUser } from "@/lib/session";
import { AuthShell, Notice } from "@/components/auth/auth-shell";

export const metadata: Metadata = { title: "Choose a new password" };

const ERRORS: Record<string, string> = {
  weak_password: "Use a password with at least 8 characters.",
  mismatch: "The two passwords don't match.",
  expired: "Your reset link expired. Request a new one.",
  failed: "We couldn't update your password. Try again.",
};

export default async function ResetPassword({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const auth = await getAuthUser();
  return (
    <AuthShell>
      <h1 className="display text-[2.25rem]">Choose a new password</h1>
      {!auth ? (
        <>
          <Notice tone="alert">This reset link has expired or was already used.</Notice>
          <Link href="/forgot-password" className="btn btn-ink mt-6">
            Send a new link
          </Link>
        </>
      ) : (
        <>
          <p className="mt-2 text-ink-2">For {auth.email}.</p>
          {sp.error ? <Notice tone="alert">{ERRORS[sp.error] ?? ERRORS.failed}</Notice> : null}
          <form action={updatePassword} className="mt-6 space-y-3">
            <label className="block">
              <span className="field-label">New password</span>
              <input name="password" type="password" required minLength={8} autoComplete="new-password" className="input mt-1" />
              <span className="mt-1 block text-[0.8125rem] text-ink-3">At least 8 characters.</span>
            </label>
            <label className="block">
              <span className="field-label">Confirm new password</span>
              <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className="input mt-1" />
            </label>
            <button className="btn btn-ink min-h-12 w-full">Save password</button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
