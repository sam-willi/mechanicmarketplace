import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { resendConfirmation } from "@/app/actions/account";
import { AuthShell, Notice } from "@/components/auth/auth-shell";
import { SubmitButton } from "@/components/auth/submit-button";

export const metadata: Metadata = { title: "Check your email" };

const ERRORS: Record<string, string> = {
  too_many: "We've sent a few already. Wait a few minutes before asking again, and check spam.",
  unavailable: "We couldn't reach the email service. Try again in a moment.",
  resend_failed: "We couldn't send it again. Try again in a moment.",
};

export default async function CheckEmail({ searchParams }: { searchParams: Promise<{ email?: string; resent?: string; error?: string; role?: string }> }) {
  const sp = await searchParams;
  return (
    <AuthShell aside={{ href: "/login", label: "Log in" }}>
      <MailCheck size={32} aria-hidden />
      <h1 className="display mt-3 text-[2.25rem]">Check your email</h1>
      <p className="mt-3 text-ink-2">
        We sent a confirmation link to <span className="font-semibold text-ink">{sp.email ?? "your email"}</span>. Open it to finish creating your{" "}
        {sp.role === "mechanic" ? "mechanic " : ""}account. It expires in an hour.
      </p>
      {sp.resent ? <Notice>Sent again. It can take a minute; check spam too.</Notice> : null}
      {sp.error ? <Notice tone="alert">{ERRORS[sp.error] ?? ERRORS.resend_failed}</Notice> : null}

      {/* Supabase doesn't reveal whether an email is registered, so cover that case plainly. */}
      <div className="mt-6 border-t border-rule pt-4 text-[0.9375rem] text-ink-2">
        <p>
          Already have an account with this email?{" "}
          <Link href={`/login${sp.email ? `?email=${encodeURIComponent(sp.email)}` : ""}`} className="font-semibold text-ink underline decoration-rule underline-offset-2">
            Log in
          </Link>{" "}
          or{" "}
          <Link href={`/forgot-password${sp.email ? `?email=${encodeURIComponent(sp.email)}` : ""}`} className="font-semibold text-ink underline decoration-rule underline-offset-2">
            reset your password
          </Link>
          .
        </p>
      </div>

      {sp.email ? (
        <form action={resendConfirmation} className="mt-6">
          <input type="hidden" name="email" value={sp.email} />
          <p className="text-[0.9375rem] text-ink-2">Didn&apos;t get it?</p>
          <SubmitButton className="btn btn-line mt-2" pending="Sending…">
            Send it again
          </SubmitButton>
        </form>
      ) : null}
    </AuthShell>
  );
}
