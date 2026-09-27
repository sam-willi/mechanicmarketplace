import type postgres from "postgres";
import { SPECS, type Spec } from "./spec";
import { Slice, type Level } from "./slice";
import { AREAS } from "@/lib/domain/areas";
import type { DB } from "../mock/seed";

/**
 * Targeted reads of the normalized live tables (0004 + 0006). Each method runs one or a
 * few indexed queries and adds the rows to a `Slice`; nothing here ever selects a whole
 * table. Callers decide WHAT is visible (lib/data/normalized/needs.ts applies the
 * viewer's owner/invitation/staff predicates); this layer only knows how to fetch it.
 *
 * Related rows are always fetched in batches (`= any($ids)`), never one query per row.
 */

type Doc = Record<string, unknown>;
type Q = postgres.Sql | postgres.TransactionSql;
// A postgres.js fragment (a nested tagged template).
type Frag = postgres.PendingQuery<postgres.Row[]>;

const SPEC = Object.fromEntries(SPECS.map((s) => [s.collection, s])) as Record<keyof DB, Spec>;

/**
 * Private fields dropped (in SQL) when a record is read for someone other than its owner
 * or staff: screening vendor references and outcomes, policy numbers and documents,
 * reviewer notes and evidence descriptions. Public pages never need them.
 */
/** Largest id list read in one query (see byIds). */
const ID_BATCH = 200;
/**
 * Accounts are read in smaller batches: a write that matches a request reads the accounts of
 * every candidate mechanic, and at 200 ids Postgres 16 read the whole (narrow) users table
 * instead of the primary key. At 50, 16, 17 and 18 all use the key
 * (tests-db/targeted.test.ts "id batches").
 */
export const ACCOUNT_BATCH = 50;

export const PUBLIC_STRIP: Partial<Record<keyof DB, string[]>> = {
  screenings: ["provider", "providerRef", "result", "consentAt"],
  insurance: ["carrier", "policyLast4", "coverageCents", "documentName"],
  // The provider's key stays: public statements name who checked ("verified by Stripe Identity").
  verifications: ["providerRef", "reviewerId", "notes", "evidenceSummary", "events", "reasonCodes", "documentIds", "nameMatches", "consentAt", "decidedBy", "accountId"],
  credentials: ["documentName"],
  employment: ["documentName"],
  pastRepairs: ["description"],
};

/** Collections of a mechanic's evidence, as toPublicProfile reads them. */
export const SOURCE_COLLECTIONS = ["screenings", "insurance", "credentials", "employment", "pastRepairs", "reviews", "verifications"] as const;

/**
 * A text[] parameter as an explicit Postgres array literal. The client's own array encoding
 * depends on type information it loads lazily per connection, and a query on a fresh
 * connection could otherwise go out as "a,b" (found under load); this never depends on that.
 */
