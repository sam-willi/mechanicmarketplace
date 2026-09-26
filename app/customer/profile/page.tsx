import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getAccount, getSession } from "@/lib/session";
import { AccountSettings } from "@/components/app/account-settings";

export const metadata: Metadata = { title: "Settings" };

export default async function CustomerAccount({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const s = await getSession();
  if (s.role !== "customer") return null;
  const sp = await searchParams;
  const acct = (await getAccount())!;
  const links = [
    ["/customer/saved", "Saved mechanics"],
    ["/customer/vehicles", "Vehicles"],
    ["/customer/notifications", "Notifications"],
  ];
  return (
    <div className="mx-auto max-w-[760px] space-y-8">
      <div className="border-b-2 border-ink pb-4">
        <h1 className="display text-[2rem]">Settings</h1>
      </div>
      {sp.saved ? <p className="border border-ink bg-sheet px-4 py-3 text-[0.9375rem]">Saved.</p> : null}
      <ul className="border-t border-rule lg:hidden">
        {links.map(([href, label]) => (
          <li key={href}>
            <Link href={href} className="flex items-center justify-between border-b border-rule-soft py-3.5 font-semibold">
              {label} <ChevronRight size={18} aria-hidden className="text-ink-3" />
            </Link>
          </li>
        ))}
      </ul>
      <AccountSettings user={acct.user} mode="customer" hasOther={Boolean(acct.mechanic)} back="/customer/profile" />
    </div>
  );
}
