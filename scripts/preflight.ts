/**
 * Release preflight (read-only). See docs/release-preflight.md.
 *
 *   npm run preflight                                        # this shell's environment, config only
 *   npm run preflight -- --env-file=.env.production.local    # a pulled environment file instead
 *   npm run preflight -- --online                            # also read-only DB and HTTP probes
 *   npm run preflight -- --json                              # machine-readable, for CI
 *   npm run preflight -- --target=preview                    # problems warn instead of block
 *   npm run preflight -- --app-url=https://…                  # check this public address instead of APP_URL
 *
 * Exit codes: 0 nothing blocked, 2 something BLOCKED, 1 the preflight itself failed.
 * Never writes to the database or any service, and never prints a secret.
 */
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { formatHuman, runPreflight, type Report } from "@/lib/release/preflight";
import { builtRoutes, expectedSchemaKeys, httpGet, readOnlyDb, scheduledCrons } from "@/lib/release/probes";

async function main() {
  const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
  const flag = (k: string) => process.argv.includes(`--${k}`);
  const file = arg("env-file");
  const env: Record<string, string | undefined> = file ? (parseEnv(readFileSync(file, "utf8")) as Record<string, string>) : { ...process.env };
  if (arg("app-url")) env.APP_URL = arg("app-url");
  const target = (arg("target") ?? "production") as Report["target"];
  if (!["production", "preview", "local"].includes(target)) throw new Error(`--target must be production, preview or local`);
  const online = flag("online");
  const db = online && env.DATABASE_URL ? readOnlyDb(env.DATABASE_URL) : undefined;
  try {
    const report = await runPreflight({
      env,
      target,
      source: `${file ? `env file ${file}` : "the process environment"}${arg("app-url") ? ` (APP_URL overridden by --app-url)` : ""}`,
      online,
      db: db?.probe,
      http: online ? httpGet : undefined,
      expectedSchemaKeys: expectedSchemaKeys(),
      routes: builtRoutes(),
      crons: scheduledCrons(),
    });
    console.log(flag("json") ? JSON.stringify(report, null, 2) : formatHuman(report));
    process.exitCode = report.ready ? 0 : 2;
  } finally {
    await db?.end();
  }
}

main().catch((e: Error) => {
  // The message only: a stack or error object could carry a connection string.
  console.error(`Preflight failed to run: ${e.message.replace(/postgres(ql)?:\/\/\S+/g, "[connection string]")}`);
  process.exitCode = 1;
});
