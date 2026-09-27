import { test } from "node:test";
import assert from "node:assert/strict";
import { formatHuman, runPreflight, SECRET_VARS, type DbProbe, type HttpProbe, type Item, type Report } from "@/lib/release/preflight";
import { expectedSchemaKeys } from "@/lib/release/probes";

/**
 * The release preflight on fictional environments (no network, no database: probes are fakes):
 * missing, malformed, test mode in production, and fully configured. Disabled optional providers
 * must read as disabled, never as configured, and no secret value may appear in any output.
 */

const ROUTES = ["/privacy", "/help", "/verification", "/terms"];
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** A fictional key with a real key's prefix, assembled at runtime so the source never holds a key-shaped literal. */
const keyLike = (...prefix: string[]) => [...prefix, "FICTIONAL0000000000000000"].join("_");
// Fictional values, shaped like the real ones.
const S = {
  auth: "auth-secret-0123456789abcdef0123456789abcdef",
  signing: "signing-secret-0123456789abcdef0123456789ab",
  cron: "cron-secret-0123456789abcdef0123456789abcd",
  dbPass: "db-pass-Zq81xV2",
  anon: keyLike("sb", "publishable"),
  stripeLive: keyLike("rk", "live"),
  stripeTest: keyLike("rk", "test"),
  whsec: keyLike("whsec"),
};
const GOOD = {
  APP_URL: "https://clutch.example.test",
  AUTH_SECRET: S.auth,
  CLUTCH_SIGNING_SECRET: S.signing,
  CLUTCH_CRON_SECRET: S.cron,
  DATABASE_URL: `postgresql://postgres.fictional:${S.dbPass}@db.example.test:6543/postgres`,
  NEXT_PUBLIC_SUPABASE_URL: "https://fictional.supabase.example.test",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: S.anon,
  CLUTCH_ADMIN_EMAILS: "staff@example.test",
  CLUTCH_DEMO_LOGINS: "off",
  CLUTCH_IDENTITY_PROVIDER: "stripe_identity",
  STRIPE_IDENTITY_SECRET_KEY: S.stripeLive,
  STRIPE_IDENTITY_WEBHOOK_SECRET: S.whsec,
};
const CRONS = [{ path: "/api/cron/verification-renewals", method: "POST" as const }];

/** A database that answers like a healthy production one; records every statement it's sent. */
function healthyDb(over: Partial<Record<string, unknown[]>> = {}) {
  const seen: string[] = [];
  const probe: DbProbe = async (q) => {
    seen.push(q);
    const pick = (k: string, v: unknown[]) => (k in over ? over[k]! : v) as never[];
    if (q.includes("server_version")) return pick("version", [{ v: "17.4", ro: "on" }]);
    if (q.includes("information_schema.tables")) return pick("tables", ["app_meta", "app_records", "app_events", "app_media", "app_scope_backup", "clutch_schema"].map((t) => ({ t })));
    if (q.includes("from clutch_schema")) return pick("schema", expectedSchemaKeys().map((key) => ({ key })));
    if (q.includes("from app_meta")) return pick("meta", [{ key: "main" }, { key: "demo" }, { key: "scope_v1" }, { key: "scope_v2" }]);
    if (q.includes("'verifications', 'screenings'")) return pick("old", [{ n: 0 }]);
    if (q.includes("collection = 'users'")) return pick("demoUsers", [{ n: 0 }]);
    if (q.includes("join app_records d")) return pick("shared", [{ n: 0 }]);
    if (q.includes("'isDemo'")) return pick("isDemo", [{ n: 0 }]);
    if (q.includes("relrowsecurity")) return pick("open", []);
    if (q.includes("pg_policies")) return pick("policies", []);
    throw new Error(`unexpected query: ${q}`);
  };
  return { probe, seen };
}

/** Public endpoints answering like a healthy deployment; records every request. */
function healthyHttp(over: Record<string, { status: number; json?: unknown }> = {}) {
  const seen: { url: string; headers?: Record<string, string> }[] = [];
  const probe: HttpProbe = async (url, init) => {
    seen.push({ url, headers: init?.headers });
    for (const [k, v] of Object.entries(over)) if (url.includes(k)) return v;
    if (url.includes("/auth/v1/settings")) return { status: 200, json: { external: { google: true }, mailer_autoconfirm: false, disable_signup: false } };
    if (url.includes("/rest/v1/app_media")) return { status: 200, json: [] };
    if (url.includes("api.stripe.com")) return { status: 200, json: { data: [] } };
    return { status: 200 };
  };
  return { probe, seen };
}

