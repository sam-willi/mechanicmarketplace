import { isTestAddress } from "./events";

/**
 * Whether outbound alerts can go out, and what's missing. Reads configuration only: it never
 * connects to a provider and never prints a secret (only "set" / "missing").
 *
 * Alerts go out only when ALL hold:
 *   CLUTCH_OUTBOUND_ALERTS=on           an explicit switch (default off)
 *   CLUTCH_EMAIL_PROVIDER=<adapter>     an adapter that's actually implemented
 *   the adapter's settings              e.g. SMTP host/port/user/password
 *   EMAIL_FROM                          a real sender address on a domain you control
 *   APP_URL                             the public https address links point to
 * Otherwise every alert waits as "no provider" (retryable), and the app says alerts are off.
 */
export interface Check {
  key: string;
  label: string;
  /** true = done, false = missing/wrong, null = can't be checked from here (confirm by hand). */
  ok: boolean | null;
  detail: string;
}

/** Adapters implemented in lib/notify/providers.ts. None yet: SMTP is described, not wired. */
export const IMPLEMENTED_ADAPTERS: string[] = [];

export function deliveryConfig(env: Record<string, string | undefined> = process.env) {
  const switchOn = env.CLUTCH_OUTBOUND_ALERTS === "on";
  const provider = (env.CLUTCH_EMAIL_PROVIDER ?? "none").trim().toLowerCase();
  const from = (env.EMAIL_FROM ?? "").trim();
  const appUrl = (env.APP_URL ?? "").trim();
  const set = (k: string) => Boolean(env[k]?.trim());
  const checks: Check[] = [
    { key: "switch", label: "Outbound alerts switched on", ok: switchOn, detail: switchOn ? "CLUTCH_OUTBOUND_ALERTS=on" : "Set CLUTCH_OUTBOUND_ALERTS=on when everything else is ready." },
    {
      key: "provider",
      label: "Email provider chosen",
      ok: provider !== "none" && provider !== "",
      detail: provider === "none" || !provider ? "Set CLUTCH_EMAIL_PROVIDER (e.g. smtp)." : `CLUTCH_EMAIL_PROVIDER=${provider}`,
    },
    {
      key: "adapter",
      label: "Provider adapter implemented",
      ok: IMPLEMENTED_ADAPTERS.includes(provider),
      detail: IMPLEMENTED_ADAPTERS.includes(provider)
        ? `${provider} adapter present`
        : provider === "none" || !provider
          ? "Choose a provider first; then add its adapter in lib/notify/providers.ts."
          : `No "${provider}" adapter yet. Add one in lib/notify/providers.ts (implement EmailProvider) and register it.`,
    },
    ...(provider === "smtp"
      ? [
          { key: "smtp_host", label: "SMTP_HOST", ok: set("SMTP_HOST"), detail: set("SMTP_HOST") ? "set" : "missing" },
          { key: "smtp_port", label: "SMTP_PORT (465 or 587)", ok: ["465", "587"].includes((env.SMTP_PORT ?? "").trim()), detail: set("SMTP_PORT") ? "set" : "missing" },
          { key: "smtp_user", label: "SMTP_USER", ok: set("SMTP_USER"), detail: set("SMTP_USER") ? "set" : "missing" },
          { key: "smtp_password", label: "SMTP_PASSWORD", ok: set("SMTP_PASSWORD"), detail: set("SMTP_PASSWORD") ? "set" : "missing" },
        ]
      : []),
    {
      key: "from",
      label: "Sender address (EMAIL_FROM)",
      ok: /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from) && !isTestAddress(from),
      detail: !from ? "missing" : isTestAddress(from) ? "set, but it's a test or placeholder domain" : "set",
    },
    {
      key: "app_url",
      label: "Public link address (APP_URL)",
      ok: /^https:\/\/[^/]+/.test(appUrl) && !/localhost|127\.0\.0\.1/.test(appUrl),
      detail: !appUrl ? "missing" : /^https:\/\//.test(appUrl) && !/localhost|127\.0\.0\.1/.test(appUrl) ? "set" : "must be the public https address",
    },
    { key: "dns", label: "Sender domain authenticated (SPF, DKIM, DMARC)", ok: null, detail: "Confirm in your provider's dashboard; can't be checked from here." },
    { key: "worker", label: "Delivery worker scheduled", ok: null, detail: "Run scripts/deliver-alerts.ts on a schedule, or call /api/cron/deliver-alerts (see README)." },
  ];
  const required = checks.filter((c) => c.ok !== null);
  const ready = required.every((c) => c.ok);
  return { switchOn, provider, ready, active: ready, checks };
}

export type DeliveryConfig = ReturnType<typeof deliveryConfig>;

/** For UI copy: are alerts actually going out? False unless fully configured. */
export function emailAlertsOn(env: Record<string, string | undefined> = process.env) {
  return deliveryConfig(env).active;
}
