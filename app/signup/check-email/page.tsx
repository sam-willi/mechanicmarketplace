import type { Metadata } from "next";
import { MailCheck } from "lucide-react";
import { resendConfirmation } from "@/app/actions/account";
import { AuthShell, Notice } from "@/components/auth/auth-shell";

export const metadata: Metadata = { title: "Check your email" };

export default async function CheckEmail({ searchParams }: { searchParams: Promise<{ email?: string; resent?: string }> }) {
  const sp = await searchParams;
  return (
    <AuthShell aside={{ href: "/login", label: "Log in" }}>
      <MailCheck size={32} aria-hidden />
      <h1 className="display mt-3 text-[2.25rem]">Check your email</h1>
      <p className="mt-3 text-ink-2">
        We sent a confirmation link to <span className="font-semibold text-ink">{sp.email ?? "your email"}</span>. Open it on this device to finish creating your account.
      </p>
      {sp.resent ? <Notice>Sent again. It can take a minute; check spam too.</Notice> : null}
      {sp.email ? (
        <form action={resendConfirmation} className="mt-8">
          <input type="hidden" name="email" value={sp.email} />
          <p className="text-[0.9375rem] text-ink-2">Didn&apos;t get it?</p>
          <button className="btn btn-line mt-2">Send it again</button>
        </form>
      ) : null}
    </AuthShell>
  );
}
