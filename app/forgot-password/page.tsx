import type { Metadata } from "next";
import { requestPasswordReset } from "@/app/actions/account";
import { AuthShell, Notice } from "@/components/auth/auth-shell";

export const metadata: Metadata = { title: "Reset your password" };

export default async function ForgotPassword({ searchParams }: { searchParams: Promise<{ email?: string; sent?: string }> }) {
  const sp = await searchParams;
  return (
    <AuthShell aside={{ href: "/login", label: "Log in" }}>
      <h1 className="display text-[2.25rem]">Reset your password</h1>
      <p className="mt-2 text-ink-2">Enter the email you signed up with and we&apos;ll send a link to choose a new password.</p>
      {sp.sent ? <Notice>If there&apos;s an account for {sp.email || "that email"}, a reset link is on its way. It expires in an hour.</Notice> : null}
      <form action={requestPasswordReset} className="mt-6 space-y-3">
        <label className="block">
          <span className="field-label">Email</span>
          <input name="email" type="email" required defaultValue={sp.email} autoComplete="email" className="input mt-1" />
        </label>
        <button className="btn btn-ink min-h-12 w-full">Send reset link</button>
      </form>
      <p className="mt-6 text-[0.875rem] text-ink-3">Signed up with Google? You don&apos;t have a Clutch password. Use Continue with Google on the log-in page.</p>
    </AuthShell>
  );
}
