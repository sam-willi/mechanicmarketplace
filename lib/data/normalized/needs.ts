import { STAFF_SKIP } from "@/lib/admin-queue";
import { Reader, OWNER_MAX, textArray, type Cursor } from "./reader";
import type { Slice } from "./slice";
import { needsNewMechanic } from "@/lib/domain/status";

/**
 * What each screen reads from the live marketplace, for whom. Every method loads the
 * minimum records one page or action needs into this request's slice, with the viewer's
 * right to see them in the query itself:
 *
 *  - a customer reads only their own account, cars, requests, sent estimates on those
 *    requests, jobs, history, saved list, drafts, notifications and support cases, plus the
 *    PUBLIC profile of mechanics involved (private screening fields removed in SQL);
 *  - a mechanic reads only their own profile and evidence, requests they were sent (by
 *    invitation), their own estimates and jobs, the customer's display name, and their own
 *    history with that customer; never another mechanic's estimate;
 *  - staff read the review queue, support cases and demand, and only on staff pages.
 *
 * An id the viewer may not see simply isn't loaded, so the page reads it as "not found".
 * Nothing is cached across requests; each request has its own slice.
 */
export interface Viewer {
  userId?: string;
  customerId?: string;
  mechanicId?: string;
  staff: boolean;
}

const ACTIVE = ["open", "quoted"];
/** Requests that are over: the lists that grow, read a page at a time. */
export const FINAL = ["completed", "cancelled"];
const LIVE_JOB = ["scheduled", "in_progress", "awaiting_customer"];

export class LiveNeeds {
  readonly r: Reader;
  constructor(
    reader: Reader,
    readonly viewer: Viewer,
  ) {
    this.r = reader;
  }
  get slice(): Slice {
    return this.r.slice;
  }
  private get sql() {
    return this.r.sql;
  }
  private get c() {
    return this.viewer.customerId;
  }
  private get m() {
    return this.viewer.mechanicId;
  }

  // ======================================================== account (every signed-in request)
  /** The signed-in account and its role profiles. */
  async account(userId: string) {
    await this.r.once(`account:${userId}`, () => Promise.all([this.r.user(userId), this.r.customerByUser(userId), this.r.mechanicByUser(userId)]));
  }

  // ======================================================== customer
  /** Public profiles (with evidence) of mechanics a customer's own records point to. */
  private async publicMechanics(ids: (string | undefined)[]) {
    await this.r.mechanics(ids, "public");
  }

  /** Mechanic rows only (name, slug), where a page shows who but not their record. */
  private async mechanicRows(ids: (string | undefined)[]) {
    await this.r.byIds("mechanics", ids, "public");
  }

  /** The newest-first history order the pages use (listCustomerHistory). */
  private historyMechanics() {
    const own = this.slice.db.pastRepairs.filter((p) => p.customerId === this.c && p.source === "platform");
    own.sort((a, b) => (a.performedOn !== b.performedOn ? (a.performedOn < b.performedOn ? 1 : -1) : a.id < b.id ? 1 : -1));
    return [...new Set(own.map((p) => p.mechanicId))];
  }

  /**
   * The car, sent estimates and jobs of some of the customer's own requests. `profiles`:
   * "all" = public profiles of every mechanic involved (the request page); "none" = rows
   * only where names are shown, no evidence (list pages).
   */
  private async aroundCustomerRequests(requestIds: string[], profiles: "all" | "none" = "all") {
    const d = this.slice.db;
    const reqs = d.requests.filter((r) => requestIds.includes(r.id) && r.customerId === this.c);
    await Promise.all([this.r.vehicles(reqs.map((r) => r.vehicleId)), this.r.quotesOfRequests(reqs.map((r) => r.id), { sentOnly: true }), this.r.jobsOfRequests(reqs.map((r) => r.id))]);
    const quotes = d.quotes.filter((q) => requestIds.includes(q.requestId));
    if (profiles === "none") return;
    await this.publicMechanics([
      ...quotes.map((q) => q.mechanicId),
      ...reqs.flatMap((r) => [...r.matchedMechanicIds, ...(r.requestedMechanicId ? [r.requestedMechanicId] : []), ...(r.declines ?? []).map((x) => x.mechanicId), ...r.interested.map((i) => i.mechanicId), ...r.questions.map((q) => q.mechanicId)]),
    ]);
  }

