import type { Metadata } from "next";
import { requestPasswordReset } from "@/app/actions/account";
import { AuthShell, Notice } from "@/components/auth/auth-shell";
import { SubmitButton } from "@/components/auth/submit-button";

export const metadata: Metadata = { title: "Reset your password" };

const ERRORS: Record<string, string> = {
  bad_email: "That email address doesn't look right.",
  too_many: "Too many reset requests. Wait a few minutes and try again.",
  unavailable: "We couldn't reach the email service. Try again in a moment.",
};

export default async function ForgotPassword({ searchParams }: { searchParams: Promise<{ email?: string; sent?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <AuthShell aside={{ href: "/login", label: "Log in" }}>
      <h1 className="display text-[2.25rem]">Reset your password</h1>
      <p className="mt-2 text-ink-2">Enter the email you signed up with and we&apos;ll send a link to choose a new password.</p>
      {sp.error ? <Notice tone="alert">{ERRORS[sp.error] ?? ERRORS.unavailable}</Notice> : null}
      {sp.sent ? <Notice>If there&apos;s an account for {sp.email || "that email"}, a reset link is on its way. It expires in an hour.</Notice> : null}
      <form action={requestPasswordReset} className="mt-6 space-y-3">
        <label className="block">
          <span className="field-label">Email</span>
          <input name="email" type="email" required defaultValue={sp.email} autoComplete="email" className="input mt-1" />
        </label>
        <SubmitButton pending="Sending…">Send reset link</SubmitButton>
      </form>
      <p className="mt-6 text-[0.875rem] text-ink-3">Signed up with Google? You don&apos;t have a Clutch password. Use Continue with Google on the log-in page.</p>
    </AuthShell>
  );
}
