import type { Metadata } from "next";
import { ServicePicker } from "@/components/mechanic/service-picker";
import { UNLOCKS } from "@/lib/domain/mechanic-requirements";
import { getRepo } from "@/lib/data";
import { getSession } from "@/lib/session";
import { REPAIR_LABEL } from "@/lib/domain/provenance";
import { AREAS } from "@/lib/domain/areas";
import { screeningOpen } from "@/lib/verification/providers/registry";
import { REPAIR_CATEGORIES, VEHICLE_MAKES } from "@/lib/domain/types";
import { saveOnboarding } from "@/app/actions/mechanic";
import Link from "next/link";
import { Field } from "@/components/workspace/ui";
import { OnboardingFlow, ProfilePreview } from "@/components/mechanic/onboarding-flow";
import { PortraitUpload } from "@/components/mechanic/portrait-upload";

export const metadata: Metadata = { title: "Build your profile" };

const STEPS = [
  { title: "You and your photo", why: "Customers book people. A clear photo and a few honest lines are the first things they look at.", minutes: 2, required: ["displayName"] },
  { title: "Where you work", why: "You go to the customer's car. Requests are matched by distance from where you start, within how far you'll travel.", minutes: 1, required: ["neighborhood"] },
  { title: "Services, makes and prices", why: "What you pick routes requests to you before you have verified jobs. Prices are shown before anyone asks you for an estimate.", minutes: 2, required: ["hourlyRate", "diagnosticFee"] },
  { title: "Experience and first proof (optional)", why: "Proof ranks you higher for matching jobs, but you don't need it to start. Skip this for now and add it any time from your profile.", minutes: 3, optional: true },
  { title: "Verification checks (optional)", why: "Customers see which of your checks Clutch has verified before they book you. They aren't required to receive requests or be booked, but verified checks build trust and improve your ranking.", minutes: 1 },
  { title: "Preview and publish", why: "This is your public profile as it starts. It grows with every verified job.", minutes: 1 },
];

/** The difference between what you say and what's verified, once, in plain words. */
function ProofExplainer() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="border border-dashed border-pencil p-3">
        <p className="font-semibold text-pencil">Self-reported</p>
        <p className="mt-1 text-[0.875rem] text-ink-2">What you tell us. Shown on your profile, clearly marked, and never counted as proof.</p>
      </div>
      <div className="border border-carbon/40 bg-carbon-wash p-3">
        <p className="font-semibold text-carbon">Verified</p>
        <p className="mt-1 text-[0.875rem] text-ink-2">Confirmed by a Clutch job, a past customer, the issuer, your employer, or a document Clutch reviewed.</p>
      </div>
    </div>
  );
}

