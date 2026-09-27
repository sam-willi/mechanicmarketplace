import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { testIdentityProvider, testProvidersAllowed } from "@/lib/verification/identity/config";
import { testIdentitySecret } from "@/lib/verification/identity/test-provider";
import { sign } from "@/lib/verification/identity/signature";

export const metadata: Metadata = { title: "Test identity provider", robots: { index: false } };

const OUTCOMES = [
  ["verified", "ID and selfie match"],
  ["selfie_mismatch", "Selfie doesn't match the ID"],
  ["document_expired", "ID has expired"],
  ["manipulated", "Tampered document (hard fail)"],
  ["processing", "Still processing"],
  ["cancelled", "Cancel and go back"],
] as const;

/**
 * Stands in for a provider's hosted page in tests and the fictional demo, and says so. Never
 * reachable for a real mechanic unless this is an isolated test run (CLUTCH_TEST_PROVIDERS=on).
 */
export default async function TestIdentityPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const session = testIdentityProvider.session(ref);
  if (!session || (session.scope === "live" && !testProvidersAllowed())) notFound();

  async function finish(formData: FormData) {
    "use server";
    const s = testIdentityProvider.session(ref);
    if (!s || (s.scope === "live" && !testProvidersAllowed())) notFound();
    const outcome = String(formData.get("outcome")) as (typeof OUTCOMES)[number][0];
    testIdentityProvider.complete(ref, outcome, String(formData.get("nameOnId") ?? "").trim() || undefined);
    if (formData.get("webhook") !== "skip") {
      const h = await headers();
      const host = h.get("host") ?? "localhost:3000";
      const origin = process.env.APP_URL?.replace(/\/$/, "") || `${host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https"}://${host}`;
      const body = JSON.stringify({ id: `evt_test_${randomBytes(8).toString("hex")}`, type: "identity.verification_session.updated", data: { object: { id: ref, object: "identity.verification_session" } } });
      const send = () => fetch(`${origin}/api/verification/webhook/test`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": sign(body, testIdentitySecret()) }, body }).catch(() => undefined);
      await send();
      // Providers deliver more than once; so does this one, to prove it changes nothing.
      if (formData.get("webhook") === "twice") await send();
    }
    redirect(s.returnUrl.replace(/^https?:\/\/[^/]+/, ""));
  }

  return (
    <main className="mx-auto max-w-[560px] space-y-5 px-4 py-10">
      <p className="border border-amber/40 bg-amber-wash px-3 py-2 text-[0.9375rem] font-semibold">Test provider: not a real identity check. Nothing is captured here.</p>
      <h1 className="display text-[2rem]">Test identity check</h1>
      <p className="text-ink-2">In production this is Stripe Identity&apos;s page, where the mechanic photographs their ID and takes a live selfie. Pick the outcome to simulate.</p>
      <form action={finish} className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="field-label">Outcome</legend>
          {OUTCOMES.map(([v, label], i) => (
            <label key={v} className="flex min-h-11 items-center gap-3 border border-rule bg-sheet px-3">
              <input type="radio" name="outcome" value={v} defaultChecked={i === 0} /> {label}
            </label>
          ))}
        </fieldset>
        <label className="block">
          <span className="field-label">Name on the ID (optional; a different name tests the mismatch)</span>
          <input name="nameOnId" className="input mt-1" />
        </label>
        <fieldset className="space-y-2">
          <legend className="field-label">Webhook</legend>
          {[
            ["once", "Send the signed webhook"],
            ["twice", "Send it twice (duplicate delivery)"],
            ["skip", "Don't send it (a missed webhook; the return page recovers)"],
          ].map(([v, label], i) => (
            <label key={v} className="flex min-h-11 items-center gap-3 border border-rule bg-sheet px-3">
              <input type="radio" name="webhook" value={v} defaultChecked={i === 0} /> {label}
            </label>
          ))}
        </fieldset>
        <button className="btn btn-ink min-h-12 w-full">Finish</button>
      </form>
    </main>
  );
}
