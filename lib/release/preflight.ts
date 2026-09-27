/**
 * Release preflight: is this environment configured to run Clutch for real? Read-only by design:
 * configuration is read from the environment, and the optional online probes only SELECT from the
 * database (inside a read-only transaction) and GET public endpoints. Nothing is written anywhere,
 * and no secret value is ever printed: every string in the report is scrubbed of them before it
 * leaves this module. See docs/release-preflight.md.
 *
 * Each item is PASS (ready), WARN (works, but needs a decision or a manual confirmation; disabled
 * optional features are WARN and say they're off) or BLOCKED (not safe to call production-ready).
 */
import { deliveryConfig } from "@/lib/notify/config";

export type Status = "PASS" | "WARN" | "BLOCKED";
export type Area = "environment" | "app_url" | "database" | "isolation" | "auth" | "documents" | "email" | "cron" | "identity" | "background" | "legal";
export interface Item {
  id: string;
  area: Area;
  status: Status;
  title: string;
  detail: string;
  /** The exact, safe next step (never a secret value). */
  next?: string;
  /** Can't be checked from here; confirm by hand. */
  manual?: boolean;
}
export interface Report {
  target: "production" | "preview" | "local";
  online: boolean;
  /** Where the configuration came from, e.g. "env file .env.production.local" (never its contents). */
  source: string;
  generatedAt: string;
  ready: boolean;
  summary: { pass: number; warn: number; blocked: number };
  items: Item[];
}

type Env = Record<string, string | undefined>;
/** A read-only query (the caller runs it inside a read-only transaction). */
export type DbProbe = <T = Record<string, unknown>>(query: string, params?: unknown[]) => Promise<T[]>;
export type HttpProbe = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ status: number; json?: unknown }>;

export interface PreflightInput {
  env: Env;
  target: Report["target"];
  source?: string;
  /** --online: probe the database and public endpoints (read-only). */
  online?: boolean;
  db?: DbProbe;
  http?: HttpProbe;
  /** Schema keys this build applies at startup (lib/data/schema.ts), for the version check. */
  expectedSchemaKeys?: string[];
  /** Public routes that exist in this build, e.g. "/privacy". */
  routes?: string[];
  /** Jobs scheduled from this repository: vercel.json crons (GET) and scheduled workflows that POST. */
  crons?: { path: string; method: "GET" | "POST" }[];
  now?: Date;
}

/** Every variable whose value must never appear in output. */
export const SECRET_VARS = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "CLUTCH_SIGNING_SECRET",
  "CLUTCH_CRON_SECRET",
  "STRIPE_IDENTITY_SECRET_KEY",
  "STRIPE_IDENTITY_WEBHOOK_SECRET",
  "SMTP_PASSWORD",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "CLUTCH_TEST_IDENTITY_SECRET",
  "CHECKR_API_KEY",
];

const http = (u: string) => /^https:\/\/[^/\s]+/.test(u) && !/localhost|127\.0\.0\.1|\.local\b/.test(u);
const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