  /** Layout badge: open requests needing the customer, unread notifications. */
  async customerShell() {
    if (!this.c || !this.viewer.userId) return;
    const [reqs] = await Promise.all([this.r.requestsOfCustomer(this.c, { statuses: ACTIVE, limit: 100 }), this.r.notifications(this.viewer.userId, "customer", { unreadOnly: true, limit: 99 })]);
    await this.r.quotesOfRequests(reqs.map((r) => String(r.id)), { sentOnly: true });
  }

  async customerHome() {
    if (!this.c) return;
    const [active] = await Promise.all([
      this.r.requestsOfCustomer(this.c, { statuses: ACTIVE, limit: 100 }),
      this.r.vehiclesOfCustomer(this.c),
      this.r.jobsOf("customer", this.c, { limit: OWNER_MAX }),
      this.r.historyOfCustomer(this.c),
      this.r.savedOf(this.c),
      this.r.draftOf(this.c),
    ]);
    const d = this.slice.db;
    const live = d.jobs.filter((j) => LIVE_JOB.includes(j.status));
    await Promise.all([this.r.requests(live.map((j) => j.requestId)), this.aroundCustomerRequests(active.map((r) => String(r.id)), "none")]);
    // Profiles only where the home page shows one: the first three estimates per open request,
    // upcoming jobs, and up to four recent or saved mechanics. Names only for the rest.
    const ids = new Set(active.map((r) => String(r.id)));
    const faces = [...ids].flatMap((rid) => d.quotes.filter((q) => q.requestId === rid && q.status !== "draft").slice(0, 3).map((q) => q.mechanicId));
    const recent = this.historyMechanics().slice(0, 3);
    const saved = d.saved.filter((s) => s.customerId === this.c && !recent.includes(s.mechanicId)).map((s) => s.mechanicId);
    await Promise.all([
      this.publicMechanics([...faces, ...live.map((j) => j.mechanicId), ...[...recent, ...saved].slice(0, 4)]),
      this.mechanicRows([...d.requests.filter((r) => ids.has(r.id)).map((r) => r.declines?.at(-1)?.mechanicId), ...this.historyMechanics()]),
    ]);
  }

  /** Active requests (all) and one page of past ones. */
  async customerRequests(before?: Cursor, limit = 20) {
    if (!this.c) return;
    const [active, past] = await Promise.all([
      this.r.requestsOfCustomer(this.c, { statuses: ACTIVE, limit: 100 }),
      this.r.requestsOfCustomer(this.c, { exclude: ACTIVE, limit, before }),
      this.r.draftOf(this.c),
    ]);
    await this.aroundCustomerRequests([...active, ...past].map((r) => String(r.id)), "none");
  }

  /** One of the customer's own requests (or nothing), with what its page shows. */
  async customerRequest(id: string) {
    if (!this.c) return;
    const got = await this.r.load("requests", this.sql`id = ${id} and customer_id = ${this.c}`);
    if (!got.length) return;
    await this.aroundCustomerRequests([id]);
  }

  /** The request page's "who else could do it" list, only when the customer needs a new mechanic. */
  async replacementPool(requestId: string, pool: () => Promise<void>) {
    const r = this.slice.db.requests.find((x) => x.id === requestId && x.customerId === this.c);
    if (!r) return;
    const quotes = this.slice.db.quotes.filter((q) => q.requestId === r.id);
    if (!needsNewMechanic(r, quotes)) return;
    await pool();
  }

