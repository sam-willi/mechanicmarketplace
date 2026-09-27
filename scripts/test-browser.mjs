// Browser test of the real-account path (tests-browser/real-accounts.mjs), fully isolated:
// a throwaway Postgres cluster, the local auth fixture (scripts/local-auth.mjs, a stand-in for
// Supabase Auth: nothing is emailed), and a production build of the app with demo logins off,
// built into its own folder (.next-browser-test) so a running dev server is never touched.
// Never uses DATABASE_URL, Supabase keys or anything else from your environment or .env.local.
//
// Needs: Postgres 16+ server binaries (as npm run test:db), Google Chrome or Chromium, and
// puppeteer-core (not a project dependency):  npm i --no-save puppeteer-core
// Set CHROME_PATH if Chrome isn't in the usual place.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { pgBin } from "./pg-bin.mjs";

const require = createRequire(import.meta.url);
try {
  require.resolve("puppeteer-core");
} catch {
  console.error("test:browser needs puppeteer-core: npm i --no-save puppeteer-core");
  process.exit(1);
}
const chrome =
  process.env.CHROME_PATH ??
  ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => existsSync(p));
if (!chrome) {
  console.error("test:browser needs Chrome or Chromium; set CHROME_PATH.");
  process.exit(1);
}
let bin;
try {
  bin = pgBin();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const dir = mkdtempSync(path.join(tmpdir(), "clutch-browser-"));
const pgPort = String(55000 + Math.floor(Math.random() * 4000));
const authPort = String(59100 + Math.floor(Math.random() * 400));
const appPort = String(3490 + Math.floor(Math.random() * 100));
const DB = `postgres://clutch@127.0.0.1:${pgPort}/clutch_browser`;
const baseEnv = { ...process.env, LC_ALL: process.platform === "linux" ? "C.UTF-8" : "en_US.UTF-8", NEXT_TELEMETRY_DISABLED: "1" };
const run = (cmd, args) => {
  const r = spawnSync(path.join(bin, cmd), args, { env: baseEnv, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr || r.stdout}`);
};
// Everything the app could otherwise pick up from the shell or .env.local is set explicitly (empty = off).
const appEnv = {
  ...baseEnv,
  NODE_ENV: "production",
  CLUTCH_DIST_DIR: ".next-browser-test",
  DATABASE_URL: DB,
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${authPort}`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-test-key",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  AUTH_SECRET: randomBytes(32).toString("hex"),
  APP_URL: `http://localhost:${appPort}`,
  CLUTCH_DEMO_LOGINS: "off",
  CLUTCH_TEST_LOGINS: "",
  CLUTCH_LIVE_STORE: process.env.CLUTCH_BROWSER_STORE ?? "",
  CLUTCH_LIVE_READS: "",
  CLUTCH_OUTBOUND_ALERTS: "",
  CLUTCH_EMAIL_PROVIDER: "",
  CLUTCH_CRON_SECRET: "",
  CLUTCH_ADMIN_EMAILS: "",
  SMTP_HOST: "", SMTP_PORT: "", SMTP_USER: "", SMTP_PASSWORD: "", EMAIL_FROM: "",
};
// Anything else in .env files (which Next would load) is blanked too: this run uses only the above.
for (const f of [".env", ".env.local", ".env.production", ".env.production.local"]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const k = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/)?.[1];
    if (k && !(k in appEnv && appEnv[k] !== process.env[k])) appEnv[k] = "";
  }
}
for (const [k, v] of Object.entries({ DATABASE_URL: DB, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${authPort}`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-test-key", APP_URL: `http://localhost:${appPort}`, CLUTCH_DEMO_LOGINS: "off" })) appEnv[k] = v;
const procs = [];
const start = (cmd, args, env, label) => {
  const p = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  p.stdout.on("data", (d) => (log += d));
  p.stderr.on("data", (d) => (log += d));
  p.log = () => log;
  p.label = label;
  procs.push(p);
  return p;
};
const waitFor = async (url, what) => {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${what} didn't start (${url})`);
};
let app;
const startApp = async () => {
  app = start("npx", ["next", "start", "-p", appPort], appEnv, "app");
  await waitFor(`http://localhost:${appPort}/login`, "the app");
};
const stopApp = async () => {
  if (!app) return;
  app.kill("SIGTERM");
  await new Promise((r) => app.once("exit", r));
};

let code = 1;
try {
  run("initdb", ["-D", path.join(dir, "data"), "-U", "clutch", "--auth=trust", "-E", "UTF8"]);
  run("pg_ctl", ["-D", path.join(dir, "data"), "-o", `-p ${pgPort} -k '' -h 127.0.0.1`, "-l", path.join(dir, "log"), "-w", "start"]);
  run("createdb", ["-h", "127.0.0.1", "-p", pgPort, "-U", "clutch", "clutch_browser"]);
  for (const f of ["0002_app_store.sql", "0003_data_scope.sql"]) run("psql", ["-h", "127.0.0.1", "-p", pgPort, "-U", "clutch", "-d", "clutch_browser", "-q", "-v", "ON_ERROR_STOP=1", "-f", path.join("supabase/migrations", f)]);
  start("node", ["scripts/local-auth.mjs"], { ...baseEnv, DATABASE_URL: DB, LOCAL_AUTH_PORT: authPort }, "local-auth");
  await waitFor(`http://127.0.0.1:${authPort}/auth/v1/health`, "the auth fixture");
  console.log("▶ building (production, demo off) into .next-browser-test");
  const build = spawnSync("npx", ["next", "build"], { env: appEnv, stdio: "inherit" });
  if (build.status !== 0) throw new Error("build failed");
  await startApp();
  const { run: flow } = await import("../tests-browser/real-accounts.mjs");
  const fails = await flow({
    base: `http://localhost:${appPort}`,
    auth: `http://127.0.0.1:${authPort}`,
    db: DB,
    chrome,
    store: appEnv.CLUTCH_LIVE_STORE === "normalized" ? "normalized" : "snapshot",
    out: path.join(dir, "shots"),
    restart: async () => {
      await stopApp();
      await startApp();
    },
  });
  code = fails ? 1 : 0;
} catch (e) {
  console.error(e);
  for (const p of procs) console.error(`--- ${p.label} log (tail) ---\n${p.log().slice(-3000)}`);
} finally {
  for (const p of procs) p.kill("SIGTERM");
  spawnSync(path.join(bin, "pg_ctl"), ["-D", path.join(dir, "data"), "-m", "immediate", "stop"], { env: baseEnv });
  rmSync(dir, { recursive: true, force: true });
}
process.exit(code);