const byId = (r: Report, id: string) => r.items.find((i) => i.id === id) as Item;
const blocked = (r: Report) => r.items.filter((i) => i.status === "BLOCKED").map((i) => i.id);
/** Nothing secret, anywhere: the JSON, the human summary, every id, detail and next step. */
function assertNoSecrets(r: Report, env: Record<string, string | undefined>) {
  const out = JSON.stringify(r) + formatHuman(r);
  for (const k of SECRET_VARS) if (env[k] && env[k]!.length >= 6) assert.ok(!out.includes(env[k]!), `${k}'s value leaked`);
  for (const v of Object.values(S)) assert.ok(!out.includes(v), `a secret leaked (${v.slice(0, 4)}…)`);
}

test("missing: an empty production environment is NOT READY, with the exact blockers and honest 'disabled' labels", async () => {
  const r = await runPreflight({ env: {}, target: "production", routes: ROUTES, crons: [] });
  assert.equal(r.ready, false);
  for (const id of ["env.auth_secret", "app_url.set", "auth.config", "documents.signing"]) assert.equal(byId(r, id).status, "BLOCKED", id);
  // Optional providers that are off say so; none of them is a PASS.
  assert.equal(byId(r, "identity.provider").status, "WARN");
  assert.match(byId(r, "identity.provider").title, /disabled \(optional\)/);
  assert.equal(byId(r, "background.provider").status, "WARN");
  assert.match(byId(r, "background.provider").title, /disabled \(optional\)/);
  assert.equal(byId(r, "email.alerts").status, "WARN");
  assert.match(byId(r, "email.alerts").title, /disabled/);
  assert.equal(byId(r, "cron.secret").status, "WARN");
  assert.equal(byId(r, "database.connect").status, "WARN", "offline: the database wasn't checked, and it says so");
  assert.ok(!r.items.some((i) => i.area === "identity" && i.status === "PASS"));
  // Every problem carries a next step.
  for (const i of r.items.filter((x) => x.status !== "PASS")) assert.ok(i.next, `${i.id} has no next step`);
  assert.deepEqual(r.summary, { pass: r.items.filter((i) => i.status === "PASS").length, warn: r.items.filter((i) => i.status === "WARN").length, blocked: r.items.filter((i) => i.status === "BLOCKED").length });
  const online = await runPreflight({ env: {}, target: "production", online: true, http: healthyHttp().probe, routes: ROUTES });
  assert.equal(byId(online, "database.connect").status, "BLOCKED", "--online without DATABASE_URL: data would be lost on restart");
});

test("malformed: wrong shapes are caught without echoing the values", async () => {
  const serviceRole = `${b64({ alg: "HS256" })}.${b64({ role: "service_role", ref: "fictional" })}.FICTIONALsignature`;
  const env = {
    APP_URL: "http://localhost:3000/",
    AUTH_SECRET: "short-secret",
    NEXT_PUBLIC_SUPABASE_URL: "http://fictional.supabase.example.test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: serviceRole,
    CLUTCH_CRON_SECRET: "tooshort-cron",
    CLUTCH_ADMIN_EMAILS: "staff@example.test, not-an-email",
    CLUTCH_IDENTITY_PROVIDER: "stripe_identity",
    STRIPE_IDENTITY_SECRET_KEY: keyLike("pk", "live"),
    STRIPE_IDENTITY_WEBHOOK_SECRET: "FICTIONAL-not-a-whsec",
    CLUTCH_BACKGROUND_PROVIDER: "checkr",
    CLUTCH_OUTBOUND_ALERTS: "on",
  };
  const r = await runPreflight({ env, target: "production", routes: ROUTES, crons: [{ path: "/api/cron/verification-renewals", method: "GET" }] });
  const b = blocked(r);
  for (const id of ["env.auth_secret", "app_url.set", "auth.config", "auth.key_leak", "cron.secret", "env.admins", "identity.key", "identity.webhook", "background.provider", "email.alerts", "cron.method", "documents.signing"]) assert.ok(b.includes(id), `${id} should block; blocked: ${b.join(", ")}`);
  assert.equal(byId(r, "app_url.slash").status, "WARN");
  assert.match(byId(r, "auth.key_leak").next!, /Rotate/);
  assert.match(byId(r, "cron.method").detail, /GET.*POST only/);
  assert.match(byId(r, "env.auth_secret").detail, /12 characters/, "the length, never the value");
  assertNoSecrets(r, env);
  const out = JSON.stringify(r);
  for (const v of [env.AUTH_SECRET, env.CLUTCH_CRON_SECRET, env.STRIPE_IDENTITY_SECRET_KEY, env.STRIPE_IDENTITY_WEBHOOK_SECRET, serviceRole]) assert.ok(!out.includes(v), "malformed values aren't echoed either");
  assert.ok(!out.includes("not-an-email"), "reviewer addresses aren't printed");
  // A secret-format Supabase key in the public variable is caught too.
  const r2 = await runPreflight({ env: { ...GOOD, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: keyLike("sb", "secret") }, target: "production", routes: ROUTES, crons: CRONS });
  assert.equal(byId(r2, "auth.key_leak").status, "BLOCKED");
  assert.ok(!JSON.stringify(r2).includes(keyLike("sb", "secret")));
  const unknown = await runPreflight({ env: { ...GOOD, CLUTCH_IDENTITY_PROVIDER: "persona" }, target: "production", routes: ROUTES, crons: CRONS });
  assert.equal(byId(unknown, "identity.provider").status, "BLOCKED");
});

