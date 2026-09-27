/**
 * Backfill verification records to the canonical model (docs/verification.md, "Migration"), in the
 * snapshot store (app_records), for one scope. The normalized tables are migrated by
 * supabase/migrations/0009_verification_canonical.sql.
 *
 *   npx tsx --env-file=.env.local --conditions react-server scripts/migrate-verifications.ts            # dry run (default): lists, changes nothing
 *   npx tsx --env-file=.env.local --conditions react-server scripts/migrate-verifications.ts --apply    # backup first, then one transaction
 *   … --scope=demo   (default live)
 *
 * Nothing is deleted. Every changed row is copied to app_scope_backup first. Record ids and change
 * summaries only: never names, emails or documents.
 */
import postgres from "postgres";
import { planVerificationMigration } from "@/lib/verification/migrate";
import type { MechanicProfile, ScreeningCheck, User, VerificationRecord } from "@/lib/domain/types";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("No DATABASE_URL: nothing to migrate (the in-memory store is rebuilt from code).");
    return;
  }
  const apply = process.argv.includes("--apply");
  const scope = process.argv.includes("--scope=demo") ? "demo" : "live";
  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => undefined });
  try {
    const [{ exists }] = await sql`select to_regclass('app_records') is not null as exists`;
    if (!exists) return console.log("No app store tables yet: nothing to migrate.");
    const rows = async <T,>(collection: string) => (await sql<{ data: T }[]>`select data from app_records where scope = ${scope} and collection = ${collection}`).map((r) => r.data);
    const db = {
      verifications: await rows<VerificationRecord>("verifications"),
      screenings: await rows<ScreeningCheck>("screenings"),
      mechanics: await rows<MechanicProfile>("mechanics"),
      users: await rows<User>("users"),
    };
    const plan = planVerificationMigration(db, scope);
    console.log(`Scope ${scope}: ${db.verifications.length} verification records, ${db.screenings.length} screenings, ${db.mechanics.length} mechanics.`);
    console.log(`Would update ${plan.updates.length} records and create ${plan.creates.length} email checks.`);
    for (const u of plan.updates) console.log(`  ${u.collection}/${u.id}: ${u.summary}`);
    for (const c of plan.creates) console.log(`  verifications/${c.id}: new email check (backfilled)`);
    if (!apply) return console.log("Dry run: nothing changed. Run with --apply to back up and migrate.");
    if (!plan.updates.length && !plan.creates.length) return console.log("Nothing to change.");
    await sql.begin(async (tx) => {
      for (const u of plan.updates) {
        await tx`insert into app_scope_backup (collection, id, scope, data, migration) select collection, id, scope, data, 'verification_canonical' from app_records where scope = ${scope} and collection = ${u.collection} and id = ${u.id}`;
        await tx`update app_records set data = ${tx.json(u.after as never)}, updated_at = now() where scope = ${scope} and collection = ${u.collection} and id = ${u.id}`;
      }
      for (const c of plan.creates) await tx`insert into app_records (scope, collection, id, data) values (${scope}, 'verifications', ${c.id}, ${tx.json(c as never)}) on conflict do nothing`;
      // Running servers reload the scope on their next read.
      await tx`update app_meta set version = version + 1 where key = ${scope === "live" ? "main" : "demo"}`;
    });
    console.log("Migrated. Backups are in app_scope_backup (migration = 'verification_canonical').");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main();
