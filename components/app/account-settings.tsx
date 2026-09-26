import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import type { AppMode, User } from "@/lib/domain/types";
import { signOut, switchMode, updateAccount } from "@/app/actions/account";

/** Shared account details (one login). Role-specific settings live on each side. */
export function AccountSettings({ user, mode, hasOther, back }: { user: User; mode: AppMode; hasOther: boolean; back: string }) {
  const other: AppMode = mode === "customer" ? "mechanic" : "customer";
  return (
    <div className="space-y-10">
      <form action={updateAccount} className="space-y-4">
        <input type="hidden" name="back" value={back} />
        <h2 className="heading text-[1.25rem]">Your account</h2>
        <p className="text-[0.875rem] text-ink-3">One login for Clutch. Used for both customer and mechanic modes.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="field-label">Name</span>
            <input name="name" defaultValue={user.name} className="input mt-1" autoComplete="name" />
          </label>
          <label className="block">
            <span className="field-label">Email</span>
            <input type="email" value={user.email} readOnly className="input mt-1 text-ink-2" />
            <span className="mt-1 block text-[0.8125rem] text-ink-3">This is the email you sign in with. To change it, contact support.</span>
          </label>
          <label className="block">
            <span className="field-label">Phone</span>
            <input name="phone" type="tel" defaultValue={user.phone} className="input mt-1" autoComplete="tel" />
          </label>
        </div>
        <fieldset className="space-y-2">
          <legend className="field-label">Notifications</legend>
          {(
            [
              ["notifyEmail", "Email", user.notificationPrefs.email],
              ["notifySms", "Text message", user.notificationPrefs.sms],
              ["notifyPush", "Push", user.notificationPrefs.push],
            ] as const
          ).map(([name, label, on]) => (
            <label key={name} className="flex items-center gap-2 text-[0.9375rem]">
              <input type="checkbox" name={name} defaultChecked={on} className="size-4 accent-[var(--ink)]" />
              {label}
            </label>
          ))}
        </fieldset>
        <button className="btn btn-ink">Save account</button>
      </form>

      <section className="space-y-3 border-t border-rule pt-6">
        <h2 className="heading text-[1.25rem]">Mode</h2>
        <p className="text-[0.9375rem] text-ink-2">
          You&apos;re in {mode} mode.{" "}
          {hasOther ? `Your account also has ${other} mode.` : other === "mechanic" ? "Are you a mechanic too? Add it to this same login." : "Need a mechanic for your own car? Add customer mode to this login."}
        </p>
        <form action={switchMode.bind(null, other, undefined)}>
          <button className="btn btn-line">
            <ArrowLeftRight size={16} aria-hidden />
            {hasOther ? `Switch to ${other === "mechanic" ? "Mechanic" : "Customer"}` : other === "mechanic" ? "Become a mechanic" : "Add customer mode"}
          </button>
        </form>
      </section>

      {!user.demo ? (
        <section className="border-t border-rule pt-6">
          <p className="font-semibold">Password</p>
          <p className="mt-1 text-[0.9375rem] text-ink-2">
            <Link href="/reset-password" className="underline decoration-rule underline-offset-2 hover:decoration-ink">
              Change your password
            </Link>
            . If you sign in with Google, you don&apos;t need one.
          </p>
        </section>
      ) : null}

      <form action={signOut} className="border-t border-rule pt-6">
        <button className="text-[0.9375rem] font-semibold text-ink-2 underline decoration-rule underline-offset-2">Log out</button>
      </form>
    </div>
  );
}
