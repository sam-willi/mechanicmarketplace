// A local development Postgres for Clutch, in ./.local-pg (git-ignored), on 127.0.0.1 only.
//
//   npm run db:local            start it (creating it the first time) and print DATABASE_URL
//   npm run db:local -- stop    stop it
//   npm run db:local -- reset   stop it and delete its data (asks nothing: it's fictional local data)
//
// Put the printed DATABASE_URL in .env.local to run the app against it. Never touches a remote
// database. The app creates its own tables on first use (0003–0006); this applies the base store (0002).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { pgBin } from "./pg-bin.mjs";

const dir = path.resolve(".local-pg");
const data = path.join(dir, "data");
const port = process.env.CLUTCH_LOCAL_PG_PORT ?? "54329";
const url = `postgres://clutch@127.0.0.1:${port}/clutch_local`;
const cmd = process.argv[2] ?? "start";
const bin = pgBin();
const env = { ...process.env, LC_ALL: process.platform === "linux" ? "C.UTF-8" : "en_US.UTF-8" };
const run = (c, args, ok = false) => {
  const r = spawnSync(path.join(bin, c), args, { env, encoding: "utf8" });
  if (r.status !== 0 && !ok) throw new Error(`${c} failed: ${r.stderr || r.stdout}`);
  return r;
};
const running = () => existsSync(data) && run("pg_ctl", ["-D", data, "status"], true).status === 0;

if (cmd === "stop" || cmd === "reset") {
  if (running()) run("pg_ctl", ["-D", data, "-m", "fast", "stop"]);
  if (cmd === "reset") rmSync(dir, { recursive: true, force: true });
  console.log(cmd === "reset" ? "Local database stopped and deleted." : "Local database stopped.");
  process.exit(0);
}

if (!existsSync(data)) run("initdb", ["-D", data, "-U", "clutch", "--auth=trust", "-E", "UTF8"]);
if (!running()) run("pg_ctl", ["-D", data, "-o", `-p ${port} -k '' -h 127.0.0.1`, "-l", path.join(dir, "log"), "-w", "start"]);
run("createdb", ["-h", "127.0.0.1", "-p", port, "-U", "clutch", "clutch_local"], true);
const sql = postgres(url, { onnotice: () => undefined, max: 1 });
try {
  for (const f of ["0002_app_store.sql", "0003_data_scope.sql"]) await sql.unsafe(readFileSync(path.join("supabase/migrations", f), "utf8"));
} finally {
  await sql.end();
}
console.log(`Local database running.\n\nDATABASE_URL=${url}\n\nAdd that line to .env.local (and CLUTCH_TEST_LOGINS=on for /api/test-login), then npm run dev.`);
