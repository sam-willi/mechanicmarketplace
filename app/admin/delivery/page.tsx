import { Check, CircleHelp, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getRepo } from "@/lib/data";
import { dbSql, ensureDeliverySchema, persistent } from "@/lib/data/store";
import { getSession, isStaff } from "@/lib/session";
import { deliveryConfig } from "@/lib/notify/config";
import { DELIVERY_EVENTS } from "@/lib/notify/events";
import { deliveryHealth } from "@/lib/notify/worker";
import { SiteHeader } from "@/components/site/site-header";
import { NeedsPersona, PageTitle } from "@/components/workspace/ui";

export const metadata: Metadata = { title: "Alert delivery" };

const STATE_LABEL: Record<string, string> = {
  pending: "Queued",
  processing: "Being processed",
  sent: "Sent",
  retry: "Will retry",
  failed: "Failed (gave up)",
  suppressed: "Not sent (rule)",
  no_provider: "Waiting: no provider",
};
const REASON: Record<string, string> = {
  preference_off: "Recipient turned email alerts off",
  unverified_contact: "Email not verified",
  test_recipient: "Test or placeholder address",
  demo_account: "Demo account",
  no_account: "Account not found",
  no_contact: "No email on the account",
  unknown_event: "Unknown event type",
};

function age(seconds: number | null) {
  if (seconds === null) return "—";
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} days`;
}

/** Staff view of outbound alerts. Counts, ages and redacted attempt details only: no addresses, numbers or message contents. */
export default async function DeliveryHealth() {
  const repo = await getRepo();
  const s = await getSession();
  if (!isStaff(s))
    return (
      <>
        <SiteHeader />
        <NeedsPersona role="admin" />
      </>
    );
  const cfg = deliveryConfig();
  const live = repo.scope === "live";
  let health: Awaited<ReturnType<typeof deliveryHealth>> | null = null;
  if (live && persistent()) {
    await ensureDeliverySchema();
    health = await deliveryHealth(dbSql());
  }
  const states = ["pending", "processing", "no_provider", "retry", "sent", "failed", "suppressed"];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1200px] space-y-8 px-4 pt-8 pb-24 sm:px-6">
        <PageTitle title="Alert delivery" note="Optional email alerts about marketplace events. In-app notifications are always shown regardless of what happens here." />
        <nav aria-label="Admin" className="flex flex-wrap gap-4 text-[0.9375rem]">
          <Link href="/admin" className="link">
            Verification review
          </Link>
          <Link href="/admin/support" className="link">
            Support reports
          </Link>
          <Link href="/admin/demand" className="link">
            Unmatched demand
          </Link>
          <span className="font-semibold" aria-current="page">
            Alert delivery
          </span>
        </nav>

        <section role="status" className={`border px-4 py-3 ${cfg.active ? "border-go/40 bg-go-wash" : "border-amber/40 bg-amber-wash"}`}>
          <p className="font-bold">{cfg.active ? "Outbound alerts are ON." : "Outbound alerts are OFF. Nothing is emailed or texted."}</p>
          <p className="mt-1 text-[0.9375rem] text-ink-2">
            {cfg.active
              ? `Provider: ${cfg.provider}. Queued alerts are sent by the delivery worker.`
              : "Events are still recorded and wait as “no provider”. They go out automatically once a provider is configured and the worker runs. Users are told alerts are off."}
          </p>
        </section>

        {!live ? (
          <p className="border-y border-rule py-6 text-ink-2">This is the demo marketplace. Demo events are never queued or sent.</p>
        ) : !health ? (
          <p className="border-y border-rule py-6 text-ink-2">This server runs without a database, so alerts can&apos;t be queued here.</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-px border border-rule bg-rule-soft sm:grid-cols-4">
              {[
                ...states.map((st) => [String(health!.byState[st] ?? 0), STATE_LABEL[st]] as const),
                [age(health.oldestWaitingSeconds), "oldest waiting"] as const,
              ].map(([v, k]) => (
                <div key={k} className="bg-sheet px-4 py-3">
                  <dd className="num text-[1.75rem]">{v}</dd>
                  <dt className="text-[0.8125rem] text-ink-2">{k}</dt>
                </div>
              ))}
            </dl>

            <section aria-labelledby="by-event" className="space-y-2">
              <h2 id="by-event" className="heading text-[1.25rem]">
                By event
              </h2>
              {health.byEvent.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] border-collapse text-left text-[0.9375rem]">
                    <thead>
                      <tr className="border-b-2 border-ink text-[0.8125rem] text-ink-2">
                        <th scope="col" className="py-2 pr-4 font-semibold">Event</th>
                        <th scope="col" className="py-2 pr-4 font-semibold">State</th>
                        <th scope="col" className="py-2 font-semibold">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {health.byEvent.map((r) => (
                        <tr key={`${r.event}-${r.state}`} className="border-b border-rule-soft">
                          <td className="py-2 pr-4">{DELIVERY_EVENTS[r.event as keyof typeof DELIVERY_EVENTS]?.subject ?? r.event}</td>
                          <td className="py-2 pr-4">{STATE_LABEL[r.state] ?? r.state}</td>
                          <td className="tnum py-2">{r.n}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-ink-2">No alerts queued yet.</p>
              )}
            </section>

            {health.suppressed.length ? (
              <section aria-labelledby="suppressed" className="space-y-2">
                <h2 id="suppressed" className="heading text-[1.25rem]">
                  Not sent, by rule
                </h2>
                <ul className="border-t border-rule text-[0.9375rem]">
                  {health.suppressed.map((r) => (
                    <li key={r.reason} className="flex justify-between border-b border-rule-soft py-2">
                      <span>{REASON[r.reason] ?? r.reason}</span>
                      <span className="tnum font-semibold">{r.n}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section aria-labelledby="failures" className="space-y-2">
              <h2 id="failures" className="heading text-[1.25rem]">
                Failures and retries
              </h2>
              {health.failures.length ? (
                <ul className="border-t border-rule text-[0.9375rem]">
                  {health.failures.map((f) => (
                    <li key={f.id} className="grid gap-1 border-b border-rule-soft py-2 sm:grid-cols-[6rem_minmax(0,1fr)_10rem_8rem]">
                      <span className="tnum text-ink-3">#{f.id}</span>
                      <span>{DELIVERY_EVENTS[f.event_type as keyof typeof DELIVERY_EVENTS]?.subject ?? f.event_type}</span>
                      <span>{STATE_LABEL[f.state]} · {f.send_attempts} tries</span>
                      <span className="text-ink-2">{f.last_error_code ?? "—"}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-ink-2">None.</p>
              )}
            </section>

            <section aria-labelledby="attempts" className="space-y-2">
              <h2 id="attempts" className="heading text-[1.25rem]">
                Recent attempts
              </h2>
              <p className="text-[0.8125rem] text-ink-3">Redacted: recipients show only the channel and whether it&apos;s verified. Message text isn&apos;t shown.</p>
              {health.recent.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-left text-[0.875rem]">
                    <thead>
                      <tr className="border-b-2 border-ink text-[0.8125rem] text-ink-2">
                        {["Event", "Outcome", "Adapter", "Recipient", "Code", "When"].map((h) => (
                          <th key={h} scope="col" className="py-2 pr-3 font-semibold">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {health.recent.map((a, i) => (
                        <tr key={`${a.id}-${i}`} className="border-b border-rule-soft">
                          <td className="py-2 pr-3">{a.event_type}</td>
                          <td className="py-2 pr-3">{a.outcome.replace("_", " ")}</td>
                          <td className="py-2 pr-3">{a.adapter}</td>
                          <td className="py-2 pr-3">{a.recipient_hint ?? "—"}</td>
                          <td className="py-2 pr-3">{a.error_code ?? "—"}</td>
                          <td className="tnum py-2 text-ink-3">{a.started_at.toISOString().slice(0, 16).replace("T", " ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-ink-2">No attempts yet. The worker hasn&apos;t run, or nothing is queued.</p>
              )}
            </section>
          </>
        )}

        <section aria-labelledby="ready" className="space-y-2">
          <h2 id="ready" className="heading text-[1.25rem]">
            Before switching alerts on
          </h2>
          <ul className="border-t border-rule text-[0.9375rem]">
            {cfg.checks.map((c) => (
              <li key={c.key} className="grid gap-1 border-b border-rule-soft py-2 sm:grid-cols-[2rem_16rem_minmax(0,1fr)]">
                <span aria-hidden className={c.ok === null ? "text-ink-3" : c.ok ? "text-go" : "text-alert"}>
                  {c.ok === null ? <CircleHelp size={16} /> : c.ok ? <Check size={16} strokeWidth={2.5} /> : <X size={16} strokeWidth={2.5} />}
                </span>
                <span className="font-semibold">
                  {c.label}
                  <span className="sr-only">{c.ok === null ? " (check by hand)" : c.ok ? " (done)" : " (missing)"}</span>
                </span>
                <span className="text-ink-2">{c.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