export async function runPreflight(input: PreflightInput): Promise<Report> {
  const { env, target } = input;
  const prod = target === "production";
  const items: Item[] = [];
  const add = (i: Item) => items.push(i);
  // In production a problem blocks; in a preview it's a warning.
  const bad = (): Status => (prod ? "BLOCKED" : "WARN");
  const appUrl = (env.APP_URL ?? "").trim().replace(/\/$/, "");

  // ------------------------------------------------------------------ environment
  const testSwitches = [
    ["CLUTCH_TEST_LOGINS", env.CLUTCH_TEST_LOGINS === "on", "one-click test logins"],
    ["CLUTCH_TEST_PROVIDERS", env.CLUTCH_TEST_PROVIDERS === "on", "the test identity provider for real mechanics"],
    ["CLUTCH_VEHICLE_DATA", env.CLUTCH_VEHICLE_DATA === "fixtures", "recorded vehicle data instead of NHTSA"],
    ["CLUTCH_IDENTITY_PROVIDER", env.CLUTCH_IDENTITY_PROVIDER === "test", "the test identity provider"],
  ] as const;
  const on = testSwitches.filter((s) => s[1]);
  add(
    on.length
      ? { id: "env.test_switches", area: "environment", status: bad(), title: "Test-only switches are on", detail: on.map((s) => `${s[0]} enables ${s[2]}`).join("; "), next: `Remove ${on.map((s) => s[0]).join(", ")} from the ${target} environment.` }
      : { id: "env.test_switches", area: "environment", status: "PASS", title: "No test-only switches", detail: "Test logins, test providers and fixture data are off." },
  );
  const auth = env.AUTH_SECRET ?? "";
  add(
    !auth
      ? { id: "env.auth_secret", area: "environment", status: bad(), title: "AUTH_SECRET missing", detail: "Sessions and signed links need it.", next: "Generate 32+ random bytes (e.g. `openssl rand -hex 32`) and set AUTH_SECRET in the environment." }
      : auth.length < 32
        ? { id: "env.auth_secret", area: "environment", status: bad(), title: "AUTH_SECRET too short", detail: `${auth.length} characters; at least 32 are needed.`, next: "Replace it with 32+ random bytes (`openssl rand -hex 32`)." }
        : { id: "env.auth_secret", area: "environment", status: "PASS", title: "AUTH_SECRET set", detail: "Long enough (value not shown)." },
  );
  add(
    env.CLUTCH_LIVE_STORE === "normalized"
      ? { id: "env.store", area: "environment", status: "WARN", title: "Normalized store is on", detail: "It isn't the production default and needs migrations 0004–0009 applied.", next: "Unset CLUTCH_LIVE_STORE unless the migration plan in docs/live-reads.md has been completed." }
      : { id: "env.store", area: "environment", status: "PASS", title: "Snapshot store (production default)", detail: "CLUTCH_LIVE_STORE is unset." },
  );
  const admins = (env.CLUTCH_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  add(
    !admins.length
      ? { id: "env.admins", area: "environment", status: "WARN", title: "No verification reviewers", detail: "CLUTCH_ADMIN_EMAILS is empty, so nobody can review insurance or certificates.", next: "Set CLUTCH_ADMIN_EMAILS to the reviewer's (verified) sign-in email." }
      : admins.some((a) => !EMAIL.test(a))
        ? { id: "env.admins", area: "environment", status: bad(), title: "CLUTCH_ADMIN_EMAILS malformed", detail: `${admins.filter((a) => !EMAIL.test(a)).length} entr${admins.filter((a) => !EMAIL.test(a)).length === 1 ? "y isn't" : "ies aren't"} an email address.`, next: "Use a comma-separated list of email addresses." }
        : { id: "env.admins", area: "environment", status: "PASS", title: "Reviewers configured", detail: `${admins.length} reviewer account${admins.length === 1 ? "" : "s"} (addresses not shown).` },
  );

  // ------------------------------------------------------------------ public URL
  add(
    !appUrl
      ? { id: "app_url.set", area: "app_url", status: bad(), title: "APP_URL missing", detail: "Email links and the identity return URL need the public address.", next: "Set APP_URL to the public https origin, e.g. https://mechanicmarketplace.vercel.app (no trailing slash)." }
      : !http(appUrl)
        ? { id: "app_url.set", area: "app_url", status: bad(), title: "APP_URL isn't a public https address", detail: `It must start with https:// and not be localhost (got ${appUrl.startsWith("https://") ? "a local host" : "a non-https address"}).`, next: "Set APP_URL to the public https origin." }
        : { id: "app_url.set", area: "app_url", status: "PASS", title: "APP_URL set", detail: appUrl },
  );
  if ((env.APP_URL ?? "").trim().endsWith("/")) add({ id: "app_url.slash", area: "app_url", status: "WARN", title: "APP_URL ends with a slash", detail: "Links would contain a double slash.", next: "Remove the trailing slash." });

  // ------------------------------------------------------------------ auth (Supabase)
  const sbUrl = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/$/, "");
  const sbKey = (env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  add(
    !sbUrl || !sbKey
      ? { id: "auth.config", area: "auth", status: bad(), title: "Supabase Auth not configured", detail: `${!sbUrl ? "NEXT_PUBLIC_SUPABASE_URL" : ""}${!sbUrl && !sbKey ? " and " : ""}${!sbKey ? "the publishable key" : ""} missing.`, next: "Copy the project URL and publishable key from Supabase → Project Settings → API into the environment." }
      : !/^https:\/\//.test(sbUrl)
        ? { id: "auth.config", area: "auth", status: bad(), title: "Supabase URL isn't https", detail: "NEXT_PUBLIC_SUPABASE_URL must be the project's https URL.", next: "Use https://<project>.supabase.co." }
        : { id: "auth.config", area: "auth", status: "PASS", title: "Supabase Auth configured", detail: `Project ${sbUrl.replace(/^https:\/\//, "")}; publishable key set (not shown).` },
  );
  if (sbKey && (/^sb_secret_/.test(sbKey) || jwtRole(sbKey) === "service_role"))
    add({ id: "auth.key_leak", area: "auth", status: "BLOCKED", title: "A secret Supabase key is in a public variable", detail: "NEXT_PUBLIC_ variables are sent to every browser. A service/secret key there gives anyone full database access.", next: "Rotate that key in Supabase now, and put only the publishable (anon) key in NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY." });
  if (appUrl && http(appUrl))
    add({ id: "auth.redirects", area: "auth", status: "WARN", manual: true, title: "Confirm Supabase redirect URLs", detail: `Site URL should be ${appUrl}; allowed redirects must include ${appUrl}/auth/callback and ${appUrl}/auth/confirm. Supabase doesn't expose this to a read-only check.`, next: "Supabase → Authentication → URL Configuration: set Site URL and add both redirect URLs." });

  // ------------------------------------------------------------------ documents
  const signing = env.CLUTCH_SIGNING_SECRET || env.AUTH_SECRET || "";
  add(
    signing.length >= 32
      ? { id: "documents.signing", area: "documents", status: "PASS", title: "Document links can be signed", detail: env.CLUTCH_SIGNING_SECRET ? "CLUTCH_SIGNING_SECRET set (not shown)." : "Falls back to AUTH_SECRET (not shown)." }
      : { id: "documents.signing", area: "documents", status: bad(), title: "No secret to sign document links", detail: "Reviewers couldn't open verification documents.", next: "Set CLUTCH_SIGNING_SECRET (or AUTH_SECRET) to 32+ random bytes." },
  );

  // ------------------------------------------------------------------ email / outbound alerts
  const dc = deliveryConfig(env);
  add(
    !dc.switchOn
      ? { id: "email.alerts", area: "email", status: "WARN", title: "Outbound email alerts are disabled", detail: "Only in-app notifications are sent, and the app says so. Account emails (sign-up, password reset) come from Supabase Auth.", next: "Optional: choose a provider and follow the checklist in /admin/delivery before setting CLUTCH_OUTBOUND_ALERTS=on." }
      : dc.ready
        ? { id: "email.alerts", area: "email", status: "PASS", title: "Outbound alerts configured", detail: `Provider ${dc.provider}.` }
        : { id: "email.alerts", area: "email", status: bad(), title: "Alerts switched on but not ready", detail: `Missing: ${dc.checks.filter((c) => c.ok === false).map((c) => c.label).join(", ")}.`, next: "Complete the items above, or set CLUTCH_OUTBOUND_ALERTS=off (alerts then wait safely as 'no provider')." },
  );

  // ------------------------------------------------------------------ cron
  const cron = env.CLUTCH_CRON_SECRET ?? "";
  const crons = input.crons ?? [];
  add(
    !cron
      ? { id: "cron.secret", area: "cron", status: "WARN", title: "Scheduled jobs are off", detail: "CLUTCH_CRON_SECRET is unset, so /api/cron/* return 404: no renewal reminders or alert delivery. Expiry is still enforced at every read.", next: "Set CLUTCH_CRON_SECRET to 32+ random bytes, then schedule the jobs (next item)." }
      : cron.length < 24
        ? { id: "cron.secret", area: "cron", status: bad(), title: "CLUTCH_CRON_SECRET is too short", detail: `${cron.length} characters; use at least 24.`, next: "Replace it with 32+ random bytes." }
        : { id: "cron.secret", area: "cron", status: "PASS", title: "Cron endpoints protected", detail: "CLUTCH_CRON_SECRET set (not shown); requests need it as a bearer token." },
  );
  // The cron routes accept POST with a bearer token. Vercel Cron sends GET, so it can't drive them;
  // a scheduler that POSTs (e.g. a GitHub Actions scheduled workflow) must. Alert delivery only
  // needs a schedule once alerts are switched on.
  const wanted = ["/api/cron/verification-renewals", ...(dc.switchOn ? ["/api/cron/deliver-alerts"] : [])];
  const posts = crons.filter((c) => c.method === "POST").map((c) => c.path);
  const viaGet = crons.filter((c) => c.method === "GET" && wanted.includes(c.path)).map((c) => c.path);
  const missing = wanted.filter((w) => !posts.includes(w));
  if (viaGet.length)
    add({ id: "cron.method", area: "cron", status: bad(), title: "Vercel Cron can't call these jobs", detail: `vercel.json schedules ${viaGet.join(" and ")}, but Vercel Cron sends GET and the routes accept POST only (405).`, next: "Remove those vercel.json crons and schedule a POST instead (next item)." });
  add(
    missing.length
      ? { id: "cron.schedule", area: "cron", status: "WARN", title: "Jobs not scheduled", detail: `Nothing in this repository POSTs to ${missing.join(" or ")}${!dc.switchOn ? " (alert delivery isn't needed while alerts are off)" : ""}. Renewal reminders and lapse notices don't go out; expiry itself is still enforced on every read.`, next: `Add a scheduled workflow (.github/workflows/cron.yml, e.g. daily "0 15 * * *") that runs: curl -fsS -X POST -H "Authorization: Bearer $CLUTCH_CRON_SECRET" "$APP_URL/api/cron/verification-renewals", with CLUTCH_CRON_SECRET and APP_URL stored as repository secrets (never in the file).` }
      : { id: "cron.schedule", area: "cron", status: "PASS", title: "Jobs scheduled", detail: `A scheduled workflow POSTs to ${wanted.join(" and ")}.` },
  );

  // ------------------------------------------------------------------ identity (Stripe Identity)
  const idp = env.CLUTCH_IDENTITY_PROVIDER ?? "";
  if (!idp) {
    add({ id: "identity.provider", area: "identity", status: "WARN", title: "Identity verification is disabled (optional)", detail: "Mechanics see 'not available yet' and nothing reads as verified. This is safe, not configured.", next: "When ready: follow docs/verification.md (Stripe Identity setup), then set CLUTCH_IDENTITY_PROVIDER=stripe_identity." });
  } else if (idp === "test") {
    add({ id: "identity.provider", area: "identity", status: bad(), title: "Identity uses the test provider", detail: "It fakes results; only for tests and the fictional demo.", next: "Unset CLUTCH_IDENTITY_PROVIDER, or set it to stripe_identity with live keys." });
  } else if (idp !== "stripe_identity") {
    add({ id: "identity.provider", area: "identity", status: "BLOCKED", title: `Unknown identity provider "${idp}"`, detail: "Only stripe_identity is implemented.", next: "Set CLUTCH_IDENTITY_PROVIDER=stripe_identity or unset it." });
  } else {
    const key = env.STRIPE_IDENTITY_SECRET_KEY ?? "";
    const hook = env.STRIPE_IDENTITY_WEBHOOK_SECRET ?? "";
    const testKey = /^(rk|sk)_test_/.test(key);
    add(
      !/^(rk|sk)_(live|test)_[A-Za-z0-9]+$/.test(key)
        ? { id: "identity.key", area: "identity", status: "BLOCKED", title: "Stripe Identity key missing or malformed", detail: "STRIPE_IDENTITY_SECRET_KEY must be a Stripe restricted (rk_) or secret (sk_) key.", next: "Create a restricted key with Identity: write in the Stripe dashboard and set it." }
        : testKey && prod
          ? { id: "identity.key", area: "identity", status: "BLOCKED", title: "Stripe test-mode key in production", detail: "Test-mode sessions never check real IDs; nothing verified with it would be real.", next: "Use a live restricted key (rk_live_…) in production; keep rk_test_ keys for previews." }
          : /^sk_/.test(key)
            ? { id: "identity.key", area: "identity", status: "WARN", title: "Full Stripe secret key used", detail: `A ${testKey ? "test" : "live"} secret key works, but grants far more than Identity.`, next: "Replace it with a restricted key limited to Identity: write." }
            : { id: "identity.key", area: "identity", status: "PASS", title: `Stripe restricted key (${testKey ? "test" : "live"} mode)`, detail: "Set (not shown)." },
    );
    add(
      /^whsec_[A-Za-z0-9]+$/.test(hook)
        ? { id: "identity.webhook", area: "identity", status: "PASS", title: "Webhook signing secret set", detail: "Not shown." }
        : { id: "identity.webhook", area: "identity", status: "BLOCKED", title: "Webhook signing secret missing or malformed", detail: "Without it every identity webhook is refused.", next: "Copy the endpoint's signing secret (whsec_…) from Stripe → Developers → Webhooks." },
    );
    if (appUrl && http(appUrl))
      add({ id: "identity.urls", area: "identity", status: "WARN", manual: true, title: "Confirm the Stripe webhook endpoint", detail: `Endpoint ${appUrl}/api/verification/webhook/stripe_identity for identity.verification_session.* events; the return URL ${appUrl}/mechanic/verification/identity/return is set per session by the server.`, next: "In Stripe → Webhooks, confirm that endpoint exists (live mode in production) and lists the four identity.verification_session events." });
  }

  // ------------------------------------------------------------------ background checks
  const bg = env.CLUTCH_BACKGROUND_PROVIDER ?? "";
  add(
    !bg
      ? { id: "background.provider", area: "background", status: "WARN", title: "Background and driving checks are disabled (optional)", detail: "No provider and no approved policy: mechanics see 'not available yet'. Nothing is invented.", next: "Business decision first: choose a provider and approve an adjudication policy (docs/verification.md)." }
      : { id: "background.provider", area: "background", status: "BLOCKED", title: `Background provider "${bg}" has no adapter`, detail: "This build ships no background-check adapter; checks would never run.", next: "Unset CLUTCH_BACKGROUND_PROVIDER until an adapter is implemented." },
  );

  // ------------------------------------------------------------------ legal and support
  const routes = input.routes ?? [];
  for (const [path, name] of [
    ["/privacy", "Privacy page"],
    ["/help", "Help and support page"],
    ["/verification", "How verification works"],
  ] as const)
    add(routes.includes(path) ? { id: `legal.${path.slice(1)}`, area: "legal", status: "PASS", title: name, detail: `${path} exists.` } : { id: `legal.${path.slice(1)}`, area: "legal", status: bad(), title: `${name} missing`, detail: `${path} isn't in this build.`, next: `Add ${path}.` });
  add(
    routes.includes("/terms")
      ? { id: "legal.terms", area: "legal", status: "PASS", title: "Terms of service", detail: "/terms exists." }
      : { id: "legal.terms", area: "legal", status: "WARN", title: "No terms of service", detail: "There's no /terms page. The privacy page is marked an MVP draft pending legal review.", next: "Business/legal decision: have terms and the privacy draft reviewed, then add /terms." },
  );

  // ------------------------------------------------------------------ online probes (read-only)
  if (input.online && !input.db) {
    add({ id: "database.connect", area: "database", status: bad(), title: "DATABASE_URL missing", detail: "Without it the app runs on in-memory data that's lost on every restart.", next: "Set DATABASE_URL to the Supabase pooler connection string (port 6543)." });
  } else if (!input.db) {
    add({ id: "database.connect", area: "database", status: "WARN", title: "Database not checked", detail: "Run with --online to check connectivity, schema versions, isolation and upload policies (read-only).", next: "npm run preflight -- --online (with the target environment's variables)." });
  } else {
    await dbChecks(input.db, add, { bad, expected: input.expectedSchemaKeys ?? [], demoOn: env.CLUTCH_DEMO_LOGINS !== "off", normalized: env.CLUTCH_LIVE_STORE === "normalized" });
  }
  if (input.http && sbUrl && sbKey) await authProbe(input.http, sbUrl, sbKey, add, bad);
  if (input.http && appUrl && http(appUrl)) await siteProbe(input.http, appUrl, add, bad);
  if (input.http && idp === "stripe_identity" && /^(rk|sk)_(live|test)_/.test(env.STRIPE_IDENTITY_SECRET_KEY ?? "")) await stripeProbe(input.http, env.STRIPE_IDENTITY_SECRET_KEY!, add);

  const report: Report = {
    target,
    online: Boolean(input.online || input.db || input.http),
    source: input.source ?? "the process environment",
    generatedAt: (input.now ?? new Date()).toISOString(),
    ready: !items.some((i) => i.status === "BLOCKED"),
    summary: { pass: items.filter((i) => i.status === "PASS").length, warn: items.filter((i) => i.status === "WARN").length, blocked: items.filter((i) => i.status === "BLOCKED").length },
    items,
  };
  return redact(report, env);
}

async function dbChecks(db: DbProbe, add: (i: Item) => void, o: { bad: () => Status; expected: string[]; demoOn: boolean; normalized: boolean }) {
  let version = "";
  try {
    const [r] = await db<{ v: string; ro: string }>(`select current_setting('server_version') as v, current_setting('transaction_read_only') as ro`);
    version = r.v;
    add({ id: "database.connect", area: "database", status: "PASS", title: "Database reachable (read-only session)", detail: `Postgres ${version}; this check ran with transaction_read_only=${r.ro}.` });
  } catch (e) {
    add({ id: "database.connect", area: "database", status: "BLOCKED", title: "Database unreachable", detail: `The connection failed (${(e as Error).message.split("\n")[0].slice(0, 120)}).`, next: "Check DATABASE_URL points at the Supabase pooler (port 6543) with the right password." });
    return;
  }
  const tables = (await db<{ t: string }>(`select table_name as t from information_schema.tables where table_schema = 'public'`)).map((r) => r.t);
  const base = ["app_meta", "app_records", "app_events", "app_media"];
  const missingBase = base.filter((t) => !tables.includes(t));
  add(
    missingBase.length
      ? { id: "database.tables", area: "database", status: o.bad(), title: "App tables missing", detail: `Missing: ${missingBase.join(", ")}.`, next: "Apply supabase/migrations/0002_app_store.sql and 0003_data_scope.sql (the app also creates them on first start)." }
      : { id: "database.tables", area: "database", status: "PASS", title: "App tables present", detail: base.join(", ") },
  );
  if (missingBase.length) return;
  const applied = tables.includes("clutch_schema") ? (await db<{ key: string }>(`select key from clutch_schema`)).map((r) => r.key) : [];
  const pending = o.expected.filter((k) => !applied.includes(k));
  add(
    pending.length
      ? { id: "database.versions", area: "database", status: "WARN", title: "Schema changes pending for this build", detail: `${pending.length} of ${o.expected.length} versions aren't recorded yet (${pending.map((k) => k.split(":")[0]).join(", ")}). They're additive and apply once, under a lock, when this build first starts.`, next: "Expected on a new deploy. After deploying, rerun this preflight: they should be recorded." }
      : { id: "database.versions", area: "database", status: "PASS", title: "Schema versions current", detail: `${o.expected.length} expected versions recorded.` },
  );
  const meta = (await db<{ key: string }>(`select key from app_meta`)).map((r) => r.key);
  add(
    meta.includes("scope_v1") && meta.includes("scope_v2")
      ? { id: "database.scope_migration", area: "database", status: "PASS", title: "Live/demo split recorded", detail: "scope_v1 and scope_v2 are done." }
      : { id: "database.scope_migration", area: "database", status: "WARN", title: "Live/demo split not recorded", detail: "It runs on first start (backup-first).", next: "Start the app once, then rerun this preflight." },
  );
  const [old] = await db<{ n: number }>(`select count(*)::int as n from app_records where scope = 'live' and collection in ('verifications', 'screenings') and data->>'status' in ('not_submitted', 'pending', 'rejected', 'needs_info', 'reverification_required')`);
  add(
    old.n
      ? { id: "database.verification_backfill", area: "database", status: "WARN", title: "Verification records use older status words", detail: `${old.n} live record${old.n === 1 ? "" : "s"}; the app reads them correctly, but their history isn't stored yet.`, next: "npm run db:migrate-verifications (dry run), review, then --apply with approval." }
      : { id: "database.verification_backfill", area: "database", status: "PASS", title: "Verification records canonical", detail: "No older status words in the live scope." },
  );
  if (o.normalized) {
    const need = ["lv_verifications", "lv_mechanics", "lv_requests"].filter((t) => !tables.includes(t));
    add(need.length ? { id: "database.normalized", area: "database", status: o.bad(), title: "Normalized store on, tables missing", detail: `Missing: ${need.join(", ")}.`, next: "Unset CLUTCH_LIVE_STORE or complete docs/live-reads.md." } : { id: "database.normalized", area: "database", status: "PASS", title: "Normalized tables present", detail: "lv_* tables exist." });
  }

  // isolation
  const [flagged] = await db<{ n: number }>(`select count(*)::int as n from app_records where scope = 'live' and collection = 'users' and data->>'demo' = 'true'`);
  add(
    flagged.n
      ? { id: "isolation.demo_users", area: "isolation", status: "BLOCKED", title: "Demo accounts in the live marketplace", detail: `${flagged.n} live account${flagged.n === 1 ? " is" : "s are"} flagged demo.`, next: "Investigate before release; the scope checks (lib/data/classify.ts) should have quarantined them." }
      : { id: "isolation.demo_users", area: "isolation", status: "PASS", title: "No demo accounts in the live marketplace", detail: "Checked live users." },
  );
  const [shared] = await db<{ n: number }>(`select count(*)::int as n from app_records l join app_records d on d.collection = l.collection and d.id = l.id where l.scope = 'live' and d.scope = 'demo' and l.collection <> '_kv'`);
  add(
    shared.n
      ? { id: "isolation.shared_ids", area: "isolation", status: "WARN", title: "Records with the same id in live and demo", detail: `${shared.n} id${shared.n === 1 ? "" : "s"} exist in both scopes.`, next: "Review them; each scope only ever reads its own, but ids shouldn't collide." }
      : { id: "isolation.shared_ids", area: "isolation", status: "PASS", title: "No ids shared between live and demo", detail: "Checked every collection (each scope's own settings rows excepted)." },
  );
  const [demoFlag] = await db<{ n: number }>(`select count(*)::int as n from app_records where scope = 'live' and collection = 'mechanics' and data->>'isDemo' = 'true'`);
  if (demoFlag.n)
    add({ id: "isolation.demo_flags", area: "isolation", status: "WARN", title: "Live mechanics carry the old demo flag", detail: `${demoFlag.n} record${demoFlag.n === 1 ? "" : "s"}; nothing reads it, but it shouldn't be there.`, next: "npm run db:repair-demo-flags (dry run), then --apply with approval." });
  add(
    o.demoOn
      ? { id: "isolation.demo_public", area: "isolation", status: "WARN", title: "The public demo is on", detail: "Anyone can open the fictional demo marketplace. It's a separate scope, labelled on every page.", next: "Keep it (a product decision) or set CLUTCH_DEMO_LOGINS=off." }
      : { id: "isolation.demo_public", area: "isolation", status: "PASS", title: "Public demo is off", detail: "CLUTCH_DEMO_LOGINS=off." },
  );

  // Uploaded files live in app_media, everything else in the other app tables. The app reads them
  // over its own server connection; the Supabase REST API (anon/authenticated roles) must reach none.
  const guarded = tables.filter((t) => t.startsWith("app_") || t.startsWith("lv_") || t === "clutch_schema");
  const open = (await db<{ t: string }>(`select c.relname as t from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname = any($1) and not c.relrowsecurity`, [guarded])).map((r) => r.t);
  const policies = await db<{ name: string; t: string }>(`select policyname as name, tablename as t from pg_policies where schemaname = 'public' and tablename = any($1)`, [guarded]);
  add(
    open.length
      ? { id: "documents.rls", area: "documents", status: "BLOCKED", title: "App data not protected from the Supabase API", detail: `Row level security is off on ${open.join(", ")}${open.includes("app_media") ? ": uploaded files could be read with the public key" : ""}.`, next: `Run: ${open.map((t) => `alter table ${t} enable row level security;`).join(" ")} (as in supabase/migrations/0002_app_store.sql).` }
      : policies.length
        ? { id: "documents.rls", area: "documents", status: "BLOCKED", title: "A policy opens app data to the Supabase API", detail: `${policies.length} polic${policies.length === 1 ? "y" : "ies"}: ${policies.map((p) => `${p.name} on ${p.t}`).join(", ")}.`, next: "Drop those policies: the app reads through its own server connection only." }
        : { id: "documents.rls", area: "documents", status: "PASS", title: "Uploads and records are private", detail: `Row level security on ${guarded.length} app tables with no policies: only the app's server connection can read them.` },
  );
}

async function authProbe(fetcher: HttpProbe, sbUrl: string, key: string, add: (i: Item) => void, bad: () => Status) {
  try {
    const r = await fetcher(`${sbUrl}/auth/v1/settings`, { headers: { apikey: key } });
    if (r.status !== 200) {
      add({ id: "auth.reachable", area: "auth", status: bad(), title: "Supabase Auth didn't answer", detail: `GET /auth/v1/settings returned ${r.status}.`, next: "Check the project URL and publishable key." });
      return;
    }
    const s = (r.json ?? {}) as { external?: Record<string, boolean>; mailer_autoconfirm?: boolean; disable_signup?: boolean };
    add({ id: "auth.reachable", area: "auth", status: "PASS", title: "Supabase Auth reachable", detail: `Google sign-in ${s.external?.google ? "on" : "off"}; email sign-up ${s.disable_signup ? "disabled" : "enabled"}.` });
    if (s.mailer_autoconfirm) add({ id: "auth.confirm_email", area: "auth", status: "WARN", title: "Email confirmation is off", detail: "Accounts are created without confirming the address; the email check would then be unproven.", next: "Supabase → Authentication → Providers → Email: turn on 'Confirm email'." });
  } catch (e) {
    add({ id: "auth.reachable", area: "auth", status: bad(), title: "Supabase Auth unreachable", detail: (e as Error).message.slice(0, 120), next: "Check the project URL." });
  }
  try {
    const r = await fetcher(`${sbUrl}/rest/v1/app_media?select=id&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    const rows = Array.isArray(r.json) ? r.json.length : 0;
    add(
      r.status === 200 && rows > 0
        ? { id: "documents.public_api", area: "documents", status: "BLOCKED", title: "Uploaded files readable through the public API", detail: "The publishable key returned rows from app_media.", next: "Enable row level security and drop any policies on app_media immediately." }
        : { id: "documents.public_api", area: "documents", status: "PASS", title: "Uploads not readable through the public API", detail: `A read with the publishable key returned ${r.status === 200 ? "no rows" : `HTTP ${r.status}`}.` },
    );
  } catch {
    add({ id: "documents.public_api", area: "documents", status: "WARN", title: "Couldn't test the public API", detail: "The request failed.", next: "Rerun with --online." });
  }
}

async function siteProbe(fetcher: HttpProbe, appUrl: string, add: (i: Item) => void, bad: () => Status) {
  for (const path of ["/", "/privacy", "/help"]) {
    try {
      const r = await fetcher(`${appUrl}${path}`);
      add(r.status === 200 ? { id: `app_url.get${path === "/" ? "_home" : path.replace("/", "_")}`, area: "app_url", status: "PASS", title: `${path} answers`, detail: "HTTP 200." } : { id: `app_url.get${path === "/" ? "_home" : path.replace("/", "_")}`, area: "app_url", status: bad(), title: `${path} didn't answer`, detail: `HTTP ${r.status}.`, next: "Check the deployment." });
    } catch (e) {
      add({ id: `app_url.get${path === "/" ? "_home" : path.replace("/", "_")}`, area: "app_url", status: bad(), title: `${path} unreachable`, detail: (e as Error).message.slice(0, 120), next: "Check the deployment and APP_URL." });
    }
  }
}

async function stripeProbe(fetcher: HttpProbe, key: string, add: (i: Item) => void) {
  try {
    // Read-only: lists at most one session.
    const r = await fetcher("https://api.stripe.com/v1/identity/verification_sessions?limit=1", { headers: { Authorization: `Bearer ${key}` } });
    add(
      r.status === 200
        ? { id: "identity.key_works", area: "identity", status: "PASS", title: "Stripe accepts the key for Identity", detail: "A read-only list call succeeded." }
        : { id: "identity.key_works", area: "identity", status: "BLOCKED", title: "Stripe refused the key", detail: `HTTP ${r.status} (revoked, wrong mode, or missing the Identity permission).`, next: "Create a restricted key with Identity: write and replace it." },
    );
  } catch (e) {
    add({ id: "identity.key_works", area: "identity", status: "WARN", title: "Couldn't reach Stripe", detail: (e as Error).message.slice(0, 120), next: "Rerun with --online." });
  }
}

/** The payload role of a JWT-style Supabase key (legacy anon/service_role keys), if it is one. */
function jwtRole(k: string) {
  const part = k.split(".")[1];
  if (!part) return undefined;
  try {
    return (JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { role?: string }).role;
  } catch {
    return undefined;
  }
}

/** Scrub every secret value (and the database password) from every string in the report. */
export function redact(report: Report, env: Env): Report {
  const secrets = SECRET_VARS.map((k) => env[k]?.trim()).filter((v): v is string => Boolean(v && v.length >= 6));
  const dbPass = (() => {
    try {
      return env.DATABASE_URL ? decodeURIComponent(new URL(env.DATABASE_URL).password) : "";
    } catch {
      return "";
    }
  })();
  if (dbPass.length >= 4) secrets.push(dbPass);
  const scrub = (s: string) => secrets.reduce((acc, v) => acc.split(v).join("[redacted]"), s);
  return JSON.parse(scrub(JSON.stringify(report))) as Report;
}

const MARK: Record<Status, string> = { PASS: "PASS   ", WARN: "WARN   ", BLOCKED: "BLOCKED" };

/** The human summary: blocked first, then warnings, then passes; each with its next step. */
export function formatHuman(r: Report) {
  const order: Status[] = ["BLOCKED", "WARN", "PASS"];
  const lines = [
    `Clutch release preflight · target ${r.target} · ${r.online ? "online (read-only)" : "offline (configuration only)"} · ${r.generatedAt}`,
    `Configuration checked: ${r.source}. It speaks for that configuration only, not for another environment's settings.`,
    `${r.ready ? "READY: nothing blocks" : "NOT READY"} · ${r.summary.blocked} blocked · ${r.summary.warn} warnings · ${r.summary.pass} passed`,
    "",
  ];
  for (const st of order)
    for (const i of r.items.filter((x) => x.status === st)) {
      lines.push(`${MARK[i.status]}  [${i.area}] ${i.title}${i.manual ? " (confirm by hand)" : ""}`);
      lines.push(`         ${i.detail}`);
      if (i.next && i.status !== "PASS") lines.push(`         Next: ${i.next}`);
    }
  return lines.join("\n");
}
