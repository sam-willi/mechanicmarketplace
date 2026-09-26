import { toPublicProfile, type PublicMechanicProfile } from "@/lib/domain/public-profile";
import type { SearchPool } from "@/lib/domain/search";
import { eligibility } from "@/lib/domain/eligibility";
import { findArea, serves } from "@/lib/domain/areas";
import { effectiveStatus } from "@/lib/verification/lifecycle";
import { inQueue, QUEUE_FILTERS, type QueueCounts } from "@/lib/admin-queue";
import type { MechanicProfile, VerificationRecord, VerificationStatus } from "@/lib/domain/types";
import { textArray, type EvidenceFacts, type Reader } from "./reader";
import type { DB } from "../mock/seed";

/**
 * The repository's aggregate and candidate reads, as SQL (targeted live mode). Each has an
 * in-memory twin in lib/data/mock/repository.ts that the demo and tests use; the database
 * tests check both give the same answers on the same records.
 */
export class LiveQueries {
  constructor(private readonly r: Reader) {}

  private get db(): DB {
    return this.r.slice.db;
  }

  private profileOf(id: string, now: Date) {
    const d = this.db;
    const mechanic = d.mechanics.find((m) => m.id === id)!;
    return toPublicProfile(
      {
        mechanic,
        screenings: d.screenings.filter((x) => x.mechanicId === id),
        insurance: d.insurance.filter((x) => x.mechanicId === id),
        credentials: d.credentials.filter((x) => x.mechanicId === id),
        employment: d.employment.filter((x) => x.mechanicId === id),
        pastRepairs: d.pastRepairs.filter((x) => x.mechanicId === id),
        reviews: d.reviews.filter((x) => x.mechanicId === id),
        verifications: d.verifications.filter((x) => x.mechanicId === id),
        scope: "live",
      },
      now,
    );
  }

  /**
   * A lightweight public profile: the mechanic's own row and the records behind their four
   * checks, with reputation totals from the database's counts. Enough to rank, filter and show a
   * result card; the repair list itself isn't read (`verifiedWork` is empty).
   */
  private liteProfile(id: string, f: EvidenceFacts | undefined, now: Date): PublicMechanicProfile {
    const d = this.db;
    const p = toPublicProfile(
      {
        mechanic: d.mechanics.find((m) => m.id === id)!,
        screenings: d.screenings.filter((x) => x.mechanicId === id),
        insurance: d.insurance.filter((x) => x.mechanicId === id),
        verifications: d.verifications.filter((x) => x.mechanicId === id && x.subjectType === "insurance_record"),
        credentials: [],
        employment: [],
        pastRepairs: [],
        reviews: [],
        scope: "live",
      },
      now,
    );
    const rating = f && f.ratingCount ? { average: f.ratingSum / f.ratingCount, count: f.ratingCount, communication: 0, timeliness: 0, priceAccuracy: 0, workmanship: 0 } : null;
    return { ...p, reputation: { ...p.reputation, verifiedRepairs: f?.total ?? 0, rating, repeatCustomers: f?.repeatCustomers ?? 0 } };
  }

