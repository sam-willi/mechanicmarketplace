/**
 * Deliver queued alerts. Safe to run from any scheduler, as often as you like, with several
 * copies at once (events are leased; nothing is sent twice).
 *
 *   npx tsx --env-file=.env.local --conditions react-server scripts/deliver-alerts.ts --check-config
 *   npx tsx --env-file=.env.local --conditions react-server scripts/deliver-alerts.ts            # one batch, then exit
 *   npx tsx --env-file=.env.local --conditions react-server scripts/deliver-alerts.ts --loop     # keep running (every 30s)
 *
 * With no provider configured (the default) nothing is sent: events wait as "no provider" and
 * go out once one is configured. Prints counts only, never addresses or messages.
 */
import { deliveryConfig } from "@/lib/notify/config";

async function main() {
  const cfg = deliveryConfig();
  if (process.argv.includes("--check-config")) {
    console.log(`Outbound alerts: ${cfg.active ? "ON" : "OFF"}${cfg.active ? "" : " (nothing will be sent)"}`);
    for (const c of cfg.checks) console.log(`${c.ok === null ? "  ?" : c.ok ? "  ✓" : "  ✗"} ${c.label}: ${c.detail}`);
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL isn't set: alerts are only queued when the app uses a database.");
    process.exit(1);
  }
  const { deliverBatch } = await import("@/lib/notify/run");
  const loop = process.argv.includes("--loop");
  do {
    const s = await deliverBatch();
    console.log(`${new Date().toISOString()} alerts ${s.alertsOn ? "on" : "off"} · claimed ${s.claimed} · sent ${s.sent} · retry ${s.retry} · failed ${s.failed} · suppressed ${s.suppressed} · no provider ${s.noProvider} · lease lost ${s.leaseLost}`);
    if (loop) await new Promise((r) => setTimeout(r, 30_000));
  } while (loop);
}
main().then(
  () => process.exit(0),
  (e) => {
    console.error((e as Error).message);
    process.exit(1);
  },
);
