/**
 * Clear the demo-only `isDemo` flag from real (live) mechanic records that inherited it from
 * onboarding before 2026-09-26 15:07 PT (commit a8baa5b), which set it on every new mechanic.
 * Only records whose provenance proves the flag wrong are changed (lib/data/demo-flags.ts):
 * not part of the demo seed, and owned by a live account that isn't a demo account.
 * Nothing else in the record is touched, and the demo scope is never read or changed.
 *
 *   npx tsx --env-file=.env.local --conditions react-server scripts/repair-demo-flags.ts           # dry run: lists, changes nothing
 *   npx tsx --env-file=.env.local --conditions react-server scripts/repair-demo-flags.ts --apply   # clears the flag in one transaction
 *
 * Never prints credentials, names or addresses: record ids only.
 */
import postgres from "postgres";
import { buildSeed, type DB } from "@/lib/data/mock/seed";
import { inheritedDemoFlags } from "@/lib/data/demo-flags";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("No DATABASE_URL: nothing to repair (the in-memory store never had the old flag).");
    return;
  }
  const apply = process.argv.includes("--apply");
  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => undefined });
  try {
    const [{ exists }] = await sql`select to_regclass('app_records') is not null as exists`;
    if (!exists) {
      console.log("No app store tables yet: nothing to repair.");
      return;
    }
    const rows = async (collection: string) => (await sql<{ data: Record<string, unknown> }[]>`select data from app_records where scope = 'live' and collection = ${collection}`).map((r) => r.data);
    const live = { users: await rows("users"), mechanics: await rows("mechanics") } as unknown as Pick<DB, "users" | "mechanics">;
    const found = inheritedDemoFlags(live, buildSeed());
    const flagged = (live.mechanics as { isDemo?: boolean }[]).filter((m) => m.isDemo === true).length;
    console.log(`Live mechanics with isDemo: ${flagged}. Provably inherited (will be cleared): ${found.length}.`);
    for (const f of found) console.log(`  ${f.id} (account ${f.userId}): ${f.reason}`);
    if (flagged > found.length) console.log(`  ${flagged - found.length} other flagged record(s) left alone: not provably inherited; review them separately.`);
    if (!found.length) {
      console.log("Nothing to change.");
    } else if (!apply) {
      console.log("Dry run: nothing changed. Run with --apply to clear the flag on the records above.");
    } else {
      await sql.begin(async (tx) => {
        for (const f of found)
          await tx`update app_records set data = data - 'isDemo', updated_at = now() where scope = 'live' and collection = 'mechanics' and id = ${f.id} and data->>'isDemo' = 'true'`;
        // Running servers reload the live scope on their next read.
        await tx`update app_meta set version = version + 1 where key = 'main'`;
      });
      const left = (await rows("mechanics")).filter((m) => found.some((f) => f.id === m.id) && m.isDemo === true).length;
      console.log(`Cleared. Still flagged among those: ${left}.`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main();