  /**
   * What search and replacement suggestions rank: every BOOKABLE mechanic (a complete basic
   * profile; verified or not), as lightweight profiles plus the database's verified-repair counts
   * for this repair, make and model. With `unbookable`, also up to that many profiles that can't be
   * booked yet (incomplete), newest first: a bounded sample, never the whole directory.
   */
  async searchPool(opts: { unbookable?: number; repair?: string; make?: string; model?: string } = {}): Promise<SearchPool> {
    const now = new Date();
    const ids = await this.r.bookableCandidateIds();
    await Promise.all([this.r.byIds("mechanics", ids, "public"), this.r.checkRecords(ids, "public")]);
    const facts = await this.r.evidenceFacts(ids, { repair: opts.repair, make: opts.make, model: opts.model });
    const bookable = ids.map((id) => this.liteProfile(id, facts.get(id), now)).filter((p) => eligibility(p).eligible);
    const out = [...bookable];
    const counts = new Map([...facts].map(([id, f]) => [id, { cross: f.cross, cat: f.cat, mk: f.mk, mdl: f.mdl }]));
    if (opts.unbookable) {
      const s = this.r.sql;
      const keep = new Set(bookable.map((p) => p.id));
      const rows = await this.r.load(
        "mechanics",
        s`not (id = any(${textArray(bookable.map((p) => p.id))}::text[]))`,
        "public",
        s`order by created_at desc, id collate "C" desc limit ${opts.unbookable}`,
      );
      const others = rows.map((m) => String(m.id)).filter((id) => !keep.has(id));
      await this.r.checkRecords(others, "public");
      const more = await this.r.evidenceFacts(others, { repair: opts.repair, make: opts.make, model: opts.model });
      for (const id of others) {
        out.push(this.liteProfile(id, more.get(id), now));
        const f = more.get(id)!;
        counts.set(id, { cross: f.cross, cat: f.cat, mk: f.mk, mdl: f.mdl });
      }
    }
    // Canonical order (as the snapshot and in-memory stores list mechanics).
    const order = new Map(this.db.mechanics.map((m, i) => [m.id, i]));
    return { profiles: out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)), counts };
  }

  /** Full public profiles (with their repair list) for a few mechanics. */
  async publicProfiles(ids: string[]): Promise<PublicMechanicProfile[]> {
    const now = new Date();
    await this.r.mechanics(ids, "public");
    return ids.filter((id) => this.db.mechanics.some((m) => m.id === id)).map((id) => this.profileOf(id, now));
  }

  /** Is anyone bookable at all? Only the basic profile decides, so only mechanic rows are read. */
  async anyBookable(): Promise<boolean> {
    const now = new Date();
    for (let offset = 0; ; offset += 50) {
      const ids = await this.r.bookableCandidateIds({ limit: 50, offset });
      if (!ids.length) return false;
      await this.r.byIds("mechanics", ids, "public");
      if (ids.some((id) => eligibility(this.liteProfile(id, undefined, now)).eligible)) return true;
    }
  }

  /** Staff: bookable mechanics (exact) and profiles in total. */
  async supplyCounts(): Promise<{ profiles: number; bookable: number }> {
    const pool = await this.searchPool();
    const [row] = await this.r.sql<{ n: number }[]>`select count(*)::int as n from lv_mechanics`;
    return { profiles: row.n, bookable: pool.profiles.length };
  }

  /** Staff queue tab counts, from grouped rows: the same predicate as the page, applied per group. */
  async verificationCounts(nowIso: string, weekAgo: string): Promise<QueueCounts> {
    const rows = await this.r.sql<{ eff: VerificationStatus; method: string | null; recent: boolean; n: number }[]>`
      select lv_effective_status(status, data->>'expiresAt', ${nowIso}::timestamptz) as eff, data->>'method' as method,
        (status = 'verified' and coalesce(data->>'verifiedAt', '') collate "C" >= ${weekAgo}) as recent, count(*)::int as n
      from lv_verifications group by 1, 2, 3`;
    const out = Object.fromEntries(QUEUE_FILTERS.map((f) => [f.key, 0])) as QueueCounts;
    out.approvedThisWeek = 0;
    for (const g of rows) {
      for (const f of QUEUE_FILTERS) if (inQueue(f.key, g.eff, g.method ?? undefined)) out[f.key] += g.n;
      if (g.recent && g.method !== "platform_job") out.approvedThisWeek += g.n;
    }
    return out;
  }

  async supportStatusCounts(): Promise<Record<string, number>> {
    const rows = await this.r.sql<{ status: string; n: number }[]>`select status, count(*)::int as n from lv_support_cases group by status`;
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }

  async quoteStatusCounts(mechanicId: string): Promise<Record<string, number>> {
    const rows = await this.r.sql<{ status: string; n: number }[]>`select status, count(*)::int as n from lv_quotes where mechanic_id = ${mechanicId} group by status`;
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }

  async openSupportCount(): Promise<number> {
    const [row] = await this.r.sql<{ n: number }[]>`select count(*)::int as n from lv_support_cases where status <> 'resolved'`;
    return row.n;
  }

  /** Requests waiting for a mechanic that this one would be sent once matchable. Counts only: no request is read. */
  async waitingDemandCount(m: MechanicProfile): Promise<number> {
    if (!m.declaredRepairCategories.length) return 0;
    const s = this.r.sql;
    const groups = await s<{ area: string | null; n: number }[]>`
      select data->'location'->>'area' as area, count(*)::int as n
      from lv_requests r
      where status = 'open' and data->>'repairCategory' = any(${textArray(m.declaredRepairCategories)}::text[])
        and not exists (select 1 from lv_request_invitations i where i.request_id = r.id)
      group by 1`;
    return groups
      .filter((g) => {
        const area = findArea(g.area ?? undefined);
        return !area || serves(m, area);
      })
      .reduce((n, g) => n + g.n, 0);
  }

  /** After a decision: this mechanic's most recently submitted pending item, else the oldest pending item. */
  async nextPendingVerification(excludeId: string, mechanicId: string, nowIso: string): Promise<string | undefined> {
    const s = this.r.sql;
    const pending = () => s`lv_effective_status(status, data->>'expiresAt', ${nowIso}::timestamptz) = 'pending' and id <> ${excludeId}`;
    const [mine] = await s<{ id: string }[]>`select id from lv_verifications where status = 'pending' and mechanic_id = ${mechanicId} and ${pending()}
      order by coalesce(data->>'submittedAt', '') collate "C" desc, id collate "C" desc limit 1`;
    if (mine) return mine.id;
    const [oldest] = await s<{ id: string }[]>`select id from lv_verifications where status = 'pending' and ${pending()}
      order by coalesce(data->>'submittedAt', '') collate "C", id collate "C" limit 1`;
    return oldest?.id;
  }
}

/** In-memory twins over a whole DB (demo, tests, the snapshot rollback path). */
export const memoryQueries = {
  verificationCounts(list: VerificationRecord[], now: Date, weekAgo: string): QueueCounts {
    const out = Object.fromEntries(QUEUE_FILTERS.map((f) => [f.key, 0])) as QueueCounts;
    out.approvedThisWeek = 0;
    for (const v of list) {
      const st = effectiveStatus(v.status, v.expiresAt, now);
      for (const f of QUEUE_FILTERS) if (inQueue(f.key, st, v.method)) out[f.key]++;
      if (v.status === "verified" && (v.verifiedAt ?? "") >= weekAgo && v.method !== "platform_job") out.approvedThisWeek++;
    }
    return out;
  },
};
