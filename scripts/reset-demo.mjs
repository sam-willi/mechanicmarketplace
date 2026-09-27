// Put the fictional demo marketplace back to its original seed (Derek's incoming requests,
// Maya's estimates and bookings, and so on). Only rows in the "demo" scope are touched; the
// real marketplace ("live") is never read or changed.
//
//   npm run db:reset-demo           shows what would be removed, changes nothing
//   npm run db:reset-demo -- --yes  removes the demo scope in one transaction
//
// The next time the app loads the demo it seeds it fresh (lib/data/store.ts). Restart any
// running server afterwards: a running one keeps its copy in memory.
import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";

if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  const line = readFileSync(".env.local", "utf8").split("\n").find((l) => /^\s*DATABASE_URL\s*=/.test(l));
  if (line) process.env.DATABASE_URL = line.replace(/^\s*DATABASE_URL\s*=\s*/, "").trim().replace(/^["']|["']$/g, "");
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.log("No DATABASE_URL: the demo lives in memory and resets whenever the server restarts.");
  process.exit(0);
}

const apply = process.argv.includes("--yes");
const sql = postgres(url, { prepare: false, max: 1, onnotice: () => undefined });
try {
  const [{ exists }] = await sql`select to_regclass('app_records') is not null as exists`;
  if (!exists) {
    console.log("No app store tables yet; the demo will be seeded on first use.");
    process.exit(0);
  }
  const counts = async (q) => {
    const [records] = await q`select count(*)::int as n from app_records where scope = 'demo'`;
    const [events] = await q`select count(*)::int as n from app_events where scope = 'demo'`;
    const [media] = await q`select count(*)::int as n from app_media where scope = 'demo'`;
    return { records: records.n, events: events.n, media: media.n };
  };
  const before = await counts(sql);
  console.log(`Demo scope: ${before.records} records, ${before.events} events, ${before.media} media files.`);
  if (!apply) {
    console.log("Dry run: nothing changed. Run with --yes to reset the demo to its original seed.");
  } else {
    await sql.begin(async (tx) => {
      await tx`delete from app_records where scope = 'demo'`;
      await tx`delete from app_events where scope = 'demo'`;
      await tx`delete from app_media where scope = 'demo'`;
      await tx`delete from app_meta where key = 'demo'`;
    });
    const after = await counts(sql);
    console.log(`Removed. Demo scope now: ${after.records} records, ${after.events} events, ${after.media} media files.`);
    console.log("Restart the server; the original demo is seeded the next time it loads.");
  }
} finally {
  await sql.end({ timeout: 5 });
}
