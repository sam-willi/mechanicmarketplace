/**
 * Give vehicles saved before structured details existed an honest spec (lib/vehicles/backfill.ts):
 * what the customer entered is "customer entered", what the factory data implies is "likely", the
 * rest "unknown". The app already shows exactly this at read time, so this is optional; it only
 * makes the stored record say the same. Snapshot store (app_records), one scope.
 *
 *   npx tsx --env-file=.env.local --conditions react-server scripts/backfill-vehicle-specs.ts            # dry run (default)
 *   npx tsx --env-file=.env.local --conditions react-server scripts/backfill-vehicle-specs.ts --apply    # backup first, one transaction
 *   … --scope=demo   (default live)
 *
 * Record ids and summaries only; never VINs, names or addresses.
 */
import postgres from "postgres";
import { planVehicleBackfill } from "@/lib/vehicles/backfill";
import type { Vehicle } from "@/lib/domain/types";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) return console.log("No DATABASE_URL: nothing to backfill.");
  const apply = process.argv.includes("--apply");
  const scope = process.argv.includes("--scope=demo") ? "demo" : "live";
  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => undefined });
  try {
    const [{ exists }] = await sql`select to_regclass('app_records') is not null as exists`;
    if (!exists) return console.log("No app store tables yet.");
    const vehicles = (await sql<{ data: Vehicle }[]>`select data from app_records where scope = ${scope} and collection = 'vehicles'`).map((r) => r.data);
    const plan = planVehicleBackfill(vehicles);
    console.log(`Scope ${scope}: ${vehicles.length} vehicles; ${plan.length} without structured details.`);
    for (const p of plan) console.log(`  vehicles/${p.id}: ${p.summary}`);
    if (!apply) return console.log("Dry run: nothing changed. Run with --apply to back up and store these.");
    if (!plan.length) return console.log("Nothing to change.");
    await sql.begin(async (tx) => {
      for (const p of plan) {
        await tx`insert into app_scope_backup (collection, id, scope, data, migration) select collection, id, scope, data, 'vehicle_spec_backfill' from app_records where scope = ${scope} and collection = 'vehicles' and id = ${p.id}`;
        await tx`update app_records set data = ${tx.json(p.after as never)}, updated_at = now() where scope = ${scope} and collection = 'vehicles' and id = ${p.id} and not (data ? 'spec')`;
      }
      await tx`update app_meta set version = version + 1 where key = ${scope === "live" ? "main" : "demo"}`;
    });
    console.log("Stored. Backups are in app_scope_backup (migration = 'vehicle_spec_backfill').");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main();
