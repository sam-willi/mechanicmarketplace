/**
 * Live data: copy the record snapshot into the normalized tables, or back.
 *
 *   npx tsx --env-file=.env.local --conditions react-server scripts/migrate-live.ts            # dry run (default): nothing kept
 *   npx tsx --env-file=.env.local --conditions react-server scripts/migrate-live.ts --apply    # backup first, then copy
 *   npx tsx --env-file=.env.local --conditions react-server scripts/migrate-live.ts --export-snapshot   # rollback: write back
 *
 * Prints a reconciliation report. Never prints credentials; never deletes anything.
 */
import postgres from "postgres";
import { exportToSnapshot, migrateLive, type Reconciliation } from "@/lib/data/normalized/migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL isn't set.");
  process.exit(1);
}
const host = (() => {
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable url)";
  }
})();
const mode = process.argv.includes("--apply") ? "apply" : process.argv.includes("--export-snapshot") ? "export" : "dry_run";

function print(r: Reconciliation) {
  console.log(`\n${r.mode === "dry_run" ? "DRY RUN (rolled back, nothing kept)" : "APPLIED"} · run ${r.runId} · ${host}`);
  console.log(`snapshot records: ${r.snapshotRecords}${r.mode === "apply" ? ` · backed up first: ${r.backupRows} rows` : ""}`);
  console.log("collection".padEnd(16), "snapshot  inserted  present  refreshed  differs  quarantined  prev-quarantined");
  for (const [c, s] of Object.entries(r.perCollection)) {
    if (!s.snapshot) continue;
    console.log(c.padEnd(16), String(s.snapshot).padStart(8), String(s.inserted).padStart(9), String(s.alreadyPresent).padStart(8), String(s.refreshed).padStart(10), String(s.differs).padStart(8), String(s.quarantined).padStart(12), String(s.previouslyQuarantined).padStart(17));
  }
  console.log(`history entries: snapshot ${r.history.snapshotEntries} (on migrated records ${r.history.migratedEntries}, on quarantined ${r.history.quarantinedEntries}) → normalized ${r.history.normalizedEntries}`);
  console.log(`uploads: linked ${r.uploads.linked}, already linked ${r.uploads.alreadyLinked}, owner not a live account ${r.uploads.ownerNotLive}`);
  console.log(`child rows: ${Object.entries(r.childRows).map(([t, n]) => `${t.replace("lv_", "")} ${n}`).join(", ")}`);
  for (const q of r.quarantine) console.log(`QUARANTINED ${q.collection}:${q.id} — ${q.reason}`);
  console.log(r.unaccounted.length ? `UNACCOUNTED: ${r.unaccounted.join(", ")}` : "unaccounted: 0 (every snapshot record is in its table or in quarantine)");
}

async function main() {
  const sql = postgres(url!, { prepare: false, max: 2, onnotice: () => undefined });
  try {
    if (mode === "export") console.log(await exportToSnapshot(sql));
    else print(await migrateLive(sql, mode));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
