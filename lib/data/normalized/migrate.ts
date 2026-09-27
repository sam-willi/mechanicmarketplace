import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { fromRows } from "../store";
import { dbFromRecords, recordsOf, SPECS } from "./spec";
import { jsonCols, stable, writeChildren } from "./store";

/**
 * Copy the live marketplace from the record snapshot (app_records, scope 'live') into the
 * normalized tables — and back again for rollback.
 *
 *  dry_run  Does everything inside one transaction and rolls it back: the database checks every
 *           row against every rule, and nothing is kept. Returns the reconciliation report.
 *  apply    Backs up the snapshot rows first (app_scope_backup), then copies in one transaction.
 *           Restartable: rows already copied (identical) are skipped, rows quarantined before
 *           stay quarantined, nothing is overwritten or deleted.
 *  export   Rollback path: backs up the snapshot rows, then writes the normalized records back
 *           into the snapshot so the old path (CLUTCH_LIVE_STORE unset) sees every change made
 *           while the normalized store was on.
 *
 * Rows that break a rule (a dangling link, a demo record, an invalid status…) are copied to
 * lv_quarantine with the database's reason instead of being dropped.
 */

type Doc = Record<string, unknown>;
export interface Reconciliation {
  runId: number;
  mode: "dry_run" | "apply";
  snapshotRecords: number;
  /**
   * inserted: copied now. alreadyPresent: identical. refreshed: copied before, changed in the snapshot
   * since, never written by the normalized app, so brought up to date. differs: written by the
   * normalized app since (the newer truth), left alone.
   */
  perCollection: Record<string, { snapshot: number; inserted: number; alreadyPresent: number; refreshed: number; differs: number; quarantined: number; previouslyQuarantined: number }>;
  childRows: Record<string, number>;
  /** History lines: in the whole snapshot, on records now in the normalized tables, and in lv_history. */
  history: { snapshotEntries: number; migratedEntries: number; quarantinedEntries: number; normalizedEntries: number };
  uploads: { linked: number; alreadyLinked: number; ownerNotLive: number };
  quarantine: { collection: string; id: string; reason: string }[];
  /** Records neither in the normalized tables nor quarantined. Must be 0. */
  unaccounted: string[];
  backupRows: number;
}

class DryRunRollback extends Error {}

function schema() {
  return readFileSync(path.join(process.cwd(), "supabase/migrations/0004_live_normalized.sql"), "utf8");
}

