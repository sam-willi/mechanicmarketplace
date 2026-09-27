// Database integration tests against a DISPOSABLE local Postgres: a fresh cluster in a temp
// directory on a random port, deleted afterwards. Never uses DATABASE_URL from the
// environment, so it can't touch a real database. Needs Postgres 16+ server binaries
// (initdb, pg_ctl); scripts/pg-bin.mjs finds them, or set CLUTCH_PG_BIN.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pgBin } from "./pg-bin.mjs";

let bin;
try {
  bin = pgBin();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const dir = mkdtempSync(path.join(tmpdir(), "clutch-pg-"));
const port = String(55000 + Math.floor(Math.random() * 4000));
// initdb needs a UTF-8 locale; C.UTF-8 exists on Linux, en_US.UTF-8 on macOS.
const env = { ...process.env, LC_ALL: process.platform === "linux" ? "C.UTF-8" : "en_US.UTF-8" };
const run = (cmd, args) => {
  const r = spawnSync(path.join(bin, cmd), args, { env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr || r.stdout}`);
};
let code = 1;
try {
  run("initdb", ["-D", path.join(dir, "data"), "-U", "clutch", "--auth=trust", "-E", "UTF8"]);
  run("pg_ctl", ["-D", path.join(dir, "data"), "-o", `-p ${port} -k '' -h 127.0.0.1`, "-l", path.join(dir, "log"), "-w", "start"]);
  run("createdb", ["-h", "127.0.0.1", "-p", port, "-U", "clutch", "clutch_test"]);
  for (const f of ["0002_app_store.sql", "0003_data_scope.sql"]) run("psql", ["-h", "127.0.0.1", "-p", port, "-U", "clutch", "-d", "clutch_test", "-q", "-v", "ON_ERROR_STOP=1", "-f", path.join("supabase/migrations", f)]);
  // CLUTCH_DB_TESTS=name,name runs only those files (e.g. while working on one suite).
  const only = (process.env.CLUTCH_DB_TESTS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const files = readdirSync("tests-db")
    .filter((f) => f.endsWith(".test.ts") && (!only.length || only.some((o) => f.startsWith(o))))
    .map((f) => `tests-db/${f}`);
  const testEnv = { ...env, NODE_ENV: "test", DATABASE_URL: `postgres://clutch@127.0.0.1:${port}/clutch_test`, CLUTCH_LIVE_STORE: "normalized", CLUTCH_ADMIN_EMAILS: "staff@example.test", CLUTCH_VEHICLE_DATA: "fixtures" };
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) delete testEnv[k];
  const r = spawnSync("npx", ["tsx", "--conditions", "react-server", "--test", "--test-concurrency=1", ...files], { stdio: "inherit", env: testEnv });
  code = r.status ?? 1;
} finally {
  spawnSync(path.join(bin, "pg_ctl"), ["-D", path.join(dir, "data"), "-m", "immediate", "stop"], { env });
  rmSync(dir, { recursive: true, force: true });
}
process.exit(code);
