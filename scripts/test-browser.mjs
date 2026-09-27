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
  // "hosted" builds as Vercel would (4 MB uploads, no video/audio); default "full".
  CLUTCH_UPLOAD_PROFILE: process.env.CLUTCH_UPLOAD_PROFILE ?? "full",
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
  // Its own process group, so stopping it stops the real server too (npx/npm wrappers don't forward signals).
  const p = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
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
/** Stop the whole group: SIGTERM, then SIGKILL after 5 s (Next waits for the browser's keep-alive
 *  connections otherwise), then wait until the port is free. Bounded throughout. */
const killGroup = (p, sig) => {
  try {
    process.kill(-p.pid, sig);
  } catch {}
};
const portFree = async (port) => {
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(`http://localhost:${port}/login`, { signal: AbortSignal.timeout(500) });
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`port ${port} still in use after stopping the app`);
};
const stopApp = async () => {
  if (!app) return;
  const exited = new Promise((r) => (app.exitCode !== null ? r() : app.once("exit", r)));
  killGroup(app, "SIGTERM");
  const forced = setTimeout(() => killGroup(app, "SIGKILL"), 5000);
  await Promise.race([exited, new Promise((r) => setTimeout(r, 10000))]);
  clearTimeout(forced);
  killGroup(app, "SIGKILL");
  await portFree(appPort);
};

/**
 * Run a flow, failing it (instead of waiting forever) if it prints nothing for IDLE_MS: every
 * check prints a line, so silence means a stuck step. On a stall, the last step, each open page's
 * URL and a screenshot of it are reported.
 */
const IDLE_MS = Number(process.env.CLUTCH_BROWSER_IDLE_MS ?? 120000);
async function watched(name, run, shots) {
  let last = Date.now();
  let lastLine = "(nothing yet)";
  const log = console.log;
  console.log = (...a) => {
    last = Date.now();
    const line = a.join(" ").trim();
    if (line) lastLine = line.slice(0, 200);
    log(...a);
  };
  let timer;
  const stalled = new Promise((_, reject) => {
    timer = setInterval(async () => {
      if (Date.now() - last < IDLE_MS) return;
      clearInterval(timer);
      const pages = [];
      for (const [i, { label, p }] of (globalThis.__clutchTestPages ?? []).entries()) {
        try {
          const file = path.join(shots, `stalled-${i}-${label}.png`);
          await p.screenshot({ path: file }).catch(() => {});
          pages.push(`${label}: ${p.url()} (${file})`);
        } catch {}
      }
      reject(new Error(`${name} stalled: no progress for ${IDLE_MS / 1000}s after "${lastLine}".\nOpen pages:\n  ${pages.join("\n  ")}`));
    }, 5000);
  });
  try {
    return await Promise.race([run(), stalled]);
  } finally {
    clearInterval(timer);
    console.log = log;
  }
}
// And the whole run is bounded, whatever happens.
const overall = setTimeout(() => {
  console.error(`test:browser: gave up after ${process.env.CLUTCH_BROWSER_MAX_MIN ?? 30} minutes`);
  process.exit(1);
}, Number(process.env.CLUTCH_BROWSER_MAX_MIN ?? 30) * 60000);
overall.unref();

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
  const shots = process.env.CLUTCH_BROWSER_SHOTS ?? path.join(dir, "shots");
  const fails = await watched("real-accounts", () => flow({
    base: `http://localhost:${appPort}`,
    auth: `http://127.0.0.1:${authPort}`,
    db: DB,
    chrome,
    store: appEnv.CLUTCH_LIVE_STORE === "normalized" ? "normalized" : "snapshot",
    out: shots,
    restart: async () => {
      await stopApp();
      await startApp();
    },
  }), shots);
  const { run: uploads } = await import("../tests-browser/uploads.mjs");
  const uploadFails = await watched("uploads", () => uploads({ base: `http://localhost:${appPort}`, auth: `http://127.0.0.1:${authPort}`, db: DB, chrome, out: shots, profile: appEnv.CLUTCH_UPLOAD_PROFILE === "hosted" ? "hosted" : "full" }), shots);
  code = fails || uploadFails ? 1 : 0;
} catch (e) {
  console.error(e);
  for (const p of procs) console.error(`--- ${p.label} log (tail) ---\n${p.log().slice(-3000)}`);
} finally {
  for (const p of procs) killGroup(p, "SIGKILL");
  spawnSync(path.join(bin, "pg_ctl"), ["-D", path.join(dir, "data"), "-m", "immediate", "stop"], { env: baseEnv });
  rmSync(dir, { recursive: true, force: true });
}
process.exit(code);