  /** A sent estimate on one of the customer's own requests. */
  async customerQuote(id: string) {
    if (!this.c) return;
    const q = await this.r.load("quotes", this.sql`id = ${id} and status <> 'draft' and request_id in (select id from lv_requests where customer_id = ${this.c})`);
    if (!q.length) return;
    await this.r.load("requests", this.sql`id = ${String(q[0].requestId)} and customer_id = ${this.c}`);
    await this.aroundCustomerRequests([String(q[0].requestId)]);
  }

  /** One of the customer's own jobs, with the booked mechanic's contact (the customer booked them). */
  async customerJob(id: string) {
    if (!this.c) return;
    const j = await this.r.load("jobs", this.sql`id = ${id} and customer_id = ${this.c}`);
    if (!j.length) return;
    const job = this.slice.db.jobs.find((x) => x.id === id)!;
    await Promise.all([
      this.r.vehicles([job.vehicleId]),
      this.r.quotes([job.quoteId]),
      this.r.requests([job.requestId]),
      this.r.reviewsOfJobs([id]),
      this.r.repairsOfJobs([id]),
      this.r.savedOf(this.c, job.mechanicId),
      this.publicMechanics([job.mechanicId]),
    ]);
    const mech = this.slice.db.mechanics.find((m) => m.id === job.mechanicId);
    if (mech) await this.r.user(mech.userId);
  }

  /** "My Repairs": every unfinished request, one page of finished ones, their jobs, and earlier history. */
  async customerRepairs(before?: Cursor, limit = 20) {
    if (!this.c) return;
    const [open, done] = await Promise.all([
      this.r.requestsOfCustomer(this.c, { exclude: FINAL, limit: 100 }),
      this.r.requestsOfCustomer(this.c, { statuses: FINAL, limit, before }),
      this.r.jobsOf("customer", this.c, { limit: OWNER_MAX }),
      this.r.historyOfCustomer(this.c),
    ]);
    const shown = new Set([...open, ...done].map((r) => String(r.id)));
    await this.aroundCustomerRequests([...shown], "none");
    const d = this.slice.db;
    // A profile for each shown repair's booked mechanic; names only for earlier history.
    await Promise.all([this.publicMechanics(d.jobs.filter((j) => shown.has(j.requestId)).map((j) => j.mechanicId)), this.mechanicRows(this.historyMechanics())]);
  }

  async customerSaved() {
    if (!this.c) return;
    await Promise.all([this.r.savedOf(this.c), this.r.historyOfCustomer(this.c)]);
    const d = this.slice.db;
    await this.publicMechanics([...d.saved.filter((s) => s.customerId === this.c).map((s) => s.mechanicId), ...d.pastRepairs.filter((p) => p.customerId === this.c).map((p) => p.mechanicId)]);
  }

  async customerVehicles() {
    if (!this.c) return;
    await Promise.all([this.r.vehiclesOfCustomer(this.c), this.r.historyOfCustomer(this.c), this.r.jobsOf("customer", this.c, { limit: OWNER_MAX })]);
    await this.mechanicRows(this.historyMechanics());
  }

  async customerVehicle(id: string) {
    if (!this.c) return;
    const v = await this.r.load("vehicles", this.sql`id = ${id} and customer_id = ${this.c}`);
    if (!v.length) return;
    await Promise.all([this.r.historyOfCustomer(this.c), this.r.jobsOf("customer", this.c, { limit: OWNER_MAX }), this.r.requestsOfCustomer(this.c, { vehicleId: id, statuses: ["open", "quoted", "booked"], limit: 100 })]);
    await this.mechanicRows(this.historyMechanics());
  }

  async customerVehicleList() {
    if (this.c) await this.r.vehiclesOfCustomer(this.c);
  }

  async customerDraft() {
    if (this.c) await this.r.draftOf(this.c);
  }

