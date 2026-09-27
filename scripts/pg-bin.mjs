// Finds the Postgres server binaries (initdb, pg_ctl, createdb, psql) on this machine, for the
// database tests and the local development database. Order: CLUTCH_PG_BIN, `pg_config --bindir`,
// the PATH, then the usual Homebrew and Debian/Ubuntu locations.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const exe = process.platform === "win32" ? ".exe" : "";
const has = (dir) => Boolean(dir) && existsSync(path.join(dir, `initdb${exe}`)) && existsSync(path.join(dir, `pg_ctl${exe}`));

export function pgBin() {
  const tried = [];
  const check = (dir) => {
    if (!dir) return undefined;
    tried.push(dir);
    return has(dir) ? dir : undefined;
  };
  const fromEnv = check(process.env.CLUTCH_PG_BIN);
  if (fromEnv) return fromEnv;
  const cfg = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
  const viaConfig = cfg.status === 0 ? check(cfg.stdout.trim()) : undefined;
  if (viaConfig) return viaConfig;
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["initdb"], { encoding: "utf8" });
  const viaPath = which.status === 0 ? check(path.dirname(which.stdout.split(/\r?\n/)[0].trim())) : undefined;
  if (viaPath) return viaPath;
  const candidates = ["/opt/homebrew/opt/postgresql@18/bin", "/opt/homebrew/opt/postgresql@17/bin", "/opt/homebrew/opt/postgresql@16/bin", "/usr/local/opt/postgresql@18/bin", "/usr/local/opt/postgresql@17/bin", "/usr/local/opt/postgresql@16/bin"];
  for (const root of ["/usr/lib/postgresql"]) {
    if (existsSync(root)) for (const v of readdirSync(root).sort().reverse()) candidates.push(path.join(root, v, "bin"));
  }
  for (const c of candidates) if (check(c)) return c;
  throw new Error(
    `No Postgres server binaries (initdb, pg_ctl) found. Install Postgres 16 or newer (macOS: brew install postgresql@18; Debian/Ubuntu: apt install postgresql), or set CLUTCH_PG_BIN to its bin directory.\nLooked in: ${tried.join(", ") || "(nothing)"}`,
  );
}