/** What's needed to publish, to send estimates, and to be booked. */
function Requirements({ compact = false }: { compact?: boolean }) {
  const rows: [string, string][] = UNLOCKS.map((u) => [u.goal, u.needs]);
  return (
    <div>
      {!compact ? <p className="heading text-[1.0625rem]">What each step unlocks</p> : <p className="field-label">What you need for each</p>}
      <dl className="mt-2 border-t border-rule">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-1 border-b border-rule-soft py-2.5 sm:grid-cols-[14rem_minmax(0,1fr)]">
            <dt className="font-semibold">{k}</dt>
            <dd className="text-[0.9375rem] text-ink-2">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}


export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const repo = await getRepo();
  const s = await getSession();
  const sp = await searchParams;
  const m = sp.edit && s.role === "mechanic" ? repo.getMechanic(s.mechanicId) : undefined;

  return (
    <div className="max-w-[900px] space-y-8">
      <div className="border-b-2 border-ink pb-4">
        <h1 className="display text-[2.25rem] sm:text-[2.75rem]">{m ? "Edit your profile" : "Build your mechanic profile"}</h1>
        <p className="mt-2 max-w-[62ch] text-ink-2">
          About ten minutes. Your profile goes live when you publish.
        </p>
      </div>
      <form action={saveOnboarding}>
        <input type="hidden" name="mode" value={m ? "edit" : "new"} />
        <OnboardingFlow steps={STEPS} submitLabel={m ? "Save profile" : "Publish my profile"} persist={!m}>
          {/* 1 */}
          <div className="space-y-5">
            <Field label="Full name (required)">
              <input name="displayName" required defaultValue={m?.displayName} className="input max-w-[24rem]" autoComplete="name" />
            </Field>
            <div>
              <p className="field-label mb-2">Your photo</p>
              <PortraitUpload current={m?.photoUrl || undefined} />
              <p className="mt-2 text-[0.8125rem] text-ink-2">Your face, in good light, looking at the camera. Work clothes are great. No logos, sunglasses or group shots.</p>
            </div>
            <Field label="About you" hint="In your own words. Shown on your profile as self-reported.">
              <textarea name="bio" rows={4} defaultValue={m?.bio} className="input" />
            </Field>
            <details className="text-[0.875rem]">
              <summary className="min-h-11 cursor-pointer content-center font-semibold">See strong examples</summary>
              <ul className="mt-2 space-y-2 text-ink-2">
                <li className="border-l-2 border-rule pl-3">&ldquo;Eleven years at a Toyota dealership, now independent. I do brakes, suspension and diagnostics in your driveway, and I send photos of every part I replace.&rdquo;</li>
                <li className="border-l-2 border-rule pl-3">&ldquo;Mobile around Pasadena. Hybrids and European cars. I&apos;ll always call before doing anything that wasn&apos;t on the estimate.&rdquo;</li>
              </ul>
              <p className="mt-2 text-ink-3">What works: where you learned, what you focus on, and one thing customers can count on.</p>
            </details>
          </div>

          {/* 2 */}
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              {/* One place to pick: the launch area you start from. Distances in search and matching are measured from here. */}
              <Field label="Where you start from (required)" hint="The Los Angeles area you usually leave from.">
                <select name="neighborhood" required defaultValue={AREAS.find((a) => a.label === m?.neighborhood)?.key ?? ""} className="input">
                  <option value="" disabled>
                    Choose an area
                  </option>
                  {AREAS.map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="How far you'll travel (miles)" hint="Requests farther than this don't reach you.">
                <input name="serviceRadiusMi" inputMode="numeric" defaultValue={m?.serviceRadiusMi ?? 15} className="input tnum" />
              </Field>
              <Field label="Usual hours">
                <input name="availability" defaultValue={m?.availabilityNote} placeholder="Weekdays 7am–6pm" className="input" />
              </Field>
            </div>
          </div>

          {/* 3 */}
          <div className="space-y-5">
            <ServicePicker
              repairs={REPAIR_CATEGORIES.map((c) => ({ value: c, label: REPAIR_LABEL[c] }))}
              makes={[...VEHICLE_MAKES]}
              chosenRepairs={m?.declaredRepairCategories}
              chosenMakes={m?.declaredMakes}
            />
            <p className="field-label">Your prices</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Hourly labor rate ($, required)">
                <input name="hourlyRate" inputMode="decimal" required defaultValue={m ? m.hourlyRateCents / 100 : undefined} className="input tnum" />
              </Field>
              <Field label="Diagnostic fee ($, required)">
                <input name="diagnosticFee" inputMode="decimal" required defaultValue={m ? m.diagnosticFeeCents / 100 : undefined} className="input tnum" />
              </Field>
              <Field label="Travel fee ($)">
                <input name="travelFee" inputMode="decimal" defaultValue={m?.travelFeeCents ? m.travelFeeCents / 100 : undefined} className="input tnum" />
              </Field>
            </div>
            <p className="text-[0.875rem] text-ink-2">You set your prices. Clutch never ranks mechanics by price or takes a cut of them.</p>
          </div>

          {/* 4 */}
          <div className="space-y-5">
            <ProofExplainer />
            {m ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Link href="/mechanic/verification" target="_blank" className="btn btn-line min-h-11">
                  Add certifications and work history <span className="text-[0.8125rem] font-normal">(new tab)</span>
                </Link>
                <Link href="/mechanic/repairs" target="_blank" className="btn btn-line min-h-11">
                  Add past repairs for customers to confirm <span className="text-[0.8125rem] font-normal">(new tab)</span>
                </Link>
              </div>
            ) : (
              <>
                <fieldset>
                  <legend className="heading text-[1.0625rem]">A certification (optional)</legend>
                  <div className="mt-2 grid gap-3 sm:grid-cols-4">
                    <Field label="Issuer">
                      <select name="credIssuer" className="input" defaultValue="">
                        <option value="">None yet</option>
                        {["ASE", "EPA", "BMW Group", "Mercedes-Benz", "Toyota", "Honda", "Ford", "GM", "Other"].map((i) => (
                          <option key={i}>{i}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Code">
                      <input name="credCode" className="input" placeholder="A5" />
                    </Field>
                    <Field label="Name" className="sm:col-span-2">
                      <input name="credName" className="input" placeholder="Brakes" />
                    </Field>
                    <Field label="Expires">
                      <input name="credExpires" type="date" className="input" />
                    </Field>
                    <Field label="Certificate" className="sm:col-span-3">
                      <input name="credDoc" type="file" accept=".pdf,image/*" className="block w-full py-2 text-[0.875rem]" />
                    </Field>
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="heading text-[1.0625rem]">Where you&apos;ve worked (optional)</legend>
                  <p className="text-[0.8125rem] text-ink-2">Clutch confirms it with the shop, then it shows as confirmed by your employer.</p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-4">
                    <Field label="Shop or dealership" className="sm:col-span-2">
                      <input name="employer" className="input" />
                    </Field>
                    <Field label="Position" className="sm:col-span-2">
                      <input name="position" className="input" />
                    </Field>
                    <Field label="Started">
                      <input name="empStart" type="date" className="input" />
                    </Field>
                    <Field label="Ended">
                      <input name="empEnd" type="date" className="input" />
                    </Field>
                    <Field label="Letter or pay stub" className="sm:col-span-2">
                      <input name="empDoc" type="file" accept=".pdf,image/*" className="block w-full py-2 text-[0.875rem]" />
                    </Field>
                  </div>
                </fieldset>
                <p className="text-[0.875rem] text-ink-2">After you publish, you can add past repairs and ask those customers to confirm them. Each confirmation adds a verified job.</p>
              </>
            )}
          </div>

          {/* 5 */}
          <div className="space-y-5">
            <Requirements />
            {!m ? (
              <fieldset>
                <legend className="heading text-[1.0625rem]">Insurance (you can also add it later)</legend>
                <p className="text-[0.8125rem] text-ink-2">The document is reviewed by Clutch and never shown publicly. Customers see &ldquo;Insurance verified&rdquo; and the expiry month.</p>
                <div className="mt-2 grid gap-3 sm:grid-cols-3">
                  <Field label="Carrier">
                    <input name="insCarrier" className="input" />
                  </Field>
                  <Field label="Policy expires">
                    <input name="insExpires" type="date" className="input" />
                  </Field>
                  <Field label="Certificate of insurance">
                    <input name="insDoc" type="file" accept=".pdf,image/*" className="block w-full py-2 text-[0.875rem]" />
                  </Field>
                </div>
              </fieldset>
            ) : (
              <Link href="/mechanic/verification" target="_blank" className="btn btn-line min-h-11">
                Open the Verification Center <span className="text-[0.8125rem] font-normal">(new tab)</span>
              </Link>
            )}
            <p className="text-[0.875rem] text-ink-2">
              {screeningOpen("background", repo.scope)
                ? "ID and background checks need your consent in a secure flow, so they start in the Verification Center right after you publish."
                : "ID, background and driving record checks open once Clutch connects an independent screening company. Until then they show as not completed on your profile. Customers see that before booking, and you can still be booked once your profile is complete."}
            </p>
          </div>

          {/* 6 */}
          <div className="space-y-5">
            <ProfilePreview />
            <Requirements compact />
          </div>
        </OnboardingFlow>
      </form>
    </div>
  );
}