  async customerSavedIds() {
    if (this.c) await this.r.savedOf(this.c);
  }

  async customerHelp() {
    if (!this.c || !this.viewer.userId) return;
    const [jobs] = await Promise.all([this.r.jobsOf("customer", this.c, { limit: 100 }), this.r.supportCases({ userId: this.viewer.userId, limit: 50 })]);
    await Promise.all([this.r.vehicles(jobs.map((j) => String(j.vehicleId))), this.r.byIds("mechanics", jobs.map((j) => String(j.mechanicId)), "public")]);
  }

  /** A request form aimed at one mechanic: their public profile, the customer's cars and draft. */
  async newRequest(slug?: string) {
    if (!this.c) return;
    await Promise.all([this.r.vehiclesOfCustomer(this.c), this.r.draftOf(this.c), slug ? this.r.mechanicBySlug(slug, "public") : undefined]);
  }

  // ======================================================== mechanic
  /** The mechanic's own profile and every piece of their evidence (their own data, in full). */
  async ownSources() {
    const m = this.m;
    if (!m) return;
    await this.r.once(`own:${m}`, () => Promise.all([this.r.mechanics([m], "full"), this.r.confirmationsOfMechanic(m)]));
  }

  /** Requests sent to this mechanic that are still open, with the car and their own estimate. */
  private async openInvitations() {
    if (!this.m) return;
    const reqs = await this.r.requestsInvited(this.m, ACTIVE, 200);
    const ids = reqs.map((r) => String(r.id));
    await Promise.all([this.r.vehicles(reqs.map((r) => String(r.vehicleId))), this.r.quotesOfRequests(ids, { mechanicId: this.m }), this.r.customers(reqs.map((r) => String(r.customerId)))]);
  }

  async mechanicShell() {
    if (!this.m || !this.viewer.userId) return;
    await Promise.all([
      this.r.notifications(this.viewer.userId, "mechanic", { unreadOnly: true, limit: 99 }),
      this.openInvitations(),
      this.r.quotesWithOpenQuestions(this.m),
      this.r.verificationsOfMechanic(this.m),
      this.r.jobsOf("mechanic", this.m, { statuses: ["scheduled", "in_progress"], limit: 200 }),
    ]);
  }

  async mechanicHome() {
    if (!this.m) return;
    await Promise.all([
      this.ownSources(),
      this.openInvitations(),
      this.r.jobsOf("mechanic", this.m, { limit: 200 }),
      this.r.quotesOfMechanic(this.m, { limit: 200 }),
      this.r.sharesOf(this.m),
    ]);
    await this.aroundMechanicWork();
  }

  /** Cars, requests, estimates and customer names behind the mechanic's own jobs, estimates and history. */
  private async aroundMechanicWork() {
    const d = this.slice.db;
    const jobs = d.jobs.filter((j) => j.mechanicId === this.m);
    const quotes = d.quotes.filter((q) => q.mechanicId === this.m);
    await Promise.all([this.r.requests([...jobs.map((j) => j.requestId), ...quotes.map((q) => q.requestId)]), this.r.quotes(jobs.map((j) => j.quoteId))]);
    await Promise.all([
      this.r.vehicles([...jobs.map((j) => j.vehicleId), ...d.requests.filter((r) => quotes.some((q) => q.requestId === r.id)).map((r) => r.vehicleId)]),
      this.r.customers([...jobs.map((j) => j.customerId), ...d.requests.map((r) => r.customerId), ...d.pastRepairs.filter((p) => p.mechanicId === this.m).map((p) => p.customerId)]),
    ]);
  }

  async mechanicRequests() {
    if (!this.m) return;
    await Promise.all([this.ownSources(), this.openInvitations()]);
  }

