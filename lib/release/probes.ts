/**
 * The preflight's only ways out of the process, both read-only:
 *  - the database: every query runs in its own `BEGIN READ ONLY` transaction with a statement
 *    timeout, so even a mistaken write would be refused by Postgres (and nothing here writes);
 *  - HTTP: GET only, with a timeout, no redirects to follow into forms, no bodies sent.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { schemaKey } from "@/lib/data/schema";
import { deliverySchemaSql } from "@/lib/notify/outbox";
import type { DbProbe, HttpProbe } from "./preflight";

export function readOnlyDb(url: string): { probe: DbProbe; end: () => Promise<void> } {
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 10, idle_timeout: 5, onnotice: () => undefined });
  const probe: DbProbe = async (query, params = []) =>
    (await sql.begin("read only", async (tx) => {
      await tx`set local statement_timeout = '10s'`;
      return tx.unsafe(query, params as postgres.ParameterOrJSON<never>[]);
    })) as never;
  return { probe, end: () => sql.end({ timeout: 5 }) };
}

export const httpGet: HttpProbe = async (url, init) => {
  const r = await fetch(url, { method: "GET", headers: init?.headers, redirect: "follow", signal: AbortSignal.timeout(8000) });
  const type = r.headers.get("content-type") ?? "";
  return { status: r.status, json: type.includes("json") ? await r.json().catch(() => undefined) : undefined };
};

/** Schema versions this build records at startup (lib/data/store.ts migrate()). */
export function expectedSchemaKeys() {
  return ["app_store:v1", schemaKey("delivery", deliverySchemaSql())];
}

/** Top-level public pages in this build (app/<name>/page.tsx). */
export function builtRoutes(root = process.cwd()) {
  const app = join(root, "app");
  return readdirSync(app, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(app, d.name, "page.tsx")))
    .map((d) => `/${d.name}`);
}

/**
 * Jobs scheduled from this repository: vercel.json crons (Vercel sends GET) and scheduled GitHub
 * workflows that POST to a cron path.
 */
export function scheduledCrons(root = process.cwd()): { path: string; method: "GET" | "POST" }[] {
  const out: { path: string; method: "GET" | "POST" }[] = [];
  const vercel = join(root, "vercel.json");
  if (existsSync(vercel)) {
    try {
      for (const c of (JSON.parse(readFileSync(vercel, "utf8")) as { crons?: { path: string }[] }).crons ?? []) out.push({ path: c.path.split("?")[0], method: "GET" });
    } catch {
      // unreadable: treated as no crons
    }
  }
  const wf = join(root, ".github", "workflows");
  if (existsSync(wf))
    for (const f of readdirSync(wf).filter((n) => /\.ya?ml$/.test(n))) {
      const text = readFileSync(join(wf, f), "utf8");
      if (!/^\s*schedule\s*:/m.test(text) || !/-X\s+POST|--request\s+POST/.test(text)) continue;
      for (const m of text.matchAll(/\/api\/cron\/[a-z-]+/g)) out.push({ path: m[0], method: "POST" });
    }
  return out;
}