export function textArray(xs: readonly string[]): string {
  return `{${xs.map((x) => `"${String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

/** Per-candidate evidence numbers (see Reader.evidenceFacts). */
export interface EvidenceFacts {
  total: number;
  cross: number;
  cat: number;
  mk: number;
  mdl: number;
  ratingSum: number;
  ratingCount: number;
  repeatCustomers: number;
  /** Verified repairs per "category|make" (matching). */
  pairs: Map<string, number>;
}

/** Keyset cursor for lists newest-first: the sort field and id of the last row shown. */
export interface Cursor {
  at: string;
  id: string;
}

/** Lists that grow are always bounded. Owner lists read at most this many rows for counts and badges. */
export const OWNER_MAX = 500;

export class Reader {
  constructor(
    readonly sql: Q,
    readonly slice: Slice,
  ) {}

  private uniq(ids: (string | undefined | null)[]) {
    return [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))];
  }

  /**
   * One query: rows of `collection` matching `where`, added to the slice. `tail` is ORDER
   * BY / LIMIT. Public reads drop the private fields in the query itself.
   */
  async load(collection: keyof DB, where: Frag, level: Level = "full", tail?: Frag): Promise<Doc[]> {
    const spec = SPEC[collection];
    const s = this.sql;
    const strip = level === "public" ? PUBLIC_STRIP[collection] : undefined;
    const proj = strip ? s`data - ${textArray(strip)}::text[]` : s`data`;
    const rows = await s<{ data: Doc; v: string; c: string }[]>`
      select ${proj} as data, ${s(spec.versionCol)}::text as v,
        to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') as c
      from ${s(spec.table)} where ${where} ${tail ?? s``}`;
    this.slice.stats.queries++;
    this.slice.stats.rows += rows.length;
    for (const r of rows) this.slice.add(spec, r.data, Number(r.v), r.c, level);
    this.slice.settle();
    return rows.map((r) => r.data);
  }

  /** Rows by primary key, skipping ones already held at this level or better. */
  async byIds(collection: keyof DB, ids: (string | undefined | null)[], level: Level = "full") {
    const need = this.uniq(ids).filter((id) => !this.slice.has(collection, id, level));
    if (!need.length) return [];
    const size = collection === "users" ? ACCOUNT_BATCH : ID_BATCH;
    if (need.length <= size) return this.load(collection, this.sql`id = any(${textArray(need)}::text[])`, level);
    // A long id list (e.g. the accounts of every candidate a write considers) is read in primary-key
    // batches: one huge "= any(...)" makes the planner scan the whole table instead.
    const batches = [];
    for (let i = 0; i < need.length; i += size) batches.push(need.slice(i, i + size));
    return (await Promise.all(batches.map((b) => this.load(collection, this.sql`id = any(${textArray(b)}::text[])`, level)))).flat();
  }

  private any(col: string, ids: string[]) {
    return this.sql`${this.sql(col)} = any(${textArray(ids)}::text[])`;
  }

  // ------------------------------------------------------------------ accounts
  async user(id: string) {
    return this.byIds("users", [id], "full");
  }
  users(ids: (string | undefined)[]) {
    return this.byIds("users", ids, "full");
  }
  async customerByUser(userId: string) {
    return this.load("customers", this.sql`user_id = ${userId}`);
  }
  async mechanicByUser(userId: string) {
    return this.load("mechanics", this.sql`user_id = ${userId}`);
  }
  customers(ids: (string | undefined)[]) {
    return this.byIds("customers", ids, "full");
  }

  // ------------------------------------------------------------------ mechanics
  /** Mechanic rows plus, optionally, the evidence behind their public profile. */
  async mechanics(ids: (string | undefined)[], level: Level, withSources = true) {
    const list = this.uniq(ids);
    if (!list.length) return;
    await Promise.all([this.byIds("mechanics", list, level), withSources ? this.sources(list, level) : undefined]);
  }

  async mechanicBySlug(slug: string, level: Level) {
    const rows = await this.load("mechanics", this.sql`slug = ${slug}`, level);
    if (rows[0]) await this.sources([String(rows[0].id)], level);
    return rows[0];
  }

  private sourcesLoaded = new Map<string, Level>();
  /** Screenings, insurance, credentials, employment, repairs, reviews and verifications of these mechanics (7 queries, whatever the count). */
  async sources(mechanicIds: (string | undefined)[], level: Level) {
    const ids = this.uniq(mechanicIds).filter((id) => {
      const had = this.sourcesLoaded.get(id);
      return !(had === "full" || had === level);
    });
    if (!ids.length) return;
    for (const id of ids) this.sourcesLoaded.set(id, level);
    await Promise.all(SOURCE_COLLECTIONS.map((c) => this.load(c, this.any("mechanic_id", ids), level)));
  }

  async confirmationsOfMechanic(mechanicId: string) {
    return this.load("confirmations", this.sql`data->>'mechanicId' = ${mechanicId}`);
  }
  async confirmationsOfRepairs(repairIds: string[]) {
    const ids = this.uniq(repairIds);
    if (!ids.length) return [];
    return this.load("confirmations", this.any("past_repair_id", ids));
  }
  async confirmationByToken(token: string) {
    return this.load("confirmations", this.sql`token = ${token}`);
  }

  // ------------------------------------------------------------------ vehicles
  vehiclesOfCustomer(customerId: string) {
    return this.load("vehicles", this.sql`customer_id = ${customerId}`, "full", this.sql`order by created_at, id limit ${OWNER_MAX}`);
  }
  vehicles(ids: (string | undefined)[]) {
    return this.byIds("vehicles", ids, "full");
  }

  // ------------------------------------------------------------------ requests
  requests(ids: (string | undefined)[]) {
    return this.byIds("requests", ids, "full");
  }

  /** A customer's requests, newest first; `statuses` filters, `page` pages (limit + 1 rows, so the caller can tell there's more). */
  requestsOfCustomer(customerId: string, opts: { statuses?: string[]; exclude?: string[]; vehicleId?: string; limit?: number; before?: Cursor }) {
    const s = this.sql;
    const where = s`customer_id = ${customerId}
      ${opts.statuses ? s`and status = any(${textArray(opts.statuses)}::text[])` : s``}
      ${opts.exclude ? s`and status <> all(${textArray(opts.exclude)}::text[])` : s``}
      ${opts.vehicleId ? s`and vehicle_id = ${opts.vehicleId}` : s``}
      ${opts.before ? s`and ((data->>'createdAt') collate "C", id collate "C") < (${opts.before.at}, ${opts.before.id})` : s``}`;
    return this.load("requests", where, "full", s`order by (data->>'createdAt') collate "C" desc, id collate "C" desc limit ${Math.min(opts.limit ?? OWNER_MAX, OWNER_MAX) + 1}`);
  }

  /** Requests sent to this mechanic (through their invitation), in the given statuses. */
  requestsInvited(mechanicId: string, statuses: string[], limit = OWNER_MAX) {
    const s = this.sql;
    return this.load(
      "requests",
      s`id in (select request_id from lv_request_invitations where mechanic_id = ${mechanicId}) and status = any(${textArray(statuses)}::text[])`,
      "full",
      s`order by (data->>'createdAt') collate "C" desc, id collate "C" desc limit ${limit}`,
    );
  }

  /** Is this request one this mechanic was sent? (The only way a mechanic can read one.) */
  async requestForMechanic(requestId: string, mechanicId: string) {
    return this.load("requests", this.sql`id = ${requestId} and exists (select 1 from lv_request_invitations i where i.request_id = lv_requests.id and i.mechanic_id = ${mechanicId})`);
  }

  // ------------------------------------------------------------------ estimates
  /** Estimates on these requests. `sentOnly` hides drafts (customers never see them); `mechanicId` limits to one author. */
  async quotesOfRequests(requestIds: string[], opts: { sentOnly?: boolean; mechanicId?: string; statuses?: string[] } = {}) {
    const ids = this.uniq(requestIds);
    if (!ids.length) return [];
    const s = this.sql;
    return this.load(
      "quotes",
      s`${this.any("request_id", ids)}
        ${opts.sentOnly ? s`and status <> 'draft'` : s``}
        ${opts.mechanicId ? s`and mechanic_id = ${opts.mechanicId}` : s``}
        ${opts.statuses ? s`and status = any(${textArray(opts.statuses)}::text[])` : s``}`,
    );
  }
  quotes(ids: (string | undefined)[]) {
    return this.byIds("quotes", ids, "full");
  }
  quotesOfMechanic(mechanicId: string, opts: { limit?: number; before?: Cursor; statuses?: string[] } = {}) {
    const s = this.sql;
    return this.load(
      "quotes",
      s`mechanic_id = ${mechanicId}
        ${opts.statuses ? s`and status = any(${textArray(opts.statuses)}::text[])` : s``}
        ${opts.before ? s`and ((data->>'createdAt') collate "C", id collate "C") < (${opts.before.at}, ${opts.before.id})` : s``}`,
      "full",
      s`order by (data->>'createdAt') collate "C" desc, id collate "C" desc limit ${Math.min(opts.limit ?? OWNER_MAX, OWNER_MAX) + 1}`,
    );
  }
  /** This mechanic's estimates with a customer question still unanswered (the badge count). */
  quotesWithOpenQuestions(mechanicId: string) {
    return this.load(
      "quotes",
      this.sql`mechanic_id = ${mechanicId} and exists (select 1 from lv_quote_questions qq where qq.quote_id = lv_quotes.id and qq.answer is null)`,
      "full",
      this.sql`limit ${OWNER_MAX}`,
    );
  }

  // ------------------------------------------------------------------ jobs
  jobs(ids: (string | undefined)[]) {
    return this.byIds("jobs", ids, "full");
  }
  async jobsOfRequests(requestIds: string[]) {
    const ids = this.uniq(requestIds);
    if (!ids.length) return [];
    return this.load("jobs", this.any("request_id", ids));
  }
  jobsOf(side: "customer" | "mechanic", id: string, opts: { statuses?: string[]; limit?: number } = {}) {
    const s = this.sql;
    return this.load(
      "jobs",
      s`${s(side === "customer" ? "customer_id" : "mechanic_id")} = ${id} ${opts.statuses ? s`and status = any(${textArray(opts.statuses)}::text[])` : s``}`,
      "full",
      s`order by created_at desc, id desc limit ${Math.min(opts.limit ?? OWNER_MAX, OWNER_MAX)}`,
    );
  }
  async reviewsOfJobs(jobIds: string[]) {
    const ids = this.uniq(jobIds);
    if (!ids.length) return [];
    return this.load("reviews", this.any("job_id", ids));
  }
  async repairsOfJobs(jobIds: string[], level: Level = "full") {
    const ids = this.uniq(jobIds);
    if (!ids.length) return [];
    return this.load("pastRepairs", this.any("job_id", ids), level);
  }

  /** A customer's own repair history (Clutch jobs), newest first; optionally only with one mechanic. */
  historyOfCustomer(customerId: string, opts: { mechanicId?: string; limit?: number } = {}) {
    const s = this.sql;
    return this.load(
      "pastRepairs",
      s`customer_id = ${customerId} and data->>'source' = 'platform' ${opts.mechanicId ? s`and mechanic_id = ${opts.mechanicId}` : s``}`,
      "full",
      s`order by (data->>'performedOn') collate "C" desc, id collate "C" desc limit ${Math.min(opts.limit ?? OWNER_MAX, OWNER_MAX)}`,
    );
  }

  // ------------------------------------------------------------------ the rest
  savedOf(customerId: string, mechanicId?: string) {
    const s = this.sql;
    return this.load("saved", s`customer_id = ${customerId} ${mechanicId ? s`and mechanic_id = ${mechanicId}` : s``}`, "full", s`order by created_at, id limit ${OWNER_MAX}`);
  }
  draftOf(customerId: string) {
    return this.load("drafts", this.sql`id = ${customerId}`);
  }
  notesOf(mechanicId: string, customerIds?: string[]) {
    const s = this.sql;
    return this.load("customerNotes", s`mechanic_id = ${mechanicId} ${customerIds ? s`and customer_id = any(${textArray(this.uniq(customerIds))}::text[])` : s``}`, "full", s`limit ${OWNER_MAX}`);
  }
  sharesOf(mechanicId: string) {
    return this.load("profileShares", this.sql`id = ${mechanicId}`);
  }

  notifications(userId: string, mode: string, opts: { unreadOnly?: boolean; limit?: number; before?: Cursor } = {}) {
    const s = this.sql;
    return this.load(
      "notifications",
      s`user_id = ${userId} and mode = ${mode}
        ${opts.unreadOnly ? s`and not read` : s``}
        ${opts.before ? s`and ((data->>'createdAt') collate "C", id collate "C") < (${opts.before.at}, ${opts.before.id})` : s``}`,
      "full",
      s`order by (data->>'createdAt') collate "C" desc, id collate "C" desc limit ${Math.min(opts.limit ?? 50, OWNER_MAX) + 1}`,
    );
  }

  supportCases(opts: { userId?: string; limit?: number; before?: Cursor; ids?: string[]; statuses?: string[] }) {
    const s = this.sql;
    return this.load(
      "supportReports",
      s`true ${opts.userId ? s`and user_id = ${opts.userId}` : s``}
        ${opts.statuses ? s`and status = any(${textArray(opts.statuses)}::text[])` : s``}
        ${opts.ids ? s`and ${this.any("id", this.uniq(opts.ids))}` : s``}
        ${opts.before ? s`and ((data->>'createdAt') collate "C", id collate "C") < (${opts.before.at}, ${opts.before.id})` : s``}`,
      "full",
      s`order by (data->>'createdAt') collate "C" desc, id collate "C" desc limit ${Math.min(opts.limit ?? 50, OWNER_MAX) + 1}`,
    );
  }

  verifications(ids: (string | undefined)[]) {
    return this.byIds("verifications", ids, "full");
  }
  verificationsOfMechanic(mechanicId: string) {
    return this.load("verifications", this.sql`mechanic_id = ${mechanicId}`, "full", this.sql`limit ${OWNER_MAX}`);
  }

  /**
   * Candidates that may be bookable: a launch-area base and radius, at least one repair type, a
   * pricing approach and some availability (lib/domain/eligibility.ts `readiness`). Verification is
   * NOT a filter (policy of 2026-09-26): it's shown and ranked, not required. A superset of the
   * exact rule, which callers apply to the loaded rows.
   */
  async bookableCandidateIds(opts: { limit?: number; offset?: number; relevantTo?: { category: string; make: string; area?: { lat: number; lng: number } } } = {}): Promise<string[]> {
    const s = this.sql;
    const rel = opts.relevantTo;
    // For one request: only mechanics the matching rule could pick (it requires one of these), and who
    // can reach the area (lib/domain/areas.ts `serves`, with a hundredth of a mile to spare for rounding).
    const relevant = rel
      ? s`and (exists (select 1 from lv_mechanic_categories c where c.mechanic_id = m.id and c.category = ${rel.category})
          or exists (select 1 from lv_mechanic_stats st, jsonb_object_keys(st.pairs) k
            where st.mechanic_id = m.id and (split_part(k, '|', 1) = ${rel.category} or split_part(k, '|', 2) = ${rel.make})))
        ${rel.area ? s`and m.service_radius_mi + 2 + 0.01 >=
            2 * 3958.8 * asin(sqrt(power(sin(radians((${rel.area.lat}::float8 - (m.data->>'lat')::float8) / 2)), 2)
              + cos(radians((m.data->>'lat')::float8)) * cos(radians(${rel.area.lat}::float8)) * power(sin(radians((${rel.area.lng}::float8 - (m.data->>'lng')::float8) / 2)), 2)))` : s``}`
      : s``;
    const rows = await s<{ id: string }[]>`
      select m.id from lv_mechanics m
      where m.neighborhood = any(${textArray(AREAS.map((a) => a.label))}::text[]) and m.service_radius_mi > 0
        and (m.hourly_rate_cents > 0 or jsonb_array_length(coalesce(m.data->'fixedPrices', '[]'::jsonb)) > 0)
        and exists (select 1 from lv_mechanic_categories c where c.mechanic_id = m.id)
        and (coalesce(m.data->>'availabilityNote', '') <> '' or exists (select 1 from lv_mechanic_openings o where o.mechanic_id = m.id))
        ${relevant}
      order by m.created_at, m.id collate "C"
      limit ${opts.limit ?? 5000} offset ${opts.offset ?? 0}`;
    this.slice.stats.queries++;
    return rows.map((r) => r.id);
  }

  /**
   * What ranking and matching need about each candidate's evidence, as numbers computed in the
   * database: verified repairs per (repair type, make) pair and in total, verified-review rating
   * sum and count, and repeat customers. Never the repair or review documents themselves.
   */
  async evidenceFacts(ids: string[], opts: { repair?: string; make?: string; model?: string; pairs?: boolean } = {}) {
    const list = this.uniq(ids);
    const out = new Map<string, EvidenceFacts>();
    if (!list.length) return out;
    // One row per mechanic (lv_mechanic_stats, 0008), kept current by the database.
    const rows = await this.sql<{ id: string; total: number; pairs: Record<string, number>; models: Record<string, number>; rsum: number; rn: number; rep: number }[]>`
      select mechanic_id as id, verified_total as total, pairs, models, rating_sum as rsum, rating_n as rn, repeat_customers as rep
      from lv_mechanic_stats where mechanic_id = any(${textArray(list)}::text[])`;
    this.slice.stats.queries++;
    this.slice.stats.rows += rows.length;
    const { repair, make, model } = opts;
    for (const id of list) out.set(id, { total: 0, cross: 0, cat: 0, mk: 0, mdl: 0, ratingSum: 0, ratingCount: 0, repeatCustomers: 0, pairs: new Map() });
    for (const r of rows) {
      const f = out.get(r.id)!;
      f.total = r.total;
      f.ratingSum = r.rsum;
      f.ratingCount = r.rn;
      f.repeatCustomers = r.rep;
      for (const [k, n] of Object.entries(r.pairs)) {
        f.pairs.set(k, n);
        const bar = k.indexOf("|");
        const [c, mk] = [k.slice(0, bar), k.slice(bar + 1)];
        if (repair && make && c === repair && mk === make) f.cross += n;
        if (repair && c === repair) f.cat += n;
        if (make && mk === make) f.mk += n;
      }
      // Model match exactly as ranking counts it (lib/domain/search.ts): same make, model contains the text.
      if (model) {
        for (const [k, n] of Object.entries(r.models)) {
          const bar = k.indexOf("|");
          if ((!make || k.slice(0, bar) === make) && k.slice(bar + 1).toLowerCase().includes(model.toLowerCase())) f.mdl += n;
        }
      }
    }
    return out;
  }

  /** The records behind each candidate's four checks (not their repairs, reviews or documents). */
  async checkRecords(ids: string[], level: Level) {
    const list = this.uniq(ids);
    if (!list.length) return;
    const s = this.sql;
    await Promise.all([
      this.load("screenings", this.any("mechanic_id", list), level),
      this.load("insurance", this.any("mechanic_id", list), level),
      // The canonical records behind the four checks customers see (identity may have no screening row).
      this.load("verifications", s`${this.any("mechanic_id", list)} and category in ('identity', 'background', 'driving_record', 'insurance')`, level),
    ]);
  }

  /** Open requests that never reached a mechanic (waiting for one to be verified), oldest first. */
  waitingRequests(limit: number) {
    return this.load(
      "requests",
      this.sql`status = 'open' and not exists (select 1 from lv_request_invitations i where i.request_id = lv_requests.id)`,
      "full",
      this.sql`order by (data->>'createdAt') collate "C", id collate "C" limit ${limit}`,
    );
  }

  // ------------------------------------------------------------------ closure for writes
  /**
   * Everything a write's domain rules read around the records it loaded: a request's car,
   * customer, estimates, jobs and invited mechanics; a job's estimate, request, car, review
   * and verified record; the accounts of every customer and mechanic (in-app notifications
   * are addressed to accounts). Loads by id in batches until nothing new turns up.
   */
  async closeForWrite() {
    for (let round = 0; round < 6; round++) {
      const d = this.slice.db;
      const before = this.slice.stats.rows;
      const reqIds = d.requests.map((r) => r.id);
      const jobIds = d.jobs.map((j) => j.id);
      await Promise.all([
        this.requests([...d.quotes.map((q) => q.requestId), ...d.jobs.map((j) => j.requestId)]),
        this.quotes(d.jobs.map((j) => j.quoteId)),
        this.vehicles([...d.requests.map((r) => r.vehicleId), ...d.jobs.map((j) => j.vehicleId)]),
        this.customers([...d.requests.map((r) => r.customerId), ...d.jobs.map((j) => j.customerId)]),
        this.byIds("mechanics", [
          ...d.requests.flatMap((r) => [...r.matchedMechanicIds, ...(r.requestedMechanicId ? [r.requestedMechanicId] : [])]),
          ...d.quotes.map((q) => q.mechanicId),
          ...d.jobs.map((j) => j.mechanicId),
          ...d.verifications.map((v) => v.mechanicId),
          ...d.pastRepairs.map((p) => p.mechanicId),
          ...d.confirmations.map((c) => c.mechanicId),
        ]),
        this.users([...d.customers.map((c) => c.userId), ...d.mechanics.map((m) => m.userId), ...d.supportReports.map((r) => r.userId)]),
        this.onceFor("quotesOfRequests", reqIds, (ids) => this.quotesOfRequests(ids)),
        this.onceFor("jobsOfRequests", reqIds, (ids) => this.jobsOfRequests(ids)),
        this.onceFor("reviewsOfJobs", jobIds, (ids) => this.reviewsOfJobs(ids)),
        this.onceFor("repairsOfJobs", jobIds, (ids) => this.repairsOfJobs(ids)),
      ]);
      if (this.slice.stats.rows === before) break;
    }
  }

  private memo = new Map<string, Promise<unknown>>();
  /** Run a load once per slice (concurrent callers share it), e.g. the account every getSession() needs. */
  once(key: string, run: () => Promise<unknown>) {
    let p = this.memo.get(key);
    if (!p) {
      p = run().catch((e) => {
        this.memo.delete(key);
        throw e;
      });
      this.memo.set(key, p);
    }
    return p;
  }

  private done = new Map<string, Set<string>>();
  /** Run a batched child lookup only for parents it hasn't run for yet. */
  private async onceFor(kind: string, ids: string[], run: (ids: string[]) => Promise<unknown>) {
    const seen = this.done.get(kind) ?? new Set<string>();
    this.done.set(kind, seen);
    const fresh = this.uniq(ids).filter((id) => !seen.has(id));
    if (!fresh.length) return;
    for (const id of fresh) seen.add(id);
    await run(fresh);
  }
}

/** "at~id" in a URL → a cursor. Anything malformed means "from the start". */
export function parseCursor(raw?: string | null): Cursor | undefined {
  if (!raw || raw.length > 200) return undefined;
  const i = raw.lastIndexOf("~");
  if (i <= 0 || i === raw.length - 1) return undefined;
  return { at: raw.slice(0, i), id: raw.slice(i + 1) };
}