test("test mode in production: test switches and Stripe test keys block production, but only warn on a preview", async () => {
  const env = { ...GOOD, CLUTCH_TEST_LOGINS: "on", CLUTCH_TEST_PROVIDERS: "on", CLUTCH_VEHICLE_DATA: "fixtures", STRIPE_IDENTITY_SECRET_KEY: S.stripeTest };
  const prod = await runPreflight({ env, target: "production", routes: ROUTES, crons: CRONS });
  assert.equal(prod.ready, false);
  assert.equal(byId(prod, "env.test_switches").status, "BLOCKED");
  for (const k of ["CLUTCH_TEST_LOGINS", "CLUTCH_TEST_PROVIDERS", "CLUTCH_VEHICLE_DATA"]) assert.match(byId(prod, "env.test_switches").detail, new RegExp(k));
  assert.equal(byId(prod, "identity.key").status, "BLOCKED");
  assert.match(byId(prod, "identity.key").title, /test-mode key in production/);
  const fake = await runPreflight({ env: { ...GOOD, CLUTCH_IDENTITY_PROVIDER: "test" }, target: "production", routes: ROUTES, crons: CRONS });
  assert.equal(byId(fake, "identity.provider").status, "BLOCKED", "the test identity provider fakes results");
  const preview = await runPreflight({ env, target: "preview", routes: ROUTES, crons: CRONS });
  assert.equal(byId(preview, "env.test_switches").status, "WARN");
  assert.equal(byId(preview, "identity.key").status, "PASS");
  assert.match(byId(preview, "identity.key").title, /test mode/, "a preview says it's in test mode, not live");
  // A full secret key works but is broader than needed.
  const sk = await runPreflight({ env: { ...GOOD, STRIPE_IDENTITY_SECRET_KEY: keyLike("sk", "live") }, target: "production", routes: ROUTES, crons: CRONS });
  assert.equal(byId(sk, "identity.key").status, "WARN");
  assertNoSecrets(prod, env);
});