  /** A request this mechanic was sent (or nothing): its car, customer name and their OWN estimate only. */
  async mechanicRequest(id: string) {
    if (!this.m) return;
    const got = await this.r.requestForMechanic(id, this.m);
    await this.ownSources();
    if (!got.length) return;
    const r = this.slice.db.requests.find((x) => x.id === id)!;
    await Promise.all([this.r.vehicles([r.vehicleId]), this.r.customers([r.customerId]), this.r.quotesOfRequests([id], { mechanicId: this.m })]);
  }

  /** One page of the mechanic's own estimates in these statuses, with the request, car, customer name and any job. */
  async mechanicQuotes(statuses: string[], before?: Cursor, limit = 25) {
    const m = this.m;
    if (!m) return;
    const quotes = await this.r.quotesOfMechanic(m, { statuses, before, limit });
    const ids = quotes.map((q) => String(q.id));
    const reqs = await this.r.requests(quotes.map((q) => String(q.requestId)));
    await Promise.all([
      ids.length ? this.r.load("jobs", this.sql`mechanic_id = ${m} and quote_id = any(${textArray(ids)}::text[])`) : undefined,
      this.r.vehicles(this.slice.db.requests.filter((r) => quotes.some((q) => q.requestId === r.id)).map((r) => r.vehicleId)),
      this.r.customers(this.slice.db.requests.filter((r) => quotes.some((q) => q.requestId === r.id)).map((r) => r.customerId)),
    ]);
    void reqs;
  }

  async mechanicJobs() {
    if (!this.m) return;
    await Promise.all([this.r.jobsOf("mechanic", this.m, { limit: OWNER_MAX }), this.r.mechanics([this.m], "full")]);
    await this.aroundMechanicWork();
  }

  /** One of the mechanic's own jobs, with the customer's contact (they're booked together). */
  async mechanicJob(id: string) {
    if (!this.m) return;
    const got = await this.r.load("jobs", this.sql`id = ${id} and mechanic_id = ${this.m}`);
    await this.ownSources();
    if (!got.length) return;
    const j = this.slice.db.jobs.find((x) => x.id === id)!;
    await Promise.all([this.r.requests([j.requestId]), this.r.vehicles([j.vehicleId]), this.r.customers([j.customerId]), this.r.quotes([j.quoteId]), this.r.reviewsOfJobs([id])]);
    const c = this.slice.db.customers.find((x) => x.id === j.customerId);
    if (c) await this.r.user(c.userId);
  }

  async mechanicCustomers() {
    if (!this.m) return;
    await Promise.all([this.ownSources(), this.r.jobsOf("mechanic", this.m, { limit: OWNER_MAX }), this.r.notesOf(this.m)]);
    await this.aroundMechanicWork();
  }

  /** Is this one of the mechanic's own customers (a completed Clutch job together)? Their shared history and name only. */
  async mechanicCustomer(customerId: string) {
    if (!this.m) return;
    await Promise.all([
      this.r.load("pastRepairs", this.sql`mechanic_id = ${this.m} and customer_id = ${customerId} and data->>'source' = 'platform'`, "full", this.sql`limit ${OWNER_MAX}`),
      this.r.customers([customerId]),
    ]);
  }

  async mechanicEarnings() {
    if (!this.m) return;
    await Promise.all([this.ownSources(), this.r.jobsOf("mechanic", this.m, { statuses: LIVE_JOB, limit: OWNER_MAX })]);
    await this.aroundMechanicWork();
  }

  async mechanicHelp() {
    if (!this.m || !this.viewer.userId) return;
    const [jobs] = await Promise.all([this.r.jobsOf("mechanic", this.m, { limit: 100 }), this.r.supportCases({ userId: this.viewer.userId, limit: 50 })]);
    await this.r.vehicles(jobs.map((j) => String(j.vehicleId)));
  }

  async mechanicProfile() {
    if (!this.m) return;
    await Promise.all([this.ownSources(), this.r.sharesOf(this.m)]);
  }

