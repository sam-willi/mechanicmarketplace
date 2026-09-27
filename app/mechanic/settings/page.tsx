import type { Metadata } from "next";
import { getRepo } from "@/lib/data";
import { getSession } from "@/lib/session";
import { REPAIR_LABEL } from "@/lib/domain/provenance";
import { REPAIR_CATEGORIES } from "@/lib/domain/types";
import { updatePricing } from "@/app/actions/mechanic";
import { Field, Notice, PageTitle } from "@/components/workspace/ui";
import { AccountSettings } from "@/components/app/account-settings";
import { getAccount } from "@/lib/session";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "mechanic") return null;
  const acct = (await getAccount())!;
  const sp = await searchParams;
  const m = repo.getMechanic(s.mechanicId)!;
  const rows = [...m.fixedPrices, ...Array.from({ length: 2 }, () => undefined)];

  return (
    <div className="space-y-8">
      <PageTitle title="Settings" />
      <h2 className="heading text-[1.375rem]">Your pricing</h2>
      <p className="-mt-4 text-[0.9375rem] text-ink-2">You set every number here. Clutch never ranks mechanics by price and never runs a bidding auction.</p>
      {sp.saved ? <Notice tone="ok">Saved. Your public profile shows the new prices now.</Notice> : null}
      <form action={updatePricing} className="space-y-8">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Hourly labor rate ($)">
            <input name="hourlyRate" inputMode="decimal" required defaultValue={m.hourlyRateCents / 100} className="input tnum" />
          </Field>
          <Field label="Diagnostic fee ($)">
            <input name="diagnosticFee" inputMode="decimal" required defaultValue={m.diagnosticFeeCents / 100} className="input tnum" />
          </Field>
          <Field label="Travel fee ($)" hint="Leave blank for none">
            <input name="travelFee" inputMode="decimal" defaultValue={m.travelFeeCents ? m.travelFeeCents / 100 : ""} className="input tnum" />
          </Field>
        </div>
        <div>
          <p className="heading text-[1.25rem]">Fixed labor prices</p>
          <p className="mt-1 text-[0.9375rem] text-ink-2">Common jobs at a set price. They pre-fill your quotes and show on your profile.</p>
          <div className="mt-4 space-y-2">
            {rows.map((f, i) => (
              <div key={f?.id ?? `new-${i}`} className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)_8rem]">
                <select name="fixedCategory" defaultValue={f?.repairCategory ?? "brakes"} className="input" aria-label="Repair type">
                  {REPAIR_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {REPAIR_LABEL[c]}
                    </option>
                  ))}
                </select>
                <input name="fixedLabel" defaultValue={f?.label ?? ""} placeholder="e.g. Front pads + rotors (labor)" className="input" aria-label="Job" />
                <input name="fixedPrice" inputMode="decimal" defaultValue={f ? f.laborCents / 100 : ""} placeholder="$" className="input tnum" aria-label="Price" />
              </div>
            ))}
          </div>
        </div>
        <button className="btn btn-ink">Save pricing</button>
      </form>
      <div className="border-t-2 border-ink pt-6">
        <AccountSettings user={acct.user} mode="mechanic" hasOther={Boolean(acct.customer)} back="/mechanic/settings" />
      </div>
    </div>
  );
}