test("fully configured, online: READY; only honest manual confirmations and disabled optional features remain", async () => {
  const db = healthyDb();
  const http = healthyHttp();
  const r = await runPreflight({ env: GOOD, target: "production", online: true, db: db.probe, http: http.probe, expectedSchemaKeys: expectedSchemaKeys(), routes: ROUTES, crons: CRONS });
  assert.deepEqual(blocked(r), []);
  assert.equal(r.ready, true);
  assert.equal(r.online, true);
  for (const id of ["env.test_switches", "env.auth_secret", "app_url.set", "auth.config", "auth.reachable", "documents.signing", "documents.rls", "documents.public_api", "database.connect", "database.tables", "database.versions", "database.scope_migration", "database.verification_backfill", "isolation.demo_users", "isolation.shared_ids", "isolation.demo_public", "cron.secret", "cron.schedule", "identity.key", "identity.webhook", "identity.key_works", "legal.privacy", "legal.help", "legal.terms", "app_url.get_home"])
    assert.equal(byId(r, id)?.status, "PASS", id);
  const warns = r.items.filter((i) => i.status === "WARN").map((i) => i.id).sort();
  // Supabase redirect URLs and the Stripe endpoint can't be read back: confirm by hand.
  // Outbound email has no implemented adapter, and background checks have no provider: disabled, not configured.
  assert.deepEqual(warns, ["auth.redirects", "background.provider", "email.alerts", "identity.urls"]);
  assert.ok(byId(r, "auth.redirects").manual && byId(r, "identity.urls").manual);
  assert.match(byId(r, "auth.redirects").detail, /https:\/\/clutch\.example\.test\/auth\/callback/);
  assert.match(byId(r, "identity.urls").detail, /https:\/\/clutch\.example\.test\/api\/verification\/webhook\/stripe_identity/);
  assert.match(byId(r, "identity.urls").detail, /\/mechanic\/verification\/identity\/return/);
  // Read-only: only SELECTs; GETs only to the configured hosts.
  assert.ok(db.seen.length > 5 && db.seen.every((q) => /^\s*select\b/i.test(q)), "the database is only ever read");
  for (const c of http.seen) assert.match(c.url, /^https:\/\/(clutch\.example\.test|fictional\.supabase\.example\.test|api\.stripe\.com)\//);
  assertNoSecrets(r, GOOD);
  assert.match(formatHuman(r), /^Clutch release preflight · target production · online \(read-only\)/);
  assert.match(formatHuman(r), /READY: nothing blocks · 0 blocked/);
});

test("online probes catch what configuration can't: leaks, isolation breaks, stale schema and refused keys", async () => {
  const db = healthyDb({
    demoUsers: [{ n: 2 }],
    shared: [{ n: 1 }],
    isDemo: [{ n: 1 }],
    old: [{ n: 7 }],
    schema: [{ key: "app_store:v1" }],
    open: [{ t: "app_media" }],
  });
  const http = healthyHttp({ "/rest/v1/app_media": { status: 200, json: [{ id: "m1" }] }, "api.stripe.com": { status: 401 }, "/auth/v1/settings": { status: 200, json: { external: { google: false }, mailer_autoconfirm: true } } });
  const r = await runPreflight({ env: { ...GOOD, CLUTCH_DEMO_LOGINS: undefined }, target: "production", online: true, db: db.probe, http: http.probe, expectedSchemaKeys: expectedSchemaKeys(), routes: ROUTES, crons: CRONS });
  assert.equal(byId(r, "isolation.demo_users").status, "BLOCKED");
  assert.equal(byId(r, "isolation.shared_ids").status, "WARN");
  assert.equal(byId(r, "isolation.demo_flags").status, "WARN");
  assert.match(byId(r, "isolation.demo_flags").next!, /db:repair-demo-flags \(dry run\), then --apply with approval/);
  assert.equal(byId(r, "isolation.demo_public").status, "WARN", "the public demo is on by default: a decision, labelled");
  assert.equal(byId(r, "database.verification_backfill").status, "WARN");
  assert.match(byId(r, "database.verification_backfill").next!, /db:migrate-verifications \(dry run\)/);
  assert.equal(byId(r, "database.versions").status, "WARN", "a new build's additive schema applies on first start");
  assert.equal(byId(r, "documents.rls").status, "BLOCKED");
  assert.equal(byId(r, "documents.public_api").status, "BLOCKED");
  assert.equal(byId(r, "identity.key_works").status, "BLOCKED");
  assert.equal(byId(r, "auth.confirm_email").status, "WARN");
  // A connection failure is reported without the connection string.
  const down: DbProbe = async () => {
    throw new Error(`connect ECONNREFUSED for ${GOOD.DATABASE_URL}`);
  };
  const r2 = await runPreflight({ env: GOOD, target: "production", online: true, db: down, routes: ROUTES, crons: CRONS });
  assert.equal(byId(r2, "database.connect").status, "BLOCKED");
  assert.match(byId(r2, "database.connect").detail, /\[redacted\]/);
  assertNoSecrets(r2, GOOD);
  assert.ok(!JSON.stringify(r2).includes(S.dbPass), "not even the password on its own");
});

test("alerts: switched on without an implemented adapter is BLOCKED in production and asks for a delivery schedule", async () => {
  const r = await runPreflight({ env: { ...GOOD, CLUTCH_OUTBOUND_ALERTS: "on", CLUTCH_EMAIL_PROVIDER: "smtp", SMTP_PASSWORD: "smtp-FICTIONAL-password" }, target: "production", routes: ROUTES, crons: CRONS });
  assert.equal(byId(r, "email.alerts").status, "BLOCKED");
  assert.match(byId(r, "cron.schedule").detail, /deliver-alerts/);
  assert.ok(!JSON.stringify(r).includes("smtp-FICTIONAL-password"));
});