  // ======================================================== actions: owner checks before a write
  /** The viewer's own job and/or request by id (customer: theirs; mechanic: their job, or a request they were sent). Nothing around them. */
  async ownRecords(ids: { jobId?: string; requestId?: string; vehicleId?: string; quoteId?: string }) {
    const s = this.sql;
    await Promise.all([
      ids.jobId && this.c ? this.r.load("jobs", s`id = ${ids.jobId} and customer_id = ${this.c}`) : undefined,
      ids.jobId && this.m ? this.r.load("jobs", s`id = ${ids.jobId} and mechanic_id = ${this.m}`) : undefined,
      ids.requestId && this.c ? this.r.load("requests", s`id = ${ids.requestId} and customer_id = ${this.c}`) : undefined,
      ids.requestId && this.m ? this.r.requestForMechanic(ids.requestId, this.m) : undefined,
      ids.vehicleId && this.c ? this.r.load("vehicles", s`id = ${ids.vehicleId} and customer_id = ${this.c}`) : undefined,
      ids.quoteId && this.c ? this.customerQuote(ids.quoteId) : undefined,
      ids.quoteId && this.m ? this.r.load("quotes", s`id = ${ids.quoteId} and mechanic_id = ${this.m}`) : undefined,
    ]);
  }

  /** The customer's history with one mechanic (e.g. is this a repeat booking?). */
  async historyWith(mechanicId: string) {
    if (this.c) await this.r.historyOfCustomer(this.c, { mechanicId });
  }

  // ======================================================== notifications
  async notifications(mode: "customer" | "mechanic", before?: Cursor, limit = 50) {
    if (this.viewer.userId) await this.r.notifications(this.viewer.userId, mode, { limit, before });
  }

  async ownSupportCases(before?: Cursor, limit = 50) {
    if (this.viewer.userId) await this.r.supportCases({ userId: this.viewer.userId, limit, before });
  }

  // ======================================================== public
  /** A mechanic's public profile by slug (private fields removed in the query). */
  async publicProfile(slug: string) {
    await this.r.once(`slug:${slug}`, () => this.r.mechanicBySlug(slug, "public"));
  }

  /** The private confirmation link a mechanic sent a prior customer: that repair and mechanic only. */
  async confirmation(token: string) {
    const got = await this.r.confirmationByToken(token);
    if (!got.length) return;
    await Promise.all([this.r.byIds("pastRepairs", [String(got[0].pastRepairId)], "public"), this.r.byIds("mechanics", [String(got[0].mechanicId)], "public")]);
  }

  /** Records an uploaded file is attached to, as far as this viewer may see them (for /api/media). */
  async media(mediaId: string) {
    const s = this.sql;
    // A fresh fragment per use: postgres.js fragments aren't shared between queries.
    // Typed jsonb parameters (a plain string would be encoded as a JSON string, never matching).
    const tag = () => s`${s.json([{ id: mediaId }])}`;
    const inQuestion = () => s`${s.json([{ attachments: [{ id: mediaId }] }])}`;
    await Promise.all([
      this.r.load("pastRepairs", s`data->'photos' @> ${tag()}`, "public", s`limit 5`),
      this.r.load("mechanics", s`data->>'photoUrl' = ${`/api/media/${mediaId}`}`, "public", s`limit 5`),
      this.c ? this.r.load("jobs", s`customer_id = ${this.c} and data->'photos' @> ${tag()}`, "full", s`limit 5`) : undefined,
      this.c ? this.r.load("requests", s`customer_id = ${this.c} and (data->'media' @> ${tag()} or data->'questions' @> ${inQuestion()})`, "full", s`limit 5`) : undefined,
      this.m
        ? this.r.load(
            "requests",
            s`(data->'media' @> ${tag()} or data->'questions' @> ${inQuestion()}) and exists (select 1 from lv_request_invitations i where i.request_id = lv_requests.id and i.mechanic_id = ${this.m})`,
            "full",
            s`limit 5`,
          )
        : undefined,
    ]);
  }

