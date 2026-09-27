// npm run verify: every check a contributor should run before a pull request, non-destructive.
//
//   lint · type-check · app tests (in memory) · database tests (throwaway local Postgres) · production build
//
// It never uses your database or services: DATABASE_URL, Supabase keys and every Clutch switch are
// blanked for each step (blank, not unset, so Next.js doesn't fill them back in from .env.local).
// The database tests always create their own temporary cluster (scripts/run-db-tests.mjs).
// `--skip-db` skips them when Postgres server binaries aren't installed (it says so, loudly).
import { spawnSync } from "node:child_process";
import { pgBin } from "./pg-bin.mjs";

const BLANK = [
  "DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "CLUTCH_LIVE_STORE", "CLUTCH_LIVE_READS", "CLUTCH_OUTBOUND_ALERTS", "CLUTCH_EMAIL_PROVIDER", "CLUTCH_TEST_LOGINS", "CLUTCH_CRON_SECRET",
  "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM", "APP_URL",
];
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
for (const k of BLANK) env[k] = "";

const skipDb = process.argv.includes("--skip-db");
let db = !skipDb;
if (db) {
  try {
    pgBin();
  } catch (e) {
    console.error(`\n${e.message}\nInstall Postgres (see README), or run \`npm run verify -- --skip-db\` and say so in your pull request.`);
    process.exit(1);
  }
}

const steps = [
  ["lint", "npx", ["eslint"]],
  ["type-check", "npx", ["tsc", "--noEmit", "-p", "."]],
  ["app tests", "node", ["scripts/run-tests.mjs"]],
  ...(db ? [["database tests", "node", ["scripts/run-db-tests.mjs"]]] : []),
  ["production build", "npx", ["next", "build"]],
];
const results = [];
for (const [name, cmd, args] of steps) {
  console.log(`\n▶ ${name}`);
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { stdio: "inherit", env, shell: process.platform === "win32" });
  results.push([name, r.status === 0, Math.round((Date.now() - t0) / 1000)]);
  if (r.status !== 0) break;
}
console.log("\nverify:");
for (const [name, ok, s] of results) console.log(`  ${ok ? "✔" : "✖"} ${name} (${s}s)`);
if (skipDb) console.log("  ! database tests SKIPPED (--skip-db)");
const failed = results.some(([, ok]) => !ok) || results.length < steps.length;
process.exit(failed ? 1 : 0);