export async function migrateLive(sql: postgres.Sql, mode: "dry_run" | "apply"): Promise<Reconciliation> {
  let report!: Reconciliation;
  try {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('clutch_lv_migration'))`;
      await tx.unsafe(schema());
      const [run] = await tx<{ id: string }[]>`insert into lv_migration_runs (mode) values (${mode}) returning id::text`;
      const runId = Number(run.id);

      const rows = await tx<{ collection: string; id: string; data: unknown }[]>`select collection, id, data from app_records where scope = 'live'`;
      let backupRows = 0;
      if (mode === "apply") {
        const b = await tx`insert into app_scope_backup (collection, id, scope, data, migration)
          select collection, id, scope, data, ${`normalize_v1:${runId}`} from app_records where scope = 'live'`;
        backupRows = b.count;
      }
      const db = fromRows(rows);
      const records = [...recordsOf(db).values()];

      // Foreign keys report per statement, so a bad row is caught (and quarantined) on its own.
      // The accepted-version check stays deferred and is forced per estimate below.
      await tx`set constraints all immediate`;
      await tx`set constraints lv_quotes_accepted_version, lv_reviews_completed deferred`;

      const per: Reconciliation["perCollection"] = {};
      const quarantine: Reconciliation["quarantine"] = [];
      const bump = (c: string) => (per[c] ??= { snapshot: 0, inserted: 0, alreadyPresent: 0, refreshed: 0, differs: 0, quarantined: 0, previouslyQuarantined: 0 });
      for (const spec of SPECS) {
        for (const rec of records.filter((r) => r.spec === spec)) {
          const stat = bump(spec.collection);
          stat.snapshot++;
          const [q] = await tx`select 1 from lv_quarantine where collection = ${spec.collection} and id = ${rec.id}`;
          if (q) {
            stat.previouslyQuarantined++;
            continue;
          }
          const [existing] = await tx<{ data: Doc; v: string }[]>`select data, ${tx(spec.versionCol)}::text as v from ${tx(spec.table)} where id = ${rec.id}`;
          if (existing) {
            if (stable(existing.data) === stable(rec.doc)) {
              stat.alreadyPresent++;
              continue;
            }
            // Written by the normalized app since (version > 1): that's the newer truth; never overwrite it.
            if (Number(existing.v) > 1) {
              stat.differs++;
              continue;
            }
            // Only ever copied from the snapshot, and the snapshot has moved on: bring it up to date
            // (same rules apply: transitions, append-only history). Version stays 1 = "from the snapshot".
            try {
              await tx.savepoint(async (sp) => {
                await sp`update ${sp(spec.table)} set ${sp(jsonCols(sp, { ...spec.cols(rec.doc), data: rec.doc }) as Record<string, postgres.ParameterOrJSON<never>>)}, updated_at = now() where id = ${rec.id} and ${sp(spec.versionCol)} = 1`;
                for (const child of spec.children ?? []) await writeChildren(sp, child, rec.doc, existing.data);
              });
              stat.refreshed++;
            } catch (e) {
              quarantine.push({ collection: spec.collection, id: rec.id, reason: `not refreshed: ${(e as Error).message.slice(0, 400)}` });
              stat.differs++;
            }
            continue;
          }
          try {
            // A savepoint per record: a row that breaks a rule is rolled back on its own and quarantined.
            await tx.savepoint(async (sp) => {
              await sp`insert into ${sp(spec.table)} ${sp(jsonCols(sp, { id: rec.id, ...spec.cols(rec.doc), data: rec.doc }) as Record<string, postgres.ParameterOrJSON<never>>)}`;
              for (const child of spec.children ?? []) await writeChildren(sp, child, rec.doc);
              if (spec.collection === "quotes" || spec.collection === "reviews") {
                await sp`set constraints lv_quotes_accepted_version, lv_reviews_completed immediate`;
                await sp`set constraints lv_quotes_accepted_version, lv_reviews_completed deferred`;
              }
            });
            stat.inserted++;
          } catch (e) {
            const reason = (e as Error).message.slice(0, 500);
            await tx`insert into lv_quarantine ${tx({ collection: spec.collection, id: rec.id, data: tx.json(rec.doc as postgres.JSONValue), reason, run_id: runId } as Record<string, postgres.ParameterOrJSON<never>>)} on conflict do nothing`;
            quarantine.push({ collection: spec.collection, id: rec.id, reason });
            stat.quarantined++;
          }
        }
      }

      // Upload ownership: live files whose owner is a live account.
      const uploads = { linked: 0, alreadyLinked: 0, ownerNotLive: 0 };
      const media = await tx<{ id: string; owner_id: string; linked: boolean; live_owner: boolean }[]>`
        select m.id, m.owner_id, exists (select 1 from lv_uploads u where u.media_id = m.id) as linked,
          exists (select 1 from lv_users u where u.id = m.owner_id) as live_owner
        from app_media m where m.scope = 'live'`;
      for (const m of media) {
        if (m.linked) uploads.alreadyLinked++;
        else if (!m.live_owner) uploads.ownerNotLive++;
        else {
          await tx`insert into lv_uploads (media_id, owner_user_id) values (${m.id}, ${m.owner_id})`;
          uploads.linked++;
        }
      }

      const childRows: Record<string, number> = {};
      for (const t of [...new Set(SPECS.flatMap((x) => (x.children ?? []).map((c) => c.table)))]) {
        const [c] = await tx<{ n: string }[]>`select count(*)::text as n from ${tx(t)}`;
        childRows[t] = Number(c.n);
      }
      const lines = (r: (typeof records)[number]) => (Array.isArray(r.doc.history) ? (r.doc.history as unknown[]).length : 0);
      const snapshotEntries = records.reduce((n, r) => n + lines(r), 0);
      const quarantinedKeys = new Set((await tx<{ collection: string; id: string }[]>`select collection, id from lv_quarantine`).map((q) => `${q.collection}:${q.id}`));
      const quarantinedEntries = records.filter((r) => quarantinedKeys.has(`${r.spec.collection}:${r.id}`)).reduce((n, r) => n + lines(r), 0);
      const [h] = await tx<{ n: string }[]>`select count(*)::text as n from lv_history`;

      // Every snapshot record is either in its table or in quarantine.
      const unaccounted: string[] = [];
      for (const rec of records) {
        const [inTable] = await tx`select 1 from ${tx(rec.spec.table)} where id = ${rec.id}`;
        const [inQ] = await tx`select 1 from lv_quarantine where collection = ${rec.spec.collection} and id = ${rec.id}`;
        if (!inTable && !inQ) unaccounted.push(`${rec.spec.collection}:${rec.id}`);
      }

      await tx`set constraints all deferred`;
      await tx`select nextval('lv_change_seq')`;
      report = {
        runId,
        mode,
        snapshotRecords: records.length,
        perCollection: per,
        childRows,
        history: { snapshotEntries, migratedEntries: snapshotEntries - quarantinedEntries, quarantinedEntries, normalizedEntries: Number(h.n) },
        uploads,
        quarantine,
        unaccounted,
        backupRows,
      };
      await tx`update lv_migration_runs set finished_at = now(), report = ${tx.json(report as unknown as postgres.JSONValue)} where id = ${runId}`;
      if (mode === "dry_run") throw new DryRunRollback();
    });
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e;
  }
  return report;
}

/**
 * Rollback path: write the normalized live records back into the snapshot (app_records, scope
 * 'live'), after backing up the snapshot rows. Records only in the snapshot are left alone.
 */
export async function exportToSnapshot(sql: postgres.Sql) {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('clutch_lv_migration'))`;
    const [run] = await tx<{ id: string }[]>`insert into lv_migration_runs (mode) values ('export_snapshot') returning id::text`;
    const backup = await tx`insert into app_scope_backup (collection, id, scope, data, migration)
      select collection, id, scope, data, ${`export_v1:${run.id}`} from app_records where scope = 'live'`;
    const rows: { spec: (typeof SPECS)[number]; data: Doc }[] = [];
    for (const spec of SPECS) for (const r of await tx<{ data: Doc }[]>`select data from ${tx(spec.table)}`) rows.push({ spec, data: r.data });
    const db = dbFromRecords(rows);
    let written = 0;
    for (const spec of SPECS.filter((x) => !x.map)) {
      for (const d of db[spec.collection] as unknown as Doc[]) {
        const id = spec.id(d);
        await tx`insert into app_records (scope, collection, id, data, updated_at) values ('live', ${spec.collection}, ${id}, ${tx.json(d as postgres.JSONValue)}, now())
          on conflict (scope, collection, id) do update set data = excluded.data, updated_at = now()`;
        written++;
      }
    }
    for (const field of ["profileShares", "drafts", "customerNotes"] as const) {
      await tx`insert into app_records (scope, collection, id, data, updated_at) values ('live', '_kv', ${field}, ${tx.json(db[field] as unknown as postgres.JSONValue)}, now())
        on conflict (scope, collection, id) do update set data = excluded.data, updated_at = now()`;
      written++;
    }
    // Instances on the snapshot path reload.
    await tx`update app_meta set version = version + 1 where key = 'main'`;
    const report = { backupRows: backup.count, written };
    await tx`update lv_migration_runs set finished_at = now(), report = ${tx.json(report)} where id = ${run.id}`;
    return report;
  });
}