  // ======================================================== staff
  private get isStaff() {
    return this.viewer.staff;
  }

  /**
   * One page of the review queue. `where` is the filter's SQL (built from the same effective
   * status rule as the page), oldest submission first, plus the evidence of those mechanics.
   */
  async verificationQueue(filterKey: string, category: string | undefined, after: Cursor | undefined, limit: number, nowIso: string) {
    if (!this.isStaff) return;
    const s = this.sql;
    const eff = () => s`lv_effective_status(status, data->>'expiresAt', ${nowIso}::timestamptz)`;
    const cond =
      filterKey === "expiring"
        ? s`status = 'verified' and ${eff()} in ('expired', 'renewal_due')`
        : filterKey === "done"
          ? s`status in ('verified', 'failed', 'revoked') and ${eff()} in ('verified', 'failed', 'revoked') and coalesce(data->>'method', '') not in ('platform_job', 'customer_confirmation')`
          : filterKey === "waiting"
            ? s`status = 'needs_more_info'`
            : s`status in ('submitted', 'under_review') and coalesce(data->>'method', '') not in ${s(STAFF_SKIP)}`;
    const rows = await this.r.load(
      "verifications",
      s`${cond} ${category ? s`and category = ${category}` : s``}
        ${after ? s`and (coalesce(data->>'submittedAt', '') collate "C", id collate "C") > (${after.at}, ${after.id})` : s``}`,
      "full",
      s`order by coalesce(data->>'submittedAt', '') collate "C", id collate "C" limit ${limit + 1}`,
    );
    await this.r.mechanics(rows.map((v) => String(v.mechanicId)), "full");
  }

  /** One verification with everything a reviewer weighs: the mechanic's full record and the subject's confirmation. */
  async verificationReview(id: string) {
    if (!this.isStaff) return;
    const got = await this.r.verifications([id]);
    if (!got.length) return;
    const v = this.slice.db.verifications.find((x) => x.id === id)!;
    await Promise.all([this.r.mechanics([v.mechanicId], "full"), this.r.confirmationsOfRepairs([v.subjectId]), v.reviewerId ? this.r.user(v.reviewerId) : undefined]);
  }

  async supportCases(statuses: string[], before?: Cursor, limit = 50) {
    if (!this.isStaff) return;
    const rows = await this.r.supportCases({ statuses, limit, before });
    await Promise.all([this.r.users(rows.map((r) => String(r.userId))), this.r.jobs(rows.map((r) => (r.jobId ? String(r.jobId) : undefined)))]);
  }

  async supportCase(id: string) {
    if (!this.isStaff) return;
    const rows = await this.r.supportCases({ ids: [id], limit: 1 });
    if (!rows.length) return;
    const rep = this.slice.db.supportReports.find((x) => x.id === id)!;
    await Promise.all([this.r.user(rep.userId), rep.jobId ? this.r.jobs([rep.jobId]) : undefined]);
    const job = rep.jobId ? this.slice.db.jobs.find((j) => j.id === rep.jobId) : undefined;
    if (job) await Promise.all([this.r.quotes([job.quoteId]), this.r.vehicles([job.vehicleId]), this.r.byIds("mechanics", [job.mechanicId], "full"), this.r.customers([job.customerId])]);
  }

  /** Open requests no mechanic has picked up (oldest first, bounded), with their cars and live estimates. No customer data. */
  async demand(limit: number) {
    if (!this.isStaff) return;
    const s = this.sql;
    const reqs = await this.r.load("requests", s`status in ('open', 'quoted')`, "full", s`order by (data->>'createdAt') collate "C", id collate "C" limit ${limit + 1}`);
    const ids = reqs.map((r) => String(r.id));
    await Promise.all([this.r.vehicles(reqs.map((r) => String(r.vehicleId))), this.r.quotesOfRequests(ids, { statuses: ["submitted", "accepted"] })]);
  }
}
