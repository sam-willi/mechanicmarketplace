import { toPublicProfile, type ProfileSources } from "@/lib/domain/public-profile";
import { eligibility } from "@/lib/domain/eligibility";
import { confirmSpec, toRecorded } from "@/lib/vehicles/record";
import { CATEGORY_LABEL, REPAIR_LABEL } from "@/lib/domain/provenance";
import type { IntakeDraft } from "@/lib/domain/intake-draft";
import { customerRelationships, relevanceKey } from "@/lib/domain/reputation";
import type {
  AnalyticsEventName,
  AppMode,
  NotificationKind,
  User,
  CustomerConfirmation,
  ID,
  Job,
  PastRepair,
  Quote,
  QuoteRevision,
  Review,
  Slot,
  RepairMedia,
  RepairPhoto,
  SupportReport,
  RepairRequest,
  RequestEdit,
  ScreeningKind,
  Vehicle,
  VerificationRecord,
  VerificationStatus,
  DeclineReason,
} from "@/lib/domain/types";
import { getProviderByKey, getScreeningProvider, screeningOpen } from "@/lib/verification/providers/registry";
import { addMonths, effectiveStatus, isPubliclyValid, today } from "@/lib/verification/lifecycle";
import { inQueue } from "@/lib/admin-queue";
import { canMove, transition, type Actor as VActor, type VerificationEvent } from "@/lib/verification/model";
import { mechanicMessage, reason } from "@/lib/verification/reasons";
import { verifierName } from "@/lib/verification/display";
import type { ReviewAction } from "../repository";
import { AREAS, findArea, serves } from "@/lib/domain/areas";
import { parseSlotText } from "@/lib/domain/schedule";
import { quoteTotals } from "@/lib/domain/quote";
import { assertTransition, LifecycleError, type Actor, type AuditEntry } from "@/lib/domain/transitions";
import type { DeliveryEventType } from "@/lib/notify/events";
import { memoryQueries } from "../normalized/queries";
import { countsFor } from "../evidence";
import { ACK_TEXT, checksNow, DISCLOSURE_VERSION, disclosureText, snapshotKey, type BookingAcknowledgement } from "@/lib/domain/disclosure";
import type { MechanicProfile } from "@/lib/domain/types";
import { isWaitingForMatch } from "@/lib/domain/status";

/** How many matching mechanics a posted request reaches. Small on purpose: no auction. */
const MATCH_LIMIT = 4;
import type { RepositoryCore } from "../repository";
import { current, persistent } from "../store";
import type { DB } from "./seed";
import type { Scope } from "../scope";

/** Newest first by a date/time field, then by id: the same order the live queries use (collate "C"). */
function newestFirst<T extends { id: string }>(field: (x: T) => string | undefined) {
  return (a: T, b: T) => {
    const fa = field(a) ?? "";
    const fb = field(b) ?? "";
    if (fa !== fb) return fa < fb ? 1 : -1;
    return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
  };
}

let counter = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36)}${(counter++).toString(36)}`;
const nowISO = () => new Date().toISOString();

/**
 * Where a mechanic is based, from a launch area (key or label). Search and matching measure
 * distance from here. Unknown text keeps central LA until they pick an area.
 */
function baseOf(neighborhood?: string) {
  const a = findArea(neighborhood) ?? AREAS.find((x) => x.label.toLowerCase() === neighborhood?.trim().toLowerCase());
  return a ? { neighborhood: a.label, lat: a.lat, lng: a.lng } : { neighborhood: neighborhood?.trim() || undefined, lat: 34.05, lng: -118.25 };
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * A write referred to a record that doesn't exist in the repository's scope:
 * e.g. a live request "sent" to a demo mechanic, or a demo customer saving a
 * real one. Scopes are separate stores, so the other scope's ids never resolve.
 */
export class ScopeError extends Error {
  constructor(kind: string, id: string | undefined, scope: Scope) {
    super(`No ${kind} ${id ?? "(missing id)"} in the ${scope} marketplace.`);
    this.name = "ScopeError";
  }
}

export class MockRepository implements RepositoryCore {
  /** Every read and write goes to this scope's records only (lib/data/scope.ts). */
  /** `source` overrides where records are read from (a specific store instance, for multi-instance tests). */
  constructor(
    readonly scope: Scope,
    private readonly source?: () => DB,
  ) {}
  private db() {
    return this.source ? this.source() : current(this.scope);
  }

  /** Appends one line of history (role and action; never names or contact details). */
  private log(entity: { history?: AuditEntry[] }, by: AuditEntry["by"], action: string, detail?: string) {
    entity.history = [...(entity.history ?? []), { at: nowISO(), by, action, ...(detail ? { detail } : {}) }];
  }

  /** The job, if it belongs to this customer or mechanic. Anything else reads as "not found", so ids can't be probed. */
  private jobOf(jobId: ID, who: Actor) {
    const job = this.getJob(jobId);
    const mine = job && (who.role === "customer" ? job.customerId === who.customerId : who.role === "mechanic" ? job.mechanicId === who.mechanicId : false);
    if (!job || !mine) throw new LifecycleError("That repair wasn't found.", "not_found");
    return job;
  }

  /** The estimate, if it's on this customer's request (or was written by this mechanic). */
  private quoteOf(quoteId: ID, who: Actor) {
    const q = this.getQuote(quoteId);
    const r = q ? this.getRequest(q.requestId) : undefined;
    const mine = q && r && (who.role === "customer" ? r.customerId === who.customerId && q.status !== "draft" : who.role === "mechanic" ? q.mechanicId === who.mechanicId : false);
    if (!q || !r || !mine) throw new LifecycleError("That estimate wasn't found.", "not_found");
    return { q, r };
  }

  private staff(userId: ID) {
    const u = this.mustUser(userId);
    if (!u.roles.includes("admin")) throw new LifecycleError("Only Clutch staff can do this.", "forbidden");
    return u;
  }

  /** Write guard: every id a write links to must resolve in this scope. */
  private must<T>(kind: string, id: ID | undefined, found: (id: ID) => T | undefined): T {
    const x = id ? found(id) : undefined;
    if (!x) throw new ScopeError(kind, id, this.scope);
    return x;
  }
  private mustUser = (id: ID | undefined) => this.must("account", id, (x) => this.getUser(x));
  private mustCustomer = (id: ID | undefined) => this.must("customer", id, (x) => this.getCustomer(x));
  private mustMechanic = (id: ID | undefined) => this.must("mechanic", id, (x) => this.getMechanic(x));
  private mustRequest = (id: ID | undefined) => this.must("request", id, (x) => this.getRequest(x));

  // ---------------------------------------------------------------- public
  listPublicProfiles() {
    return this.db().mechanics.map((m) => toPublicProfile(this.getMechanicSources(m.id)));
  }

  getPublicProfile(slug: string) {
    const m = this.getMechanicBySlug(slug);
    return m ? toPublicProfile(this.getMechanicSources(m.id)) : null;
  }

  // --------------------------------------------------------------- private
  getUser(id: ID) {
    return this.db().users.find((u) => u.id === id);
  }
  getMechanic(id: ID) {
    return this.db().mechanics.find((m) => m.id === id);
  }
  getMechanicByPhotoUrl(url: string) {
    return this.db().mechanics.find((m) => m.photoUrl === url);
  }
  getMechanicBySlug(slug: string) {
    return this.db().mechanics.find((m) => m.slug === slug);
  }

  getMechanicSources(mechanicId: ID): ProfileSources {
    const d = this.db();
    const mechanic = this.getMechanic(mechanicId)!;
    return {
      mechanic,
      screenings: d.screenings.filter((s) => s.mechanicId === mechanicId),
      insurance: d.insurance.filter((s) => s.mechanicId === mechanicId),
      credentials: d.credentials.filter((s) => s.mechanicId === mechanicId),
      employment: d.employment.filter((s) => s.mechanicId === mechanicId),
      pastRepairs: d.pastRepairs.filter((s) => s.mechanicId === mechanicId),
      reviews: d.reviews.filter((s) => s.mechanicId === mechanicId),
      verifications: d.verifications.filter((s) => s.mechanicId === mechanicId),
      scope: this.scope,
    };
  }

  listVerifications(filter?: { mechanicId?: ID; statuses?: VerificationRecord["status"][] }) {
    return this.db()
      .verifications.filter((v) => !filter?.mechanicId || v.mechanicId === filter.mechanicId)
      .filter((v) => !filter?.statuses || filter.statuses.includes(v.status))
      .sort(newestFirst((v) => v.submittedAt));
  }

  getVerification(id: ID) {
    return this.db().verifications.find((v) => v.id === id);
  }

  describeSubject(v: VerificationRecord) {
    const d = this.db();
    switch (v.subjectType) {
      // Staff see who ran it and a short support reference, never report contents or provider internals.
      case "account":
      case "screening_check": {
        const s = d.screenings.find((x) => x.id === v.subjectId);
        const ref = v.providerRef ?? s?.providerRef;
        return {
          title: CATEGORY_LABEL[v.category],
          detail: [
            v.provider || s?.provider ? `Provider: ${verifierName(v.provider ?? s?.provider, v.method)}` : "",
            ref ? `Support reference: …${ref.slice(-6)}` : "",
            v.consentAt || s?.consentAt ? `Disclosure consent recorded ${(v.consentAt ?? s?.consentAt ?? "").slice(0, 10)}` : "",
            v.nameMatches === true ? "Name on the ID matches the account" : v.nameMatches === false ? "Name on the ID does NOT match the account" : "",
          ].filter(Boolean),
        };
      }
      case "insurance_record": {
        const i = d.insurance.find((x) => x.id === v.subjectId);
        return {
          title: `Insurance: ${i?.carrier ?? ""}`,
          detail: i
            ? [
                i.policyType ? `Policy type: ${i.policyType.replace(/_/g, " ")}` : "Policy type: not recorded (older submission)",
                i.namedInsured ? `Named insured: ${i.namedInsured}` : "Named insured: not recorded (older submission)",
                `Effective ${i.effectiveOn} to ${i.expiresOn}`,
                v.documentIds?.length ? `${v.documentIds.length} document${v.documentIds.length > 1 ? "s" : ""} stored` : "No document stored (only a file name was recorded)",
              ]
            : [],
        };
      }
      case "credential": {
        const c = d.credentials.find((x) => x.id === v.subjectId);
        return {
          title: c ? `${c.issuer} ${c.code ? c.code + " · " : ""}${c.name}` : "Credential",
          detail: c
            ? [c.issuedOn ? `Issued ${c.issuedOn}` : "", c.expiresOn ? `Expires ${c.expiresOn}` : "No expiry", c.documentName ? `Document: ${c.documentName}` : ""].filter(Boolean)
            : [],
        };
      }
      case "employment": {
        const e = d.employment.find((x) => x.id === v.subjectId);
        return {
          title: e ? `${e.position}, ${e.employer}` : "Employment",
          detail: e ? [`${e.startedOn} → ${e.endedOn ?? "present"}`, e.documentName ? `Document: ${e.documentName}` : "No document"] : [],
        };
      }
      case "past_repair": {
        const r = d.pastRepairs.find((x) => x.id === v.subjectId);
        const conf = d.confirmations.find((c) => c.pastRepairId === v.subjectId);
        return {
          title: r ? `${r.year} ${r.make} ${r.model} — ${r.title}` : "Past repair",
          detail: [
            r ? `Performed ${r.performedOn}` : "",
            r?.evidence.length ? `Evidence: ${r.evidence.map((e) => e.name).join(", ")}` : "No files attached",
            conf ? `Confirmation sent to ${conf.contactName} (${conf.contact}) on ${conf.sentAt}${conf.response ? ` — ${conf.response}` : " — awaiting reply"}` : "",
          ].filter(Boolean),
        };
      }
    }
  }

  getConfirmationByToken(token: string) {
    const d = this.db();
    const confirmation = d.confirmations.find((c) => c.token === token);
    if (!confirmation) return null;
    const repair = d.pastRepairs.find((r) => r.id === confirmation.pastRepairId)!;
    const mechanic = this.getMechanic(confirmation.mechanicId)!;
    return { confirmation, repair, mechanic };
  }

  listConfirmations(mechanicId: ID) {
    return this.db().confirmations.filter((c) => c.mechanicId === mechanicId);
  }

  getCustomer(id: ID) {
    return this.db().customers.find((c) => c.id === id);
  }
  listVehicles(customerId: ID) {
    return this.db().vehicles.filter((v) => v.customerId === customerId);
  }
  getVehicle(id: ID) {
    return this.db().vehicles.find((v) => v.id === id);
  }
  listRequestsForCustomer(customerId: ID) {
    return this.db()
      .requests.filter((r) => r.customerId === customerId)
      .sort(newestFirst((r) => r.createdAt));
  }
  listAllRequests() {
    return [...this.db().requests].sort(newestFirst((r) => r.createdAt));
  }
  listRequestsForMechanic(mechanicId: ID) {
    return this.db()
      .requests.filter((r) => r.matchedMechanicIds.includes(mechanicId))
      .sort(newestFirst((r) => r.createdAt));
  }
  getRequest(id: ID) {
    return this.db().requests.find((r) => r.id === id);
  }
  listQuotesForRequest(requestId: ID) {
    return this.db().quotes.filter((q) => q.requestId === requestId);
  }
  listQuotesForMechanic(mechanicId: ID) {
    return this.db().quotes.filter((q) => q.mechanicId === mechanicId).sort(newestFirst((q) => q.createdAt));
  }
  getQuote(id: ID) {
    return this.db().quotes.find((q) => q.id === id);
  }
  listJobsForMechanic(mechanicId: ID) {
    return this.db().jobs.filter((j) => j.mechanicId === mechanicId);
  }
  listJobsForCustomer(customerId: ID) {
    return this.db().jobs.filter((j) => j.customerId === customerId);
  }

  // ------------------------------------------ candidate and aggregate reads (in memory)
  searchPool() {
    return { profiles: this.listPublicProfiles() };
  }
  publicProfiles(ids: ID[]) {
    return ids.map((id) => this.getMechanic(id)).filter((m) => m !== undefined).map((m) => toPublicProfile(this.getMechanicSources(m.id)));
  }
  anyBookable() {
    return this.listPublicProfiles().some((p) => eligibility(p).eligible);
  }
  supplyCounts() {
    const all = this.listPublicProfiles();
    return { profiles: all.length, bookable: all.filter((p) => eligibility(p).eligible).length };
  }
  verificationCounts(nowIso: string, weekAgo: string) {
    return memoryQueries.verificationCounts(this.db().verifications, new Date(nowIso), weekAgo);
  }
  openSupportCount() {
    return this.db().supportReports.filter((r) => r.status !== "resolved").length;
  }
  supportStatusCounts() {
    const out: Record<string, number> = {};
    for (const r of this.db().supportReports) out[r.status] = (out[r.status] ?? 0) + 1;
    return out;
  }
  quoteStatusCounts(mechanicId: ID) {
    const out: Record<string, number> = {};
    for (const q of this.db().quotes) if (q.mechanicId === mechanicId) out[q.status] = (out[q.status] ?? 0) + 1;
    return out;
  }
  waitingDemandCount(m: MechanicProfile) {
    return this.db().requests.filter((r) => {
      if (!isWaitingForMatch(r)) return false;
      const area = findArea(r.location.area);
      if (area && !serves(m, area)) return false;
      return m.declaredRepairCategories.includes(r.repairCategory);
    }).length;
  }
  nextPendingVerification(excludeId: ID, mechanicId: ID, nowIso: string) {
    const now = new Date(nowIso);
    const pending = this.listVerifications().filter((x) => x.id !== excludeId && inQueue("queue", effectiveStatus(x.status, x.expiresAt, now), x.method));
    const mine = pending.find((x) => x.mechanicId === mechanicId);
    if (mine) return mine.id;
    const key = (x: VerificationRecord) => `${x.submittedAt ?? ""}\u0000${x.id}`;
    return [...pending].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))[0]?.id;
  }
  getJob(id: ID) {
    return this.db().jobs.find((j) => j.id === id);
  }
  getReviewForJob(jobId: ID) {
    return this.db().reviews.find((r) => r.jobId === jobId);
  }
  listCustomerHistory(customerId: ID) {
    return this.db()
      .pastRepairs.filter((r) => r.customerId === customerId && r.source === "platform")
      .sort(newestFirst((r) => r.performedOn));
  }
  listSaved(customerId: ID) {
    return this.db()
      .saved.filter((s) => s.customerId === customerId)
      .map((s) => s.mechanicId);
  }

  listMechanicCustomers(mechanicId: ID) {
    const rels = customerRelationships(this.db().pastRepairs.filter((r) => r.mechanicId === mechanicId));
    return rels
      .map((r) => ({ customer: this.getCustomer(r.customerId)!, jobs: r.jobs, isRepeat: r.isRepeat }))
      .filter((r) => r.customer)
      .sort((a, b) => (a.jobs[0].performedOn < b.jobs[0].performedOn ? 1 : -1));
  }

  analyticsSummary(mechanicId: ID) {
    const d = this.db();
    const names: AnalyticsEventName[] = [
      "profile_view",
      "profile_share",
      "verification_badge_clicked",
      "repair_request_started",
      "repair_request_completed",
      "quote_requested",
      "quote_viewed",
      "mechanic_selected",
      "repeat_booking",
      "review_submitted",
    ];
    const out = Object.fromEntries(names.map((n) => [n, 0])) as Record<AnalyticsEventName | "profile_view_total", number>;
    for (const e of d.events.filter((e) => e.mechanicId === mechanicId)) {
      out[e.name] += typeof e.props.count === "number" ? e.props.count : 1;
    }
    out.profile_share += d.profileShares[mechanicId] ?? 0;
    out.profile_view_total = out.profile_view;
    return out;
  }

  listEvents(limit = 50) {
    return [...this.db().events].reverse().slice(0, limit);
  }

  // ---------------------------------------------------------- mechanic writes
  upsertMechanicProfile(input: Parameters<RepositoryCore["upsertMechanicProfile"]>[0]) {
    const d = this.db();
    // One mechanic profile per account: a re-submitted onboarding form updates it.
    const existing = input.id ? this.getMechanic(input.id) : input.userId ? d.mechanics.find((x) => x.userId === input.userId) : undefined;
    if (existing) {
      Object.assign(existing, {
        displayName: input.displayName,
        firstName: input.displayName.split(" ")[0],
        ...(input.photoUrl ? { photoUrl: input.photoUrl } : {}),
        city: input.city,
        neighborhood: input.neighborhood,
        serviceRadiusMi: input.serviceRadiusMi,
        bio: input.bio,
        workModel: input.workModel,
        declaredRepairCategories: input.declaredRepairCategories,
        declaredMakes: input.declaredMakes,
        hourlyRateCents: input.hourlyRateCents,
        diagnosticFeeCents: input.diagnosticFeeCents,
        travelFeeCents: input.travelFeeCents,
        availabilityNote: input.availabilityNote ?? existing.availabilityNote,
        ...(input.neighborhood ? baseOf(input.neighborhood) : {}),
      });
      // A real profile never keeps a demo-only flag (older onboarding set it on every new mechanic).
      if (this.scope === "live") delete existing.isDemo;
      this.matchWaiting();
      return existing;
    }
    let slug = slugify(input.displayName);
    while (this.getMechanicBySlug(slug)) slug = `${slug}-${Math.floor(Math.random() * 90 + 10)}`;
    // Opaque ids: never derived from a name, so they can't coincide with a demo record's id.
    const id = newId("mech");
    // A mechanic profile always belongs to a signed-in account in this marketplace: one login, two roles.
    const existingUser = this.mustUser(input.userId);
    if (!existingUser.roles.includes("mechanic")) existingUser.roles.push("mechanic");
    const m = {
      id,
      userId: existingUser.id,
      slug,
      displayName: input.displayName,
      firstName: input.displayName.split(" ")[0],
      photoUrl: input.photoUrl ?? "",
      city: input.city,
      serviceRadiusMi: input.serviceRadiusMi,
      bio: input.bio,
      workModel: input.workModel,
      hourlyRateCents: input.hourlyRateCents,
      diagnosticFeeCents: input.diagnosticFeeCents,
      travelFeeCents: input.travelFeeCents,
      fixedPrices: [],
      availabilityNote: input.availabilityNote ?? "",
      nextAvailable: "Ask for availability",
      nextAvailableOn: today(),
      declaredRepairCategories: input.declaredRepairCategories,
      declaredMakes: input.declaredMakes,
      selfReportedClaims: [],
      joinedAt: today(),
      ...baseOf(input.neighborhood),
    };
    d.mechanics.push(m);
    this.ensureEmailCheck(m);
    // Onboarding publishes the whole profile at once: requests waiting for someone like them go to them now.
    this.matchWaiting();
    return m;
  }

  updatePricing(mechanicId: ID, input: Parameters<RepositoryCore["updatePricing"]>[1]) {
    const m = this.getMechanic(mechanicId);
    if (!m) return;
    m.hourlyRateCents = input.hourlyRateCents;
    m.diagnosticFeeCents = input.diagnosticFeeCents;
    m.travelFeeCents = input.travelFeeCents;
    m.fixedPrices = input.fixed.map((f) => ({ ...f, id: f.id ?? newId("fp") }));
    // Pricing can be the last profile step: requests waiting for a mechanic may fit now.
    this.matchWaiting();
  }

  // ---------------------------------------------------------- verification (docs/verification.md)
  // Every record changes only through `transition` (lib/verification/model.ts): each change is an
  // appended event, nothing is overwritten, and the mechanic is told about each status change.

  /** A new canonical record, with its first event. */
  private newCheck(
    base: Omit<VerificationRecord, "id" | "status" | "events"> & { id?: ID },
    to: VerificationStatus,
    actor: VActor,
    action: VerificationEvent["action"] = "submitted",
    note?: string,
  ): VerificationRecord {
    const v: VerificationRecord = { ...base, id: base.id ?? newId("ver"), status: "not_started", events: [] };
    v.events!.push({ at: nowISO(), actor, action: "created", to: "not_started" });
    if (to !== "not_started") transition(v, to, { actor, action, note });
    this.db().verifications.push(v);
    return v;
  }

  /** Apply one change to a record and tell the mechanic about status changes. */
  private move(v: VerificationRecord, to: VerificationStatus, e: Parameters<typeof transition>[2]) {
    const before = v.status;
    const applied = transition(v, to, e);
    if (applied && e.note !== undefined) v.notes = e.note;
    if (applied && before !== to) this.notifyCheck(v);
    return applied;
  }

  private notifyCheck(v: VerificationRecord) {
    const name = CATEGORY_LABEL[v.category];
    const msg = mechanicMessage(v.reasonCodes, v.status === "verified" ? undefined : v.notes);
    const title =
      v.status === "verified"
        ? `${name}: verified`
        : v.status === "needs_more_info"
          ? `${name}: more information needed`
          : v.status === "failed"
            ? `${name}: not verified`
            : v.status === "revoked"
              ? `${name}: verification withdrawn`
              : v.status === "expired"
                ? `${name}: expired`
                : v.status === "under_review" || v.status === "submitted"
                  ? `${name}: submitted for review`
                  : `${name}: ${v.status.replace(/_/g, " ")}`;
    this.notifyMechanic(v.mechanicId, "verification_update", title, "/mechanic/verification", msg || undefined);
  }

  /** The record a check currently stands on: nothing has superseded it. */
  currentCheck(mechanicId: ID, category: VerificationRecord["category"]) {
    return this.db()
      .verifications.filter((v) => v.mechanicId === mechanicId && v.category === category && !v.supersededBy)
      .sort((a, b) => ((a.events?.[0]?.at ?? a.submittedAt ?? "") < (b.events?.[0]?.at ?? b.submittedAt ?? "") ? 1 : -1))[0];
  }

  /** A retry or renewal: a new record linked to the one it replaces (which keeps its history). */
  private supersede(old: VerificationRecord | undefined, next: VerificationRecord, actor: VActor) {
    if (!old || old.id === next.id) return;
    next.supersedes = old.id;
    old.supersededBy = next.id;
    old.events = [...(old.events ?? []), { at: nowISO(), actor, action: "superseded", from: old.status, to: old.status, note: `Replaced by ${next.id}.` }];
  }

  /** Email: the sign-in provider confirmed it (accounts can't be created otherwise). */
  private ensureEmailCheck(m: MechanicProfile) {
    if (this.db().verifications.some((v) => v.mechanicId === m.id && v.category === "email")) return;
    this.newCheck(
      { mechanicId: m.id, accountId: m.userId, subjectType: "account", subjectId: m.userId, category: "email", method: "email_link", provider: "sign_in", evidenceSummary: "Email confirmed when the account was created" },
      "verified",
      { kind: "system", id: "sign_in" },
      "approved",
      "Confirmed at sign-in.",
    );
  }

  /** Identity: record a hosted session the server just created (the provider call happens before this write). */
  recordIdentityStart(mechanicId: ID, input: { provider: string; providerRef: string; recordId: ID }) {
    const m = this.mustMechanic(mechanicId);
    const v = this.getVerification(input.recordId);
    if (!v || v.mechanicId !== m.id || v.category !== "identity") throw new LifecycleError("That identity check wasn't found.", "not_found");
    const newSession = Boolean(v.providerRef && v.providerRef !== input.providerRef);
    v.provider = input.provider;
    v.providerRef = input.providerRef;
    if (v.status !== "in_progress") this.move(v, "in_progress", { actor: { kind: "mechanic", id: m.userId }, action: "started", note: newSession ? "New provider session." : undefined });
    else if (newSession) v.events!.push({ at: nowISO(), actor: { kind: "mechanic", id: m.userId }, action: "started", from: v.status, to: v.status, note: "New provider session." });
  }

  /**
   * The identity record a new session belongs to: the current one if it can still take a session
   * (not started, in progress, more information needed), else a new record superseding it.
   */
  prepareIdentityCheck(mechanicId: ID) {
    const m = this.mustMechanic(mechanicId);
    const cur = this.currentCheck(m.id, "identity");
    const eff = cur ? effectiveStatus(cur.status, cur.expiresAt, new Date(), cur.method) : undefined;
    if (cur && (eff === "not_started" || eff === "in_progress" || eff === "needs_more_info") && cur.method === "hosted_identity") return cur;
    if (cur && (eff === "verified" || eff === "under_review" || eff === "submitted")) throw new LifecycleError(eff === "verified" ? "Your identity is already verified." : "Your identity check is being processed.", "stale");
    const next = this.newCheck(
      { mechanicId: m.id, accountId: m.userId, subjectType: "account", subjectId: m.userId, category: "identity", method: "hosted_identity", evidenceSummary: "Government ID + live selfie, captured by the identity provider" },
      "not_started",
      { kind: "mechanic", id: m.userId },
    );
    this.supersede(cur, next, { kind: "mechanic", id: m.userId });
    return next;
  }

  /**
   * A provider's result (fetched server-side after a signed webhook, or on return). Idempotent on
   * the provider event id: a duplicate delivery changes nothing. A result for a record that has
   * moved on (a newer session, or already decided) is recorded in its history but can't regress it.
   */
  applyProviderResult(input: { providerRef: string; recordId?: ID; status: VerificationStatus; reasonCodes: string[]; eventId: string; provider: string; nameMatches?: boolean; validMonths?: number }) {
    const d = this.db();
    const v = d.verifications.find((x) => x.providerRef === input.providerRef && x.provider === input.provider);
    if (!v) throw new LifecycleError("No check for that provider session.", "not_found");
    if (input.recordId && input.recordId !== v.id) throw new LifecycleError("The provider session doesn't belong to that check.", "forbidden");
    if (v.events?.some((e) => e.idempotencyKey === input.eventId)) return { applied: false, status: v.status };
    const actor: VActor = { kind: "provider", id: `${input.provider}:${input.eventId}` };
    if (input.nameMatches !== undefined) v.nameMatches = input.nameMatches;
    const to = input.status;
    // The same state again (a return after the webhook, a re-sent event): nothing new to record.
    if (to === v.status) return { applied: false, status: v.status };
    if (!canMove(v.status, to)) {
      // Recorded, not applied (e.g. a late "processing" after "verified").
      v.events!.push({ at: nowISO(), actor, action: "provider_update", from: v.status, to: v.status, note: `Provider reported ${to.replace(/_/g, " ")}; no change.`, idempotencyKey: input.eventId, ...(input.reasonCodes.length ? { reasonCodes: input.reasonCodes } : {}) });
      return { applied: false, status: v.status };
    }
    const expiresAt = to === "verified" ? addMonths(today(), input.validMonths ?? 36) : undefined;
    this.move(v, to, { actor, action: to === "not_started" ? "cancelled" : "provider_update", reasonCodes: input.reasonCodes, idempotencyKey: input.eventId, expiresAt });
    if (to === "verified") this.matchWaiting();
    return { applied: true, status: v.status };
  }

  async startScreening(mechanicId: ID, kind: ScreeningKind, consent: boolean) {
    if (kind === "identity") throw new LifecycleError("Identity is verified through the hosted identity flow.", "forbidden");
    if (!screeningOpen(kind, this.scope)) throw new Error("Background and driving record checks aren't open yet: Clutch hasn't connected a screening company. You don't need to do anything for now.");
    if (!consent) throw new Error("Your consent to the disclosure is required before a background or driving record check.");
    const d = this.db();
    const m = this.mustMechanic(mechanicId);
    const provider = getScreeningProvider(kind, this.scope);
    const started = await provider.startCheck({ mechanicId, kind, consentAt: nowISO() });
    const sc = { id: newId("scr"), mechanicId, kind, provider: started.provider, providerRef: started.providerRef, status: "in_progress" as const, consentAt: today() };
    d.screenings.push(sc);
    const prev = this.currentCheck(mechanicId, kind);
    const v = this.newCheck(
      {
        mechanicId,
        accountId: m.userId,
        subjectType: "screening_check",
        subjectId: sc.id,
        category: kind,
        method: "vendor_screening",
        provider: started.provider,
        providerRef: started.providerRef,
        consentAt: nowISO(),
        evidenceSummary: kind === "background" ? "Disclosure consent given; criminal and sex offender registry search" : "Motor vehicle record request",
      },
      "in_progress",
      { kind: "mechanic", id: m.userId },
      "started",
      "Consent given; sent to the screening company.",
    );
    this.supersede(prev, v, { kind: "mechanic", id: m.userId });
  }

  async refreshScreening(mechanicId: ID, kind: ScreeningKind) {
    const d = this.db();
    const sc = d.screenings.filter((s) => s.mechanicId === mechanicId && s.kind === kind && s.status === "in_progress").at(-1);
    if (!sc) return;
    const provider = getProviderByKey(sc.provider);
    // The stand-in provider clears checks instantly, which is only acceptable with fictional
    // people. A real mechanic's check stays in progress until a real screening provider is connected.
    if (provider.key === "mock" && this.scope !== "demo") return;
    const res = await provider.getResult(sc.providerRef);
    sc.status = res.status;
    sc.result = res.result;
    sc.completedAt = res.completedAt;
    sc.expiresAt = res.expiresAt;
    const v = d.verifications.find((x) => x.subjectId === sc.id);
    if (v && canMove(v.status, res.status))
      this.move(v, res.status, { actor: { kind: "provider", id: sc.provider }, action: "provider_update", reasonCodes: res.status === "verified" ? ["provider_verified"] : [], expiresAt: res.expiresAt, idempotencyKey: `result:${sc.providerRef}` });
    this.matchWaiting();
  }

  submitCredential(mechanicId: ID, input: Parameters<RepositoryCore["submitCredential"]>[1]) {
    const d = this.db();
    const m = this.mustMechanic(mechanicId);
    const { documentIds, ...rest } = input as typeof input & { documentIds?: ID[] };
    const cred = { ...rest, id: newId("cred"), mechanicId };
    d.credentials.push(cred);
    this.newCheck(
      {
        mechanicId,
        accountId: m.userId,
        subjectType: "credential",
        subjectId: cred.id,
        category: "credential",
        method: input.issuer === "ASE" || input.issuer === "EPA" ? "institution_check" : "document_review",
        provider: "clutch_staff",
        expiresAt: input.expiresOn,
        documentIds: documentIds?.length ? documentIds : undefined,
        evidenceSummary: `${input.issuer} ${input.code ? input.code + " " : ""}${input.name}${documentIds?.length ? " (document attached)" : " (no document attached)"}`,
      },
      "submitted",
      { kind: "mechanic", id: m.userId },
    );
  }

  submitEmployment(mechanicId: ID, input: Parameters<RepositoryCore["submitEmployment"]>[1]) {
    const d = this.db();
    const m = this.mustMechanic(mechanicId);
    const { documentIds, ...rest } = input as typeof input & { documentIds?: ID[] };
    const emp = { ...rest, id: newId("emp"), mechanicId };
    d.employment.push(emp);
    this.newCheck(
      {
        mechanicId,
        accountId: m.userId,
        subjectType: "employment",
        subjectId: emp.id,
        category: "employment",
        method: "employer_check",
        provider: "clutch_staff",
        documentIds: documentIds?.length ? documentIds : undefined,
        evidenceSummary: `${input.position} at ${input.employer}${documentIds?.length ? " (letter attached)" : ""}`,
      },
      "submitted",
      { kind: "mechanic", id: m.userId },
    );
  }

  submitInsurance(mechanicId: ID, input: Parameters<RepositoryCore["submitInsurance"]>[1]) {
    const d = this.db();
    const m = this.mustMechanic(mechanicId);
    const missing = [!input.carrier && "carrier", !input.expiresOn && "expiry date", !input.documentIds?.length && "certificate"].filter(Boolean);
    if (missing.length) throw new LifecycleError(`Add the ${missing.join(", ")} to submit your insurance.`, "invalid_input");
    if (input.effectiveOn && input.expiresOn <= input.effectiveOn) throw new LifecycleError("The expiry date has to be after the effective date.", "invalid_input");
    const rec = {
      id: newId("ins"),
      mechanicId,
      policyType: input.policyType,
      namedInsured: input.namedInsured,
      carrier: input.carrier,
      policyLast4: "••••",
      coverageCents: 0,
      documentName: input.documentName ?? "certificate",
      effectiveOn: input.effectiveOn ?? today(),
      expiresOn: input.expiresOn,
    };
    d.insurance.push(rec);
    const prev = this.currentCheck(mechanicId, "insurance");
    const v = this.newCheck(
      {
        mechanicId,
        accountId: m.userId,
        subjectType: "insurance_record",
        subjectId: rec.id,
        category: "insurance",
        method: "document_review",
        provider: "clutch_staff",
        expiresAt: input.expiresOn,
        documentIds: input.documentIds,
        evidenceSummary: `Certificate of insurance: ${input.carrier}${input.policyType ? `, ${input.policyType.replace(/_/g, " ")}` : ""}${input.namedInsured ? `, named insured ${input.namedInsured}` : ""}`,
      },
      "submitted",
      { kind: "mechanic", id: m.userId },
    );
    // A renewal waits for review before replacing a still-valid policy (see decideVerification).
    if (prev && !isPubliclyValid(effectiveStatus(prev.status, prev.expiresAt))) this.supersede(prev, v, { kind: "mechanic", id: m.userId });
    else if (prev) v.supersedes = prev.id;
  }

  /** The mechanic answers a request for more information (same record), or retries a closed one (new record). */
  resubmit(verificationId: ID, note: string, documentIds: ID[] = []) {
    const v = this.getVerification(verificationId);
    if (!v) return;
    const m = this.mustMechanic(v.mechanicId);
    const actor: VActor = { kind: "mechanic", id: m.userId };
    if (documentIds.length) v.documentIds = [...(v.documentIds ?? []), ...documentIds];
    if (v.status === "needs_more_info") {
      this.move(v, "submitted", { actor, action: "submitted", note: note ? `Mechanic: ${note}` : "Resubmitted by mechanic." });
      return;
    }
    const eff = effectiveStatus(v.status, v.expiresAt, new Date(), v.method);
    if (eff !== "failed" && eff !== "expired" && eff !== "revoked" && eff !== "renewal_due") throw new LifecycleError("This check is still being reviewed.", "stale");
    if (v.method === "hosted_identity" || v.method === "vendor_screening") throw new LifecycleError("Start this check again from the Verification Center.", "invalid_input");
    const next = this.newCheck(
      { ...v, id: undefined, supersedes: undefined, supersededBy: undefined, documentIds: documentIds.length ? documentIds : v.documentIds, reviewerId: undefined, decidedBy: undefined, reasonCodes: undefined, notes: undefined, verifiedAt: undefined, reviewedAt: undefined, submittedAt: undefined, legacy: undefined, events: undefined } as never,
      "submitted",
      actor,
      "submitted",
      note ? `Mechanic: ${note}` : undefined,
    );
    this.supersede(v, next, actor);
  }

  addPastRepair(mechanicId: ID, input: Parameters<RepositoryCore["addPastRepair"]>[1]) {
    const { evidenceNames, ...rest } = input;
    const r: PastRepair = {
      ...rest,
      id: newId("rep"),
      mechanicId,
      source: "self",
      evidence: evidenceNames.filter(Boolean).map((name) => ({ kind: /\.(pdf)$/i.test(name) ? "invoice" : "photo", name })),
    };
    this.db().pastRepairs.push(r);
    return r;
  }

  requestCustomerConfirmation(pastRepairId: ID, contactName: string, contact: string) {
    const d = this.db();
    const repair = d.pastRepairs.find((r) => r.id === pastRepairId)!;
    const conf: CustomerConfirmation = {
      id: newId("conf"),
      pastRepairId,
      mechanicId: repair.mechanicId,
      token: Math.random().toString(36).slice(2, 10),
      contact,
      contactName,
      sentAt: today(),
    };
    d.confirmations.push(conf);
    const m = this.mustMechanic(repair.mechanicId);
    const actor: VActor = { kind: "mechanic", id: m.userId };
    const existing = d.verifications.filter((v) => v.subjectId === pastRepairId && !v.supersededBy).at(-1);
    const open = existing && (existing.status === "not_started" || existing.status === "submitted" || existing.status === "under_review" || existing.status === "needs_more_info");
    if (existing && open && existing.method === "customer_confirmation") {
      existing.events!.push({ at: nowISO(), actor, action: "submitted", from: existing.status, to: existing.status, note: "Confirmation link sent again." });
    } else {
      const next = this.newCheck(
        {
          mechanicId: repair.mechanicId,
          accountId: m.userId,
          subjectType: "past_repair",
          subjectId: pastRepairId,
          category: "past_repair",
          method: "customer_confirmation",
          evidenceSummary: `${repair.year} ${repair.make} ${repair.model}: ${repair.title}`,
        },
        "submitted",
        actor,
        "submitted",
        "Confirmation link sent to the prior customer.",
      );
      this.supersede(existing, next, actor);
    }
    return conf;
  }

  respondToConfirmation(token: string, response: "confirmed" | "denied") {
    const d = this.db();
    const conf = d.confirmations.find((c) => c.token === token);
    if (!conf || conf.response) return;
    conf.response = response;
    conf.respondedAt = today();
    const repair = d.pastRepairs.find((r) => r.id === conf.pastRepairId)!;
    const v = d.verifications.filter((x) => x.subjectId === repair.id && !x.supersededBy).at(-1);
    const actor: VActor = { kind: "customer", id: `confirmation:${conf.id}` };
    if (response === "confirmed") {
      repair.source = "customer_confirmed";
      if (v && canMove(v.status, "verified")) this.move(v, "verified", { actor, action: "approved", note: `Confirmed by ${conf.contactName} through their private link.`, idempotencyKey: `confirmation:${conf.id}` });
    } else if (v && canMove(v.status, "failed")) {
      this.move(v, "failed", { actor, action: "rejected", reasonCodes: ["customer_denied"], note: `${conf.contactName} said they did not recognise this repair.`, idempotencyKey: `confirmation:${conf.id}` });
    }
  }

  declineRequest(requestId: ID, mechanicId: ID, reason?: DeclineReason) {
    const r = this.getRequest(requestId);
    this.mustMechanic(mechanicId);
    if (!r || !r.matchedMechanicIds.includes(mechanicId)) throw new LifecycleError("That request wasn't found.", "not_found");
    if (r.declinedBy.includes(mechanicId)) return; // already declined (double click, second tab)
    const booked = this.db().jobs.find((j) => j.requestId === r.id && j.mechanicId === mechanicId && j.status !== "cancelled");
    if (booked) throw new LifecycleError("The customer already booked you for this repair. To back out, cancel the job from the job page.", "stale");
    if (r.status === "completed" || r.status === "cancelled") return;
    r.declinedBy.push(mechanicId);
    r.declines = [...(r.declines ?? []), { mechanicId, reason, at: nowISO() }];
    // An estimate they'd already sent is withdrawn with them, so it can't be accepted afterwards.
    for (const q of this.listQuotesForRequest(r.id).filter((x) => x.mechanicId === mechanicId && (x.status === "submitted" || x.status === "draft"))) {
      assertTransition("estimate", q.status, "withdrawn");
      q.status = "withdrawn";
      this.log(q, "mechanic", "withdrawn", "mechanic declined the request");
    }
    if (r.status === "quoted" && !this.listQuotesForRequest(r.id).some((x) => x.status === "submitted")) r.status = "open";
    this.log(r, "mechanic", "declined by a mechanic", reason);
    // The customer is told when the mechanic they picked passes, or when everyone it went to has.
    const picked = r.requestedMechanicId === mechanicId;
    const nobodyLeft = r.matchedMechanicIds.every((mid) => r.declinedBy.includes(mid)) && !this.listQuotesForRequest(r.id).some((q) => q.status === "submitted");
    if (picked || nobodyLeft) {
      const v = this.getVehicle(r.vehicleId);
      this.notifyCustomer(
        r.customerId,
        "mechanic_declined",
        picked ? `${this.getMechanic(mechanicId)?.displayName} can't take your ${v?.make ?? ""} request`.replace("  ", " ") : `No one has taken your ${v?.make ?? ""} request yet`.replace("  ", " "),
        `/customer/requests/${r.id}`,
        "We've found other mechanics with strong verified experience for it. Send it on in one tap.",
      );
    }
  }

  forwardRequest(requestId: ID, mechanicIds: ID[], kind: "replacement" | "broaden") {
    const r = this.getRequest(requestId);
    if (!r) return;
    if (r.status !== "open" && r.status !== "quoted") throw new LifecycleError("This request isn't open any more, so it can't be sent to anyone else.", "stale");
    // Only mechanics from this request's own marketplace.
    for (const mid of mechanicIds) this.mustMechanic(mid);
    const fresh = mechanicIds.filter((mid) => !r.matchedMechanicIds.includes(mid) && !r.declinedBy.includes(mid));
    if (!fresh.length) return;
    r.matchedMechanicIds.push(...fresh);
    r.handoffs = [...(r.handoffs ?? []), { to: fresh, at: nowISO(), kind }];
    // A one-mechanic replacement is the customer's new pick.
    if (kind === "replacement" && fresh.length === 1) r.requestedMechanicId = fresh[0];
    r.waitingSince = undefined;
    this.log(r, "customer", kind === "replacement" ? "sent to another mechanic" : "sent to more mechanics", String(fresh.length));
    const v = this.getVehicle(r.vehicleId);
    // The new mechanic sees a new request; never who passed on it.
    for (const mid of fresh) this.notifyMechanic(mid, "new_opportunity", `New job near you: ${v?.year} ${v?.make} ${v?.model}`, `/mechanic/requests/${r.id}`);
  }

  askQuestion(requestId: ID, mechanicId: ID, question: string) {
    const r = this.getRequest(requestId);
    this.mustMechanic(mechanicId);
    if (!r || !r.matchedMechanicIds.includes(mechanicId)) throw new LifecycleError("That request wasn't found.", "not_found");
    if (r.status !== "open" && r.status !== "quoted") throw new LifecycleError("This request isn't open any more.", "stale");
    r.questions.push({ mechanicId, customerId: r.customerId, question, askedAt: today(), attachments: [] });
    this.notifyCustomer(r.customerId, "mechanic_question", `${this.getMechanic(mechanicId)?.displayName} asked a question`, `/customer/requests/${r.id}`, question);
  }

  markInterested(requestId: ID, mechanicId: ID, note?: string) {
    const r = this.getRequest(requestId);
    this.mustMechanic(mechanicId);
    if (!r || !r.matchedMechanicIds.includes(mechanicId)) throw new LifecycleError("That request wasn't found.", "not_found");
    if (r.interested.some((i) => i.mechanicId === mechanicId) || r.declinedBy.includes(mechanicId)) return;
    if (r.status !== "open" && r.status !== "quoted") throw new LifecycleError("This request isn't open any more.", "stale");
    r.interested.push({ mechanicId, note: note?.trim() || undefined, at: today() });
    this.notifyCustomer(r.customerId, "mechanic_interested", `${this.getMechanic(mechanicId)?.displayName} is interested in your request`, `/customer/requests/${r.id}`, note);
  }

  submitQuote(input: Parameters<RepositoryCore["submitQuote"]>[0], opts: { draft?: boolean } = {}) {
    const d = this.db();
    // A quote links a mechanic to a request it was sent to, both in this marketplace.
    const req = this.mustRequest(input.requestId);
    this.mustMechanic(input.mechanicId);
    if (!req.matchedMechanicIds.includes(input.mechanicId)) throw new ScopeError("request sent to this mechanic", input.requestId, this.scope);
    if (req.declinedBy.includes(input.mechanicId)) throw new LifecycleError("You declined this request, so you can't send an estimate for it.", "stale");
    // A customer should never be sent an estimate they can't accept: sending needs the basic profile
    // (area, repairs, pricing, availability). Drafts can still be saved. Verification isn't required.
    if (!opts.draft) {
      const e = eligibility(toPublicProfile(this.getMechanicSources(input.mechanicId)));
      if (!e.eligible) throw new LifecycleError(`Finish your profile before sending estimates: ${e.missing.map((x) => x.label.toLowerCase()).join(", ")}.`, "forbidden");
    }
    const prev = d.quotes.find((x) => x.requestId === input.requestId && x.mechanicId === input.mechanicId);
    // Once accepted, an estimate is frozen: extra work goes through the customer's approval on the job.
    if (prev?.status === "accepted") throw new LifecycleError("The customer accepted this estimate, so it can't be changed. Ask them to approve any extra work from the job page.", "stale");
    if (prev && (prev.status === "withdrawn" || prev.status === "expired")) throw new LifecycleError(`This estimate was ${prev.status}. It can't be sent again.`, "stale");
    if (prev?.status === "declined") throw new LifecycleError("The customer turned this estimate down.", "stale");
    if (req.status !== "open" && req.status !== "quoted") throw new LifecycleError("This request isn't open for estimates any more.", "stale");
    const to = opts.draft ? "draft" : "submitted";
    if (prev) assertTransition("estimate", prev.status, to, prev.status === "submitted" && opts.draft ? "This estimate was already sent. Send a revised version instead of a draft." : undefined);
    const wasSent = prev?.status === "submitted";
    const version = wasSent ? (prev.version ?? 1) + 1 : 1;
    const q: Quote = {
      ...input,
      id: prev?.id ?? newId("quote"),
      status: to,
      createdAt: prev && wasSent ? prev.createdAt : today(),
      customerQuestions: prev?.customerQuestions ?? [],
      version: opts.draft ? undefined : version,
      // A revision keeps every earlier sent version, so the customer sees what changed.
      revisions: wasSent ? [...(prev.revisions ?? []), revisionOf(prev)] : prev?.revisions,
      ...(wasSent ? { revisedAt: nowISO() } : {}),
      history: prev?.history,
    };
    this.log(q, "mechanic", opts.draft ? "draft saved" : wasSent ? `revised to version ${version}` : "sent", opts.draft ? undefined : `total ${quoteTotals(q).total}`);
    d.quotes = d.quotes.filter((x) => x !== prev);
    d.quotes.push(q);
    const r = this.getRequest(input.requestId);
    if (!opts.draft && r) {
      if (r.status === "open") r.status = "quoted";
      const m = this.getMechanic(input.mechanicId);
      const v = this.getVehicle(r.vehicleId);
      this.notifyCustomer(
        r.customerId,
        prev && prev.status !== "draft" ? "quote_updated" : "new_quote",
        `${m?.displayName} ${prev && prev.status !== "draft" ? "updated their estimate" : "sent an estimate"} for your ${v?.make} ${v?.model}`,
        `/customer/requests/${r.id}`,
      );
    }
    return q;
  }

  // ----------------------------------------------------------------- jobs
  confirmAppointment(jobId: ID, mechanicId: ID) {
    const job = this.jobOf(jobId, { role: "mechanic", mechanicId });
    if (job.status !== "scheduled") throw new LifecycleError("This job isn't waiting for a time confirmation any more.", "stale");
    if (job.confirmedAt) return;
    job.confirmedAt = nowISO();
    this.log(job, "mechanic", "time confirmed", job.scheduledFor);
    const m = this.getMechanic(job.mechanicId);
    this.notifyCustomer(job.customerId, "appointment_confirmed", `${m?.firstName} is confirmed for ${job.scheduledFor}`, `/customer/jobs/${job.id}`);
  }

  /** At the car and starting. Verification isn't required (the customer saw it when booking). */
  startJob(jobId: ID, mechanicId: ID) {
    const job = this.jobOf(jobId, { role: "mechanic", mechanicId });
    if (job.status === "in_progress") return;
    assertTransition("job", job.status, "in_progress", job.status === "cancelled" ? "This booking was cancelled." : undefined);
    if (job.reschedule?.status === "pending") job.reschedule = { ...job.reschedule, status: "declined", respondedAt: nowISO() };
    job.status = "in_progress";
    job.startedAt = today();
    this.log(job, "mechanic", "checked in and started");
    const m = this.getMechanic(job.mechanicId);
    this.notifyCustomer(job.customerId, "mechanic_checked_in", `${m?.firstName} checked in and started the repair`, `/customer/jobs/${job.id}`);
  }

  recordDiagnosis(jobId: ID, mechanicId: ID, note: string, matchesEstimate: boolean) {
    const job = this.jobOf(jobId, { role: "mechanic", mechanicId });
    if (job.status !== "in_progress") throw new LifecycleError("Share a diagnosis while the repair is in progress.", "stale");
    job.diagnosis = { note: note.slice(0, 2000), matchesEstimate, at: nowISO() };
    this.log(job, "mechanic", matchesEstimate ? "diagnosis matches the estimate" : "diagnosis differs from the estimate");
    const m = this.getMechanic(job.mechanicId);
    this.notifyCustomer(
      job.customerId,
      "diagnosis_shared",
      matchesEstimate ? `${m?.firstName} confirmed the diagnosis matches the estimate` : `${m?.firstName} found something different`,
      `/customer/jobs/${job.id}`,
      note.slice(0, 160),
    );
  }

  /** Extra work needs the customer's explicit yes first. Earlier requests are kept in scopeChangeHistory. */
  requestScopeChange(jobId: ID, mechanicId: ID, description: string, extraCents: number) {
    const job = this.jobOf(jobId, { role: "mechanic", mechanicId });
    if (job.status !== "in_progress") throw new LifecycleError("Extra work can only be requested while the repair is in progress.", "stale");
    if (job.scopeChange?.status === "pending") throw new LifecycleError("You already asked for approval. Wait for the customer's answer.", "stale");
    const cents = Math.round(extraCents);
    if (!description.trim() || !(cents > 0) || cents > 10_000_000) throw new LifecycleError("Describe the extra work and its extra cost.", "invalid_input");
    if (job.scopeChange) job.scopeChangeHistory = [...(job.scopeChangeHistory ?? []), job.scopeChange];
    job.scopeChange = { description: description.trim().slice(0, 2000), extraCents: cents, status: "pending", requestedAt: nowISO() };
    this.log(job, "mechanic", "asked to approve extra work", `+${cents}`);
    const m = this.getMechanic(job.mechanicId);
    this.notifyCustomer(job.customerId, "scope_change_requested", `${m?.firstName} needs your approval for extra work`, `/customer/jobs/${job.id}`, description.slice(0, 160));
  }

  respondScopeChange(jobId: ID, customerId: ID, approve: boolean) {
    const job = this.jobOf(jobId, { role: "customer", customerId });
    const sc = job.scopeChange;
    if (sc && sc.status === (approve ? "approved" : "declined")) return; // same answer again
    if (!sc || sc.status !== "pending") throw new LifecycleError("There's no extra work waiting for your answer.", "stale");
    if (job.status !== "in_progress") throw new LifecycleError("This repair isn't in progress any more.", "stale");
    sc.status = approve ? "approved" : "declined";
    sc.respondedAt = nowISO();
    this.log(job, "customer", approve ? "approved extra work" : "declined extra work", `${approve ? "+" : ""}${sc.extraCents}`);
    this.notifyMechanic(job.mechanicId, "scope_change_answered", `${this.getCustomer(job.customerId)?.displayName} ${approve ? "approved" : "declined"} the extra work`, `/mechanic/jobs/${job.id}`);
  }

  /** Labor and fees the customer has agreed to: the accepted estimate plus approved extra work (parts are separate). */
  approvedLaborAndFees(job: Job) {
    const q = this.getQuote(job.quoteId);
    const base = q ? q.laborCents + q.diagnosticFeeCents + q.travelFeeCents : 0;
    const extras = [...(job.scopeChangeHistory ?? []), ...(job.scopeChange ? [job.scopeChange] : [])].filter((x) => x.status === "approved").reduce((n, x) => n + x.extraCents, 0);
    return base + extras;
  }

  /** Mechanic marks the work done. The customer then confirms; only that creates verified history. */
  markJobDone(
    jobId: ID,
    mechanicId: ID,
    finalAmountCents: number | undefined,
    notes?: string,
    confirm?: { engine?: string; transmission?: string; drivetrain?: string },
    payment?: { status: "paid" | "not_paid"; amountCents?: number },
  ) {
    const job = this.jobOf(jobId, { role: "mechanic", mechanicId });
    if (job.status === "awaiting_customer") return; // double click
    assertTransition("job", job.status, "awaiting_customer", job.status === "scheduled" ? "Check in and start the job before marking it complete." : undefined);
    if (job.scopeChange?.status === "pending") throw new LifecycleError("Wait for the customer's answer on the extra work before finishing.", "stale");
    if (finalAmountCents !== undefined && (!(finalAmountCents >= 0) || finalAmountCents > 10_000_000)) throw new LifecycleError("Enter the final amount in dollars.", "invalid_input");
    // The mechanic has seen the car: open configuration questions can be settled now.
    if (confirm && job.vehicleSpec && (confirm.engine || confirm.transmission || confirm.drivetrain)) {
      job.vehicleSpec = confirmSpec(job.vehicleSpec, confirm);
      const veh = this.getVehicle(job.vehicleId);
      if (veh) veh.spec = veh.spec ? confirmSpec(veh.spec, confirm) : job.vehicleSpec;
    }
    job.status = "awaiting_customer";
    job.mechanicCompletedAt = today();
    job.finalAmountCents = finalAmountCents;
    job.finalExceedsApproved = finalAmountCents !== undefined && finalAmountCents > this.approvedLaborAndFees(job);
    job.completionNotes = notes;
    if (payment) job.payment = { ...job.payment, mechanic: { ...payment, at: nowISO() } };
    this.log(job, "mechanic", "marked complete", finalAmountCents !== undefined ? `final ${finalAmountCents}` : undefined);
    this.checkPaymentMismatch(job);
    const m = this.getMechanic(job.mechanicId);
    this.notifyCustomer(job.customerId, "repair_completed", `${m?.displayName} marked your repair complete`, `/customer/jobs/${job.id}`, "Confirm the work is done to add it to their verified record.");
  }

  /** The customer says it isn't finished: back to the mechanic, with the reason. */
  reopenJob(jobId: ID, customerId: ID, note: string) {
    const job = this.jobOf(jobId, { role: "customer", customerId });
    if (job.status === "in_progress") return;
    assertTransition("job", job.status, "in_progress", job.status === "completed" ? "You already confirmed this repair." : undefined);
    if (!note.trim()) throw new LifecycleError("Say what isn't finished, so the mechanic knows what to do.", "invalid_input");
    job.status = "in_progress";
    job.mechanicCompletedAt = undefined;
    // The customer's words, shown to the mechanic on the job and kept in its history.
    this.log(job, "customer", "said it isn't finished", note.trim().slice(0, 300));
    this.notifyMechanic(job.mechanicId, "job_reminder", `${this.getCustomer(job.customerId)?.displayName?.split(" ")[0] ?? "The customer"} says the repair isn't finished`, `/mechanic/jobs/${job.id}`, note.trim().slice(0, 300), "job.reopened");
  }

  /** Either side, before work starts. After that, problems go through a report to Clutch staff. */
  cancelJob(jobId: ID, who: Actor, reason?: DeclineReason) {
    const job = this.jobOf(jobId, who);
    const by = who.role === "customer" ? "customer" : "mechanic";
    if (job.status === "cancelled") return;
    assertTransition(
      "job",
      job.status,
      "cancelled",
      job.status === "completed" ? "This repair is complete." : "Work has already started, so this booking can't be cancelled in Clutch. Talk to each other, or report a problem from the repair page.",
    );
    job.status = "cancelled";
    job.cancelledAt = today();
    job.cancelledBy = by;
    if (job.reschedule?.status === "pending") job.reschedule = { ...job.reschedule, status: "declined", respondedAt: nowISO() };
    this.log(job, by, "cancelled the booking", reason);
    const req = this.getRequest(job.requestId);
    if (by === "customer") {
      if (req) {
        assertTransition("request", req.status, "cancelled");
        req.status = "cancelled";
        req.cancelledAt = nowISO();
        this.log(req, "customer", "cancelled after booking");
      }
      const q = this.getQuote(job.quoteId);
      if (q?.status === "accepted") {
        q.status = "withdrawn";
        this.log(q, "customer", "booking cancelled");
      }
      this.notifyMechanic(job.mechanicId, "job_reminder", `A customer cancelled: ${job.title}`, `/mechanic/jobs/${job.id}`, undefined, "booking.cancelled");
      return;
    }
    // The mechanic backed out: the customer still needs the repair. Reopen the request, and
    // the estimates they passed over only because they booked this one (if still valid).
    if (!req) return;
    const q = this.getQuote(job.quoteId);
    if (q) {
      assertTransition("estimate", q.status, "withdrawn");
      q.status = "withdrawn";
      this.log(q, "mechanic", "withdrawn: mechanic cancelled the booking");
    }
    if (!req.declinedBy.includes(job.mechanicId)) req.declinedBy.push(job.mechanicId);
    req.declines = [...(req.declines ?? []), { mechanicId: job.mechanicId, reason, at: nowISO(), cancelledJob: true }];
    const reopened = this.listQuotesForRequest(req.id).filter(
      (x) =>
        x.status === "declined" &&
        x.closedReason === "chose_other" &&
        (!x.expiresOn || x.expiresOn >= today()) &&
        eligibility(toPublicProfile(this.getMechanicSources(x.mechanicId))).eligible,
    );
    for (const x of reopened) {
      assertTransition("estimate", x.status, "submitted");
      x.status = "submitted";
      x.closedReason = undefined;
      this.log(x, "system", "open again: the customer's booking fell through");
      this.notifyMechanic(x.mechanicId, "quote_updated", "An estimate you sent is open again", `/mechanic/requests/${req.id}`, "The customer's booking fell through. They may take you up on it.", "estimate.reopened");
    }
    const next = reopened.length ? "quoted" : "open";
    assertTransition("request", req.status, next);
    req.status = next;
    this.log(req, "mechanic", "booking cancelled by the mechanic; request open again");
    this.notifyCustomer(
      job.customerId,
      "mechanic_declined",
      `${this.getMechanic(job.mechanicId)?.displayName} cancelled your booking`,
      `/customer/requests/${req.id}`,
      reopened.length ? "Your other estimates are open again, and we've found more mechanics who could do it." : "We've found other mechanics with strong verified experience for it.",
      "booking.cancelled",
    );
  }

  /** Either side proposes a new time; it only replaces the booked time when the other side accepts. */
  proposeReschedule(jobId: ID, who: Actor, when: string, slot?: Slot, note?: string) {
    const job = this.jobOf(jobId, who);
    const by = who.role === "customer" ? "customer" : "mechanic";
    if (job.status !== "scheduled") throw new LifecycleError("Only a booking that hasn't started can be rescheduled.", "stale");
    const text = when.trim().slice(0, 120);
    if (!text) throw new LifecycleError("Suggest a new day and time.", "invalid_input");
    if (job.reschedule?.status === "pending" && job.reschedule.proposedBy !== by) throw new LifecycleError("The other side already suggested a new time. Accept or decline theirs first.", "stale");
    job.reschedule = { proposedBy: by, when: text, slot, note: note?.trim().slice(0, 300) || undefined, at: nowISO(), status: "pending" };
    this.log(job, by, "suggested a new time", text);
    if (by === "customer") this.notifyMechanic(job.mechanicId, "reschedule_proposed", `New time requested: ${text}`, `/mechanic/jobs/${job.id}`, note);
    else this.notifyCustomer(job.customerId, "reschedule_proposed", `${this.getMechanic(job.mechanicId)?.firstName} suggested a new time: ${text}`, `/customer/jobs/${job.id}`, note);
  }

  respondReschedule(jobId: ID, who: Actor, accept: boolean) {
    const job = this.jobOf(jobId, who);
    const by = who.role === "customer" ? "customer" : "mechanic";
    const rs = job.reschedule;
    if (rs && rs.status === (accept ? "accepted" : "declined") && rs.proposedBy !== by) return;
    if (!rs || rs.status !== "pending") throw new LifecycleError("There's no new time waiting for your answer.", "stale");
    if (rs.proposedBy === by) throw new LifecycleError("The other side needs to answer your suggestion.", "forbidden");
    if (job.status !== "scheduled") throw new LifecycleError("This booking has already started or ended.", "stale");
    rs.status = accept ? "accepted" : "declined";
    rs.respondedAt = nowISO();
    if (accept) {
      job.scheduledFor = rs.when;
      job.appointment = rs.slot ?? parseSlotText(rs.when, today()) ?? undefined;
      // Agreed by both sides, so the new time counts as confirmed.
      job.confirmedAt = nowISO();
    }
    this.log(job, by, accept ? "accepted the new time" : "kept the original time", accept ? rs.when : undefined);
    const title = accept ? `New time agreed: ${rs.when}` : "The new time was declined; the original booking stands";
    if (by === "customer") this.notifyMechanic(job.mechanicId, "reschedule_answered", title, `/mechanic/jobs/${job.id}`);
    else this.notifyCustomer(job.customerId, "reschedule_answered", title, `/customer/jobs/${job.id}`);
  }

  /** What each side says about payment. Recorded as self-reported; Clutch never handles the money. */
  reportPayment(jobId: ID, who: Actor, report: { status: "paid" | "not_paid"; amountCents?: number }) {
    const job = this.jobOf(jobId, who);
    const side = who.role === "customer" ? "customer" : "mechanic";
    if (job.status !== "awaiting_customer" && job.status !== "completed") throw new LifecycleError("Payment can be recorded once the work is marked complete.", "stale");
    if (report.amountCents !== undefined && (!(report.amountCents >= 0) || report.amountCents > 10_000_000)) throw new LifecycleError("Enter the amount in dollars.", "invalid_input");
    job.payment = { ...job.payment, [side]: { status: report.status, amountCents: report.amountCents, at: nowISO() } };
    this.log(job, side, report.status === "paid" ? "reported paid" : "reported not paid", report.amountCents !== undefined ? String(report.amountCents) : undefined);
    this.checkPaymentMismatch(job);
  }

  addJobPhotos(jobId: ID, photos: RepairPhoto[]) {
    const job = this.getJob(jobId);
    if (job) job.photos = [...(job.photos ?? []), ...photos];
  }

  addRepairPhotos(pastRepairId: ID, photos: RepairPhoto[]) {
    const r = this.db().pastRepairs.find((x) => x.id === pastRepairId);
    if (r) r.photos = [...(r.photos ?? []), ...photos];
  }

  markQuoteViewed(quoteId: ID) {
    const q = this.getQuote(quoteId);
    if (!q || q.viewedAt || q.status === "draft") return;
    q.viewedAt = nowISO();
    const r = this.getRequest(q.requestId);
    const v = r ? this.getVehicle(r.vehicleId) : undefined;
    this.notifyMechanic(q.mechanicId, "quote_viewed", `Your estimate for the ${v?.year} ${v?.make} ${v?.model} was viewed`, `/mechanic/quotes`);
  }

  declineQuote(quoteId: ID, customerId: ID) {
    const { q } = this.quoteOf(quoteId, { role: "customer", customerId });
    if (q.status === "declined" && q.closedReason === "customer_declined") return;
    assertTransition("estimate", q.status, "declined");
    q.status = "declined";
    q.closedReason = "customer_declined";
    this.log(q, "customer", "declined");
    this.notifyMechanic(q.mechanicId, "quote_updated", "A customer went with a different option", `/mechanic/quotes?tab=closed`, undefined, "estimate.declined");
  }

  findJobWithPhoto(mediaId: ID) {
    return this.db().jobs.find((j) => j.photos?.some((p) => p.id === mediaId));
  }

  findRepairWithPhoto(mediaId: ID) {
    return this.db().pastRepairs.find((r) => r.photos?.some((p) => p.id === mediaId));
  }

  createSupportReport(input: Omit<SupportReport, "id" | "createdAt" | "status" | "messages" | "history" | "updatedAt">) {
    if (input.userId) this.mustUser(input.userId);
    const details = input.details.trim().slice(0, 4000);
    if (!details) throw new LifecycleError("Describe what happened.", "invalid_input");
    const rep: SupportReport = { ...input, details, id: newId("sup"), createdAt: nowISO(), status: "open", messages: [], updatedAt: nowISO() };
    this.log(rep, input.reporterRole ?? "customer", "report filed");
    this.db().supportReports.push(rep);
    return rep;
  }

  getSupportReport(id: ID) {
    return this.db().supportReports.find((x) => x.id === id);
  }

  /** The reporter adds to their own case. A message on a resolved case reopens it. */
  addSupportMessage(reportId: ID, userId: ID, body: string) {
    const rep = this.getSupportReport(reportId);
    if (!rep || rep.userId !== userId) throw new LifecycleError("That report wasn't found.", "not_found");
    const text = body.trim().slice(0, 4000);
    if (!text) throw new LifecycleError("Write a message first.", "invalid_input");
    rep.messages = [...(rep.messages ?? []), { at: nowISO(), from: "reporter", body: text }];
    if (rep.status === "resolved") {
      rep.status = "open";
      this.log(rep, rep.reporterRole ?? "customer", "reopened with a new message");
    } else this.log(rep, rep.reporterRole ?? "customer", "added a message");
    rep.updatedAt = nowISO();
  }

  /** Staff work a case in the app: take it, reply, resolve, or reopen. Replies show only in Clutch. */
  updateSupportCase(reportId: ID, staffUserId: ID, change: { status?: SupportReport["status"]; reply?: string }) {
    this.staff(staffUserId);
    const rep = this.getSupportReport(reportId);
    if (!rep) throw new LifecycleError("That report wasn't found.", "not_found");
    const reply = change.reply?.trim().slice(0, 4000);
    if (!reply && (!change.status || change.status === rep.status)) return;
    if (reply) {
      rep.messages = [...(rep.messages ?? []), { at: nowISO(), from: "staff", body: reply }];
      this.log(rep, "staff", "replied");
    }
    if (change.status && change.status !== rep.status) {
      this.log(rep, "staff", change.status === "resolved" ? "resolved" : change.status === "in_review" ? (rep.status === "resolved" ? "reopened" : "reviewing") : "reopened");
      rep.status = change.status;
    }
    rep.updatedAt = nowISO();
    const mode = rep.reporterRole === "mechanic" ? "mechanic" : "customer";
    this.notify(rep.userId, mode, "support_update", reply ? "Clutch staff replied to your report" : `Your report is ${rep.status === "resolved" ? "resolved" : rep.status === "in_review" ? "being reviewed" : "open"}`, `/${mode}/help#report-${rep.id}`, reply?.slice(0, 160));
  }

  listSupportReports(filter?: { userId?: ID }) {
    return this.db()
      .supportReports.filter((r) => !filter?.userId || r.userId === filter.userId)
      .sort(newestFirst((r) => r.createdAt));
  }

  setJobNotes(jobId: ID, notes: string) {
    const job = this.getJob(jobId);
    if (job) job.mechanicNotes = notes;
  }

  /** The customer confirms the work is done. Only this creates the Platform Verified record, once. */
  completeJob(jobId: ID, customerId: ID, payment?: { status: "paid" | "not_paid"; amountCents?: number }) {
    const d = this.db();
    const job = this.jobOf(jobId, { role: "customer", customerId });
    if (job.status === "completed") return; // double click
    assertTransition("job", job.status, "completed", job.status === "scheduled" || job.status === "in_progress" ? "The mechanic hasn't marked this repair complete yet." : undefined);
    if (d.pastRepairs.some((x) => x.jobId === job.id)) throw new LifecycleError("This repair is already on the record.", "stale");
    job.status = "completed";
    job.completedAt = today();
    if (payment) job.payment = { ...job.payment, customer: { ...payment, at: nowISO() } };
    this.log(job, "customer", "confirmed the work is done");
    this.checkPaymentMismatch(job);
    this.notifyCustomer(job.customerId, "review_requested", `How did ${this.getMechanic(job.mechanicId)?.firstName} do?`, `/customer/jobs/${job.id}`, "Leave a verified review.");
    this.notifyMechanic(job.mechanicId, "quote_accepted", `Customer confirmed: ${job.title}`, `/mechanic/jobs/${job.id}`, "Added to your verified record.", "job.confirmed");
    const quote = this.getQuote(job.quoteId);
    const v = this.getVehicle(job.vehicleId)!;
    const repair: PastRepair = {
      id: newId("rep"),
      mechanicId: job.mechanicId,
      source: "platform",
      jobId: job.id,
      year: v.year,
      make: v.make,
      model: v.model,
      repairCategory: job.repairCategory,
      title: job.title,
      performedOn: today(),
      customerId: job.customerId,
      evidence: [{ kind: "invoice", name: "clutch-estimate.pdf" }],
      valueCents: job.finalAmountCents ?? (quote ? quote.laborCents + quote.diagnosticFeeCents + quote.travelFeeCents : undefined),
      photos: (job.photos ?? []).map((p) => ({ ...p, source: "job" as const })),
      mileage: v.mileage,
      spec: toRecorded(job.vehicleSpec),
    };
    d.pastRepairs.push(repair);
    d.verifications.push({
      id: newId("ver"),
      mechanicId: job.mechanicId,
      subjectType: "past_repair",
      subjectId: repair.id,
      category: "past_repair",
      method: "platform_job",
      status: "verified",
      submittedAt: today(),
      verifiedAt: today(),
      notes: "Completed through Clutch.",
      evidenceSummary: `${v.year} ${v.make} ${v.model} — ${job.title}`,
    });
    const req = this.getRequest(job.requestId);
    if (req) {
      assertTransition("request", req.status, "completed");
      req.status = "completed";
      this.log(req, "customer", "repair completed");
    }
  }

  // ------------------------------------------------------------- admin writes
  /**
   * A staff decision: approve, reject, request more information, or revoke. Least privilege: staff
   * only, never on their own records, never on what a provider decides, always with a reason code
   * (and a note for anything but approval). Every action is appended to the record's history.
   */
  decideVerification(id: ID, action: ReviewAction, reviewerId: ID, input: { reasonCode: string; note?: string; expiresAt?: string }) {
    const v = this.getVerification(id);
    const reviewer = this.mustUser(reviewerId);
    if (!reviewer.roles.includes("admin")) throw new LifecycleError("Only Clutch staff can decide verifications.", "forbidden");
    if (!v) throw new LifecycleError("That verification wasn't found.", "not_found");
    const m = this.mustMechanic(v.mechanicId);
    if (m.userId === reviewerId) throw new LifecycleError("You can't review your own verification.", "forbidden");
    const r = reason(input.reasonCode);
    if (!r || !r.for.includes(action)) throw new LifecycleError("Choose a reason for this decision.", "invalid_input");
    const note = input.note?.trim() ?? "";
    if (action !== "approve" && !note) throw new LifecycleError("Add a note the mechanic will see.", "invalid_input");
    if (input.reasonCode === "other" && !note) throw new LifecycleError("Explain the reason in the note.", "invalid_input");
    const actor: VActor = { kind: "staff", id: reviewerId };
    const eff = effectiveStatus(v.status, v.expiresAt, new Date(), v.method);
    if (action === "revoke") {
      if (!isPubliclyValid(eff) && eff !== "expired") throw new LifecycleError("Only a verified check can be revoked.", "stale");
      if (v.status === "expired") throw new LifecycleError("This check has already expired.", "stale");
      this.move(v, "revoked", { actor, action: "revoked", reasonCodes: [input.reasonCode], note });
      v.reviewerId = reviewerId;
      if (v.subjectType === "past_repair") {
        const rep = this.db().pastRepairs.find((x) => x.id === v.subjectId);
        if (rep && (rep.source === "document" || rep.source === "customer_confirmed")) rep.source = "self";
      }
      return;
    }
    // Providers decide identity and screening; staff can't approve or reject them by hand.
    if (v.method === "hosted_identity" || v.method === "vendor_screening") throw new LifecycleError("A provider decides this check; staff can only revoke it.", "forbidden");
    if (action === "approve" && this.unrunScreening(v)) throw new Error("This check was never run by a screening provider, so it can't be approved.");
    // A document review needs a stored document: a file name alone proves nothing.
    const needsDoc = v.category === "insurance" || (v.method === "document_review" && (v.category === "credential" || v.category === "past_repair"));
    if (action === "approve" && needsDoc && !v.documentIds?.length) throw new LifecycleError("There's no stored document to approve. Request more information instead.", "invalid_input");
    const to: VerificationStatus = action === "approve" ? "verified" : action === "reject" ? "failed" : "needs_more_info";
    // Staff take a submitted item into review first, so the history shows who looked.
    if (v.status === "submitted" && to !== "needs_more_info") transition(v, "under_review", { actor, action: "review_started" });
    const expiresAt = input.expiresAt || (v.category === "insurance" ? this.db().insurance.find((x) => x.id === v.subjectId)?.expiresOn : v.expiresAt);
    this.move(v, to, { actor, action: action === "approve" ? "approved" : action === "reject" ? "rejected" : "requested_info", reasonCodes: [input.reasonCode], note, expiresAt });
    v.reviewerId = reviewerId;
    if (to === "verified") {
      if (v.supersedes) {
        const old = this.getVerification(v.supersedes);
        if (old && !old.supersededBy) {
          old.supersededBy = v.id;
          old.events = [...(old.events ?? []), { at: nowISO(), actor, action: "superseded", from: old.status, to: old.status, note: `Replaced by ${v.id}.` }];
        }
      }
      if (v.subjectType === "screening_check") {
        const sc = this.db().screenings.find((x) => x.id === v.subjectId);
        if (sc) Object.assign(sc, { status: "verified", completedAt: today(), expiresAt: expiresAt ?? sc.expiresAt });
      }
      if (v.subjectType === "past_repair") {
        const rep = this.db().pastRepairs.find((x) => x.id === v.subjectId);
        // Staff review of an invoice makes a prior repair Document verified; only a
        // customer's own confirmation makes it Customer verified.
        if (rep && rep.source === "self") rep.source = v.method === "customer_confirmation" ? "customer_confirmed" : "document";
      }
      this.matchWaiting();
    }
  }

  /**
   * Renewal reminders (30 and 7 days before expiry) and expiry itself, each recorded once per
   * record and expiry date (idempotent), so a daily run or every page load is safe.
   */
  remindRenewals(nowIso: string, mechanicId?: ID) {
    const now = new Date(nowIso);
    let changed = 0;
    for (const v of this.db().verifications) {
      if ((mechanicId && v.mechanicId !== mechanicId) || v.status !== "verified" || v.supersededBy || !v.expiresAt) continue;
      const eff = effectiveStatus(v.status, v.expiresAt, now, v.method);
      const days = Math.ceil((new Date(v.expiresAt).getTime() - now.getTime()) / 86_400_000);
      const name = CATEGORY_LABEL[v.category];
      if (eff === "expired") {
        if (this.move(v, "expired", { actor: { kind: "system", id: "expiry" }, action: "expired", idempotencyKey: `expired:${v.expiresAt}`, note: `${name} expired on ${v.expiresAt}.` })) changed++;
        continue;
      }
      for (const window of [30, 7]) {
        if (days <= window && days > (window === 30 ? 7 : 0)) {
          if (transition(v, "verified", { actor: { kind: "system", id: "renewals" }, action: "reminded", idempotencyKey: `remind-${window}:${v.expiresAt}` })) {
            changed++;
            this.notifyMechanic(v.mechanicId, "verification_update", `${name}: renew by ${v.expiresAt}`, "/mechanic/verification", `Your ${name.toLowerCase()} verification expires in ${days} ${days === 1 ? "day" : "days"}. Renew it to keep it on your profile.`);
          }
        }
      }
    }
    return changed;
  }

  // ---------------------------------------------------------- customer writes
  createRequest(input: Parameters<RepositoryCore["createRequest"]>[0]) {
    const d = this.db();
    const { vehicle, directTo, ...rest } = input;
    // A retried or double-clicked submit of the same draft returns the request it already created.
    const dup = rest.idempotencyKey ? d.requests.find((x) => x.customerId === rest.customerId && x.idempotencyKey === rest.idempotencyKey) : undefined;
    if (dup) return dup;
    // Everything a request links to must be in this marketplace: its customer, their car,
    // and any mechanic it's sent to directly.
    this.mustCustomer(rest.customerId);
    if (directTo) this.mustMechanic(directTo);
    if (rest.rebookOf) this.mustMechanic(rest.rebookOf);
    if (!vehicle) {
      const owned = this.getVehicle(rest.vehicleId);
      if (!owned || owned.customerId !== rest.customerId) throw new ScopeError("vehicle", rest.vehicleId, this.scope);
    }
    let vehicleId = rest.vehicleId;
    if (vehicle) {
      vehicleId = newId("veh");
      d.vehicles.push({ ...vehicle, id: vehicleId, customerId: rest.customerId });
    }
    const v = d.vehicles.find((x) => x.id === vehicleId)!;
    let matched: ID[];
    if (directTo) matched = [directTo];
    else if (rest.rebookOf) matched = [rest.rebookOf];
    else matched = this.matchingMechanics(rest.repairCategory, v.make, rest.location.area).slice(0, MATCH_LIMIT);
    const req: RepairRequest = {
      ...rest,
      vehicleId,
      vehicleSpec: rest.vehicleSpec ?? v.spec,
      id: newId("req"),
      status: "open",
      createdAt: today(),
      matchedMechanicIds: matched,
      requestedMechanicId: directTo ?? rest.rebookOf,
      declinedBy: [],
      questions: [],
      interested: [],
      // No mechanic fits yet: kept open and sent on when one does (matchWaiting).
      ...(matched.length ? {} : { waitingSince: nowISO() }),
      history: [{ at: nowISO(), by: "customer", action: matched.length ? "sent" : "saved (no mechanic fits yet)", detail: matched.length ? String(matched.length) : undefined }],
    };
    d.requests.push(req);
    for (const mid of matched) {
      this.notifyMechanic(
        mid,
        rest.rebookOf ? "customer_rebooked" : "new_opportunity",
        rest.rebookOf ? `${this.getCustomer(rest.customerId)?.displayName} wants to book you again` : `New job near you: ${v.year} ${v.make} ${v.model}`,
        `/mechanic/requests/${req.id}`,
      );
    }
    return req;
  }

  /**
   * Matching = bookable under the shared rules (basic profile complete, lib/domain/eligibility.ts;
   * verification is disclosed, not required), serves the area, and has verified experience with
   * this repair or make (or declares the repair type). Ordered by relevant verified experience,
   * then full verification; price is never an input.
   */
  private matchingMechanics(category: RepairRequest["repairCategory"], make: Vehicle["make"], areaKey?: string): ID[] {
    const d = this.db();
    const area = findArea(areaKey);
    return d.mechanics
      .filter((m) => !area || serves(m, area))
      .map((m) => ({ m, e: eligibility(toPublicProfile(this.getMechanicSources(m.id))) }))
      .filter(({ e }) => e.eligible)
      // Relevant verified experience first; among equals, a fully verified mechanic goes first. Nobody is excluded for it.
      .map(({ m, e }) => {
        const k = this.relevance(m.id, category, make);
        return { m, key: [k[0], k[1], k[2], e.fullyVerified ? 1 : 0, k[3]] };
      })
      .filter(({ m, key }) => key[1] > 0 || key[2] > 0 || m.declaredRepairCategories.includes(category))
      .sort((a, b) => {
        for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return b.key[i] - a.key[i];
        return 0;
      })
      .map(({ m }) => m.id);
  }

  /** [exact repair+make, repair type, make, total] verified repairs: from counts the store read, or from the repairs held. */
  private relevance(mechanicId: ID, category: RepairRequest["repairCategory"], make: Vehicle["make"]): number[] {
    const c = countsFor(this.db(), mechanicId);
    if (!c) return relevanceKey(this.db().pastRepairs.filter((r) => r.mechanicId === mechanicId), category, make);
    let cat = 0;
    let mk = 0;
    for (const [k, n] of c.pairs) {
      const [pc, pm] = k.split("|");
      if (pc === category) cat += n;
      if (pm === make) mk += n;
    }
    return [c.pairs.get(`${category}|${make}`) ?? 0, cat, mk, c.total];
  }

  updateRequest(requestId: ID, edit: RequestEdit) {
    const r = this.mustRequest(requestId);
    if (r.status !== "open") throw new Error("This request can't be changed any more.");
    if (this.listQuotesForRequest(r.id).some((q) => q.status !== "draft") || r.interested.length || r.questions.length) {
      throw new Error("A mechanic has already responded to this request, so it can't be changed. Cancel it and send a new one instead.");
    }
    const text = edit.symptomDescription.trim();
    if (text.length < 10) throw new Error("Describe what the car is doing in a sentence or two.");
    Object.assign(r, {
      symptomDescription: text.slice(0, 2000),
      repairCategory: edit.repairCategory,
      categorySource: "customer",
      location: { ...r.location, area: findArea(edit.area)?.key, serviceMode: edit.serviceMode },
      urgency: edit.urgency,
      preferredTimes: edit.preferredTimes?.trim().slice(0, 200) || undefined,
      updatedAt: nowISO(),
    });
    this.log(r, "customer", "edited");
    // Mechanics it already went to see the change; a request still waiting is matched again.
    if (!r.matchedMechanicIds.length) this.rematchRequest(r.id);
    else for (const mid of r.matchedMechanicIds.filter((m) => !r.declinedBy.includes(m))) this.notifyMechanic(mid, "new_opportunity", "A customer updated their request", `/mechanic/requests/${r.id}`, undefined, "none");
    return r;
  }

  cancelRequest(requestId: ID) {
    const r = this.mustRequest(requestId);
    if (r.status === "cancelled") return;
    if (r.status === "booked" || r.status === "completed") throw new Error("This repair is booked. Cancel the booking from the repair page instead.");
    assertTransition("request", r.status, "cancelled");
    r.status = "cancelled";
    r.cancelledAt = nowISO();
    r.waitingSince = undefined;
    this.log(r, "customer", "cancelled");
    for (const q of this.listQuotesForRequest(r.id)) {
      if (q.status !== "submitted" && q.status !== "draft") continue;
      Object.assign(q, { status: "declined", closedReason: "request_cancelled" });
      this.log(q, "system", "closed: the customer cancelled the request");
    }
    const v = this.getVehicle(r.vehicleId);
    for (const mid of r.matchedMechanicIds.filter((m) => !r.declinedBy.includes(m))) {
      this.notifyMechanic(mid, "new_opportunity", `Request withdrawn: ${v?.year ?? ""} ${v?.make ?? ""} ${v?.model ?? ""}`.replace(/\s+/g, " ").trim(), `/mechanic/requests`, undefined, "request.withdrawn");
    }
  }

  rematchRequest(requestId: ID) {
    const r = this.mustRequest(requestId);
    // Only requests that never reached anyone (including ones saved before `waitingSince` existed).
    if (r.status !== "open" || r.matchedMechanicIds.length) return 0;
    const v = this.getVehicle(r.vehicleId);
    if (!v) return 0;
    const found = this.matchingMechanics(r.repairCategory, v.make, r.location.area)
      .filter((mid) => !r.declinedBy.includes(mid))
      .slice(0, MATCH_LIMIT);
    if (!found.length) return 0;
    r.matchedMechanicIds.push(...found);
    r.waitingSince = undefined;
    this.log(r, "system", "sent to newly available mechanics", String(found.length));
    for (const mid of found) this.notifyMechanic(mid, "new_opportunity", `New job near you: ${v.year} ${v.make} ${v.model}`, `/mechanic/requests/${r.id}`);
    this.notifyCustomer(
      r.customerId,
      "mechanic_interested",
      `Your ${v.make} request was sent to ${found.length === 1 ? "a mechanic" : `${found.length} mechanics`}`,
      `/customer/requests/${r.id}`,
      "They matched your car, repair and area after joining Clutch. Each profile shows which checks Clutch has verified.",
      "none",
    );
    return found.length;
  }

  /** A screening verification started with the stand-in provider for a real mechanic: nothing was actually checked. */
  unrunScreening(v: VerificationRecord) {
    if (v.subjectType !== "screening_check" || this.scope === "demo") return false;
    const sc = this.db().screenings.find((s) => s.id === v.subjectId);
    return !sc || sc.provider === "mock";
  }

  /**
   * Local browser testing only (/api/test-login?bookable=1): screening and insurance recorded as a
   * connected provider and staff would, for a fictional example.test mechanic. Refused otherwise.
   */
  addTestScreening(mechanicId: ID) {
    if (process.env.CLUTCH_TEST_LOGINS !== "on" || process.env.NODE_ENV === "production") throw new LifecycleError("Not available.", "forbidden");
    const m = this.mustMechanic(mechanicId);
    if (!this.getUser(m.userId)?.email.endsWith("@example.test")) throw new LifecycleError("Only for test accounts.", "forbidden");
    const d = this.db();
    const actor: VActor = { kind: "provider", id: "provider-under-test" };
    for (const kind of ["identity", "background", "driving_record"] as const) {
      const sc = { id: newId("scr"), mechanicId, kind, provider: "provider-under-test", providerRef: newId("ref"), status: "verified" as const, result: "clear" as const, completedAt: today(), expiresAt: "2027-12-31" };
      d.screenings.push(sc);
      const v = this.newCheck({ mechanicId, accountId: m.userId, subjectType: "screening_check", subjectId: sc.id, category: kind, method: kind === "identity" ? "hosted_identity" : "vendor_screening", provider: "provider-under-test", providerRef: sc.providerRef }, "in_progress", actor, "started");
      transition(v, "verified", { actor, action: "provider_update", reasonCodes: ["provider_verified"], expiresAt: "2027-12-31" });
    }
    const ins = { id: newId("ins"), mechanicId, carrier: "Test fixture", policyLast4: "0000", coverageCents: 100_000_000, documentName: "coi.pdf", effectiveOn: today(), expiresOn: "2027-12-31" };
    d.insurance.push(ins);
    const v = this.newCheck({ mechanicId, accountId: m.userId, subjectType: "insurance_record", subjectId: ins.id, category: "insurance", method: "document_review", provider: "provider-under-test", documentIds: ["test-fixture"] }, "submitted", { kind: "mechanic", id: m.userId });
    transition(v, "verified", { actor: { kind: "system", id: "test-fixture" }, action: "approved", reasonCodes: ["evidence_matches"], note: "Test fixture.", expiresAt: "2027-12-31" });
    this.matchWaiting();
  }

  /** After anything that can make a mechanic bookable: send waiting requests on to anyone who now fits. */
  private matchWaiting() {
    for (const r of this.db().requests) if (r.status === "open" && !r.matchedMechanicIds.length) this.rematchRequest(r.id);
  }

  respondToQuestion(requestId: ID, questionIndex: number, response: string, attachments: RepairMedia[]) {
    const q = this.getRequest(requestId)?.questions[questionIndex];
    if (!q || (!response.trim() && !attachments.length)) return;
    q.response = response.trim() || undefined;
    q.respondedAt = today();
    q.attachments = [...q.attachments, ...attachments];
    this.notifyMechanic(q.mechanicId, "customer_answered", `${this.getCustomer(q.customerId)?.displayName} answered your question`, `/mechanic/requests/${requestId}`, response || undefined);
  }

  getDraft(customerId: ID) {
    return this.db().drafts[customerId];
  }
  saveDraft(customerId: ID, draft: IntakeDraft) {
    this.db().drafts[customerId] = draft;
  }
  clearDraft(customerId: ID) {
    delete this.db().drafts[customerId];
  }

  /**
   * The customer books one estimate. Atomic: inside one transaction it checks the estimate is
   * still open and unchanged since they read it (`expectedVersion`), closes every competing
   * estimate, and creates exactly one job. Accepting the same estimate again returns that job.
   */
  acceptQuote(quoteId: ID, customerId: ID, expectedVersion?: number, ack?: BookingAcknowledgement): Job {
    const d = this.db();
    const { q, r: req } = this.quoteOf(quoteId, { role: "customer", customerId });
    this.mustMechanic(q.mechanicId);
    const existing = d.jobs.find((j) => j.requestId === req.id && j.status !== "cancelled");
    if (existing && existing.quoteId === q.id) return existing; // double click, retry, second tab
    if (existing) throw new LifecycleError(`You already booked ${this.getMechanic(existing.mechanicId)?.firstName ?? "a mechanic"} for this request.`, "stale");
    if (req.status === "cancelled" || req.status === "completed") throw new LifecycleError(`This request is ${req.status}.`, "stale");
    if (q.status !== "submitted") {
      throw new LifecycleError(
        q.status === "withdrawn"
          ? `${this.getMechanic(q.mechanicId)?.firstName ?? "The mechanic"} withdrew this estimate.`
          : q.status === "expired"
            ? "This estimate has expired."
            : q.status === "declined"
              ? "This estimate is closed."
              : "This estimate can't be accepted.",
        "stale",
      );
    }
    if (req.declinedBy.includes(q.mechanicId)) throw new LifecycleError(`${this.getMechanic(q.mechanicId)?.firstName ?? "The mechanic"} can't take this job any more.`, "stale");
    if (expectedVersion !== undefined && expectedVersion !== (q.version ?? 1)) {
      throw new LifecycleError("The mechanic revised this estimate since you opened it. Review the new version before accepting.", "stale");
    }
    if (q.expiresOn && q.expiresOn < today()) throw new LifecycleError("This estimate has expired. Ask the mechanic for a new one.", "stale");
    // Bookable = the basic profile is complete. Verification is disclosed, not required: if any check
    // isn't verified, the customer must have acknowledged exactly the statuses as they are now.
    const profile = toPublicProfile(this.getMechanicSources(q.mechanicId));
    const elig = eligibility(profile);
    if (!elig.eligible) throw new LifecycleError("This mechanic can't be booked right now: their profile isn't complete.", "forbidden");
    const checks = checksNow(profile);
    if (!elig.fullyVerified) {
      if (!ack) throw new LifecycleError("Clutch hasn't verified every check for this mechanic. Review which ones and confirm before booking.", "invalid_input");
      if (ack.version !== DISCLOSURE_VERSION || ack.snapshot !== snapshotKey(checks)) {
        throw new LifecycleError("This mechanic's verification changed since you reviewed it. Review it again before booking.", "stale");
      }
    }
    assertTransition("estimate", q.status, "accepted");
    assertTransition("request", req.status, "booked");
    for (const other of d.quotes.filter((x) => x.requestId === q.requestId && x.status !== "draft")) {
      if (other.id === q.id) {
        other.status = "accepted";
        other.acceptedAt = nowISO();
        other.acceptedVersion = other.version ?? 1;
        other.acceptedTotalCents = quoteTotals(other).total;
        this.log(other, "customer", `accepted version ${other.acceptedVersion}`, `total ${other.acceptedTotalCents}`);
      } else if (other.status === "submitted") {
        Object.assign(other, { status: "declined", closedReason: "chose_other" });
        this.log(other, "system", "closed: the customer booked another mechanic");
      }
    }
    req.status = "booked";
    this.log(req, "customer", "booked");
    // Job title from the mechanic's own scope: first clause, cut at a word boundary.
    const clause = q.scope.split(/[.;]/)[0].trim();
    const title = clause.length <= 60 ? clause : `${clause.slice(0, 57).replace(/\s+\S*$/, "")}…` || `${REPAIR_LABEL[req.repairCategory]} work`;
    const job: Job = {
      id: newId("job"),
      quoteId: q.id,
      requestId: req.id,
      mechanicId: q.mechanicId,
      customerId: req.customerId,
      vehicleId: req.vehicleId,
      repairCategory: req.repairCategory,
      title,
      status: "scheduled",
      scheduledFor: q.availableOn,
      appointment: q.availableAt ?? parseSlotText(q.availableOn, today()) ?? undefined,
      vehicleSpec: req.vehicleSpec ?? this.getVehicle(req.vehicleId)?.spec,
      history: [{ at: nowISO(), by: "customer", action: "booked from the accepted estimate", detail: `version ${q.acceptedVersion ?? 1}` }],
      verificationAtBooking: {
        checks,
        fullyVerified: elig.fullyVerified,
        capturedAt: nowISO(),
        ...(elig.fullyVerified
          ? {}
          : {
              acknowledgement: {
                version: DISCLOSURE_VERSION,
                text: ACK_TEXT,
                disclosure: disclosureText(profile.firstName, checks),
                customerId,
                userId: this.getCustomer(customerId)?.userId,
                at: nowISO(),
              },
            }),
      },
    };
    if (!elig.fullyVerified) {
      this.log(job, "customer", "acknowledged unverified checks", `${DISCLOSURE_VERSION}: ${checks.filter((c) => !c.verified).map((c) => `${c.name} ${c.status.toLowerCase()}`).join(", ")}`);
    }
    d.jobs.push(job);
    const v = this.getVehicle(req.vehicleId);
    this.notifyMechanic(q.mechanicId, "quote_accepted", `Estimate approved: ${v?.year} ${v?.make} ${v?.model}`, `/mechanic/jobs/${job.id}`, `Booked for ${q.availableOn}.`);
    this.notifyCustomer(req.customerId, "job_scheduled", `Booked with ${this.getMechanic(q.mechanicId)?.displayName}`, `/customer/jobs/${job.id}`, q.availableOn);
    return job;
  }

  /** One verified review per completed job, only from that job's customer. Submitting twice returns the first. */
  submitReview(jobId: ID, customerId: ID, input: Parameters<RepositoryCore["submitReview"]>[2]) {
    const d = this.db();
    const job = this.jobOf(jobId, { role: "customer", customerId });
    if (job.status !== "completed") throw new LifecycleError("You can review a repair once you've confirmed it's done.", "stale");
    const existing = this.getReviewForJob(jobId);
    if (existing) return existing;
    const clean = reviewInput(input);
    const v = this.getVehicle(job.vehicleId)!;
    const c = this.getCustomer(job.customerId)!;
    const repair = d.pastRepairs.find((r) => r.jobId === jobId);
    const [first, last] = c.displayName.split(" ");
    const review: Review = {
      ...clean,
      id: newId("rev"),
      mechanicId: job.mechanicId,
      kind: "verified_job",
      jobId,
      pastRepairId: repair?.id,
      authorName: last ? `${first} ${last[0]}.` : first,
      vehicleLabel: `${v.year} ${v.make} ${v.model}`,
      repairLabel: job.title,
      createdAt: today(),
    };
    d.reviews.push(review);
    this.log(job, "customer", "posted a review", `${clean.overall}/5`);
    this.notifyMechanic(job.mechanicId, "new_review", `New verified review: ${clean.overall} stars from ${first}`, `/mechanic/reputation`);
    return review;
  }

  /** The same customer can change their review. Earlier versions are kept; it still counts once. */
  updateReview(jobId: ID, customerId: ID, input: Parameters<RepositoryCore["submitReview"]>[2]) {
    this.jobOf(jobId, { role: "customer", customerId });
    const review = this.getReviewForJob(jobId);
    if (!review) throw new LifecycleError("There's no review to change yet.", "stale");
    const clean = reviewInput(input);
    review.edits = [...(review.edits ?? []), { at: review.updatedAt ?? review.createdAt, overall: review.overall, comment: review.comment }];
    Object.assign(review, clean, { updatedAt: nowISO() });
    this.log(this.getJob(jobId)!, "customer", "edited their review", `${clean.overall}/5`);
    return review;
  }

  toggleSaved(customerId: ID, mechanicId: ID) {
    const d = this.db();
    this.mustCustomer(customerId);
    this.mustMechanic(mechanicId);
    const i = d.saved.findIndex((s) => s.customerId === customerId && s.mechanicId === mechanicId);
    if (i >= 0) {
      d.saved.splice(i, 1);
      return false;
    }
    d.saved.push({ customerId, mechanicId, savedAt: today() });
    return true;
  }

  // ------------------------------------------------------------- accounts
  getUserByEmail(email: string) {
    return this.db().users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
  }

  createUser(input: { id?: ID; name: string; email: string; phone?: string; role: "customer" | "mechanic"; avatarUrl?: string }) {
    const d = this.db();
    // Idempotent: a retried sign-up (double click, network retry, a transaction replay)
    // returns the same account instead of creating a second one.
    const same = input.id ? this.getUser(input.id) : undefined;
    if (same) {
      if (input.role === "customer") this.addCustomerProfile(same.id);
      else if (!same.roles.includes("mechanic")) same.roles.push("mechanic");
      return same;
    }
    const user: User = {
      id: input.id ?? newId("user"),
      avatarUrl: input.avatarUrl,
      roles: [input.role] as User["roles"],
      name: input.name,
      email: input.email,
      phone: input.phone,
      notificationPrefs: { email: true, sms: Boolean(input.phone), push: true },
      createdAt: today(),
    };
    d.users.push(user);
    if (input.role === "customer") this.addCustomerProfile(user.id);
    return user;
  }

  addCustomerProfile(userId: ID) {
    const d = this.db();
    const u = this.mustUser(userId);
    const existing = d.customers.find((c) => c.userId === userId);
    if (existing) return existing;
    if (!u.roles.includes("customer")) u.roles.push("customer");
    const c = { id: newId("cust"), userId, displayName: u.name, city: "Los Angeles" };
    d.customers.push(c);
    return c;
  }

  grantAdmin(userId: ID) {
    const u = this.getUser(userId);
    if (u && !u.roles.includes("admin")) u.roles.push("admin");
  }

  updateUser(userId: ID, patch: Partial<Pick<User, "name" | "email" | "phone" | "notificationPrefs" | "avatarUrl" | "emailVerifiedAt">>) {
    const u = this.getUser(userId);
    if (u) Object.assign(u, patch);
  }

  getCustomerByUser(userId: ID) {
    return this.db().customers.find((c) => c.userId === userId);
  }

  getMechanicByUser(userId: ID) {
    return this.db().mechanics.find((m) => m.userId === userId);
  }

  // -------------------------------------------------------- notifications
  /** In-app notification (the source of truth). `event` picks the optional alert (lib/notify/events.ts); default from `kind`. */
  notify(userId: ID, mode: AppMode, kind: NotificationKind, title: string, href: string, body?: string, event?: DeliveryEventType | "none") {
    this.mustUser(userId);
    this.db().notifications.push({ id: newId("ntf"), userId, mode, kind, title, body, href, createdAt: nowISO(), read: false, ...(event ? { event } : {}) });
  }
  private notifyCustomer(customerId: ID, kind: NotificationKind, title: string, href: string, body?: string, event?: DeliveryEventType | "none") {
    const c = this.getCustomer(customerId);
    if (c) this.notify(c.userId, "customer", kind, title, href, body, event);
  }
  private notifyMechanic(mechanicId: ID, kind: NotificationKind, title: string, href: string, body?: string, event?: DeliveryEventType | "none") {
    const m = this.getMechanic(mechanicId);
    if (m) this.notify(m.userId, "mechanic", kind, title, href, body, event);
  }

  /** Both sides recorded payment and it doesn't match: tell both, once. Clutch doesn't handle the money. */
  private checkPaymentMismatch(job: Job) {
    const c = job.payment?.customer;
    const m = job.payment?.mechanic;
    if (!c || !m || job.paymentMismatchNotifiedAt) return;
    const differs = c.status !== m.status || (c.amountCents !== undefined && m.amountCents !== undefined && c.amountCents !== m.amountCents);
    if (!differs) return;
    job.paymentMismatchNotifiedAt = nowISO();
    this.log(job, "system", "payment notes don't match");
    this.notifyCustomer(job.customerId, "payment_mismatch", "Payment notes don't match", `/customer/jobs/${job.id}#payment`);
    this.notifyMechanic(job.mechanicId, "payment_mismatch", "Payment notes don't match", `/mechanic/jobs/${job.id}#payment`);
  }
  listNotifications(userId: ID, mode: AppMode) {
    return this.db()
      .notifications.filter((n) => n.userId === userId && n.mode === mode)
      .sort(newestFirst((n) => n.createdAt));
  }
  markNotificationsRead(userId: ID, mode: AppMode) {
    for (const n of this.db().notifications) if (n.userId === userId && n.mode === mode) n.read = true;
  }

  findRequestWithMedia(mediaId: ID) {
    return this.db().requests.find((r) => r.media.some((m) => m.id === mediaId) || r.questions.some((q) => q.attachments.some((a) => a.id === mediaId)));
  }

  // ---------------------------------------------------- quote questions
  listQuotesForCustomer(customerId: ID) {
    const reqIds = new Set(this.listRequestsForCustomer(customerId).map((r) => r.id));
    return this.db().quotes.filter((q) => reqIds.has(q.requestId) && q.status !== "draft");
  }
  askAboutQuote(quoteId: ID, customerId: ID, question: string) {
    const { q } = this.quoteOf(quoteId, { role: "customer", customerId });
    if (!question.trim()) return;
    if (q.status !== "submitted" && q.status !== "accepted") throw new LifecycleError("This estimate is closed.", "stale");
    q.customerQuestions.push({ question: question.trim(), askedAt: today() });
    const r = this.getRequest(q.requestId);
    this.notifyMechanic(q.mechanicId, "customer_question", `${r ? this.getCustomer(r.customerId)?.displayName : "A customer"} asked about your estimate`, `/mechanic/quotes`, question.trim());
  }
  answerQuoteQuestion(quoteId: ID, mechanicId: ID, index: number, answer: string) {
    const { q } = this.quoteOf(quoteId, { role: "mechanic", mechanicId });
    const item = q.customerQuestions[index];
    if (!item || !answer.trim()) return;
    item.answer = answer.trim();
    item.answeredAt = today();
    const r = this.getRequest(q.requestId);
    if (r) this.notifyCustomer(r.customerId, "quote_updated", `${this.getMechanic(q.mechanicId)?.displayName} answered your question`, `/customer/quotes`, answer.trim(), "question.answered");
  }

  // ------------------------------------------------------------- vehicles
  addVehicle(customerId: ID, v: Omit<Vehicle, "id" | "customerId">) {
    this.mustCustomer(customerId);
    const veh = { ...v, id: newId("veh"), customerId };
    this.db().vehicles.push(veh);
    return veh;
  }
  updateVehicle(vehicleId: ID, patch: Partial<Omit<Vehicle, "id" | "customerId">>) {
    const v = this.getVehicle(vehicleId);
    if (v) Object.assign(v, patch);
  }
  /** Maintenance record: every Clutch repair on this vehicle, newest first. */
  listVehicleHistory(vehicleId: ID) {
    const d = this.db();
    const jobIds = new Set(d.jobs.filter((j) => j.vehicleId === vehicleId).map((j) => j.id));
    const v = this.getVehicle(vehicleId);
    return d.pastRepairs
      .filter((r) => r.source === "platform" && ((r.jobId && jobIds.has(r.jobId)) || (v && r.customerId === v.customerId && r.make === v.make && r.model === v.model && r.year === v.year)))
      .sort((a, b) => (a.performedOn < b.performedOn ? 1 : -1));
  }

  // ------------------------------------------------ mechanic's customer notes
  getCustomerNote(mechanicId: ID, customerId: ID) {
    return this.db().customerNotes[mechanicId]?.[customerId] ?? "";
  }
  setCustomerNote(mechanicId: ID, customerId: ID, note: string) {
    const d = this.db();
    this.mustMechanic(mechanicId);
    this.mustCustomer(customerId);
    (d.customerNotes[mechanicId] ??= {})[customerId] = note;
  }

  track(name: AnalyticsEventName, props: Parameters<RepositoryCore["track"]>[1]) {
    const { mechanicId, actorId, variant, ...rest } = props;
    // With a database, events go to their own table (lib/data/index.ts); only in-memory runs keep them here.
    if (!persistent()) this.db().events.push({ id: newId("evt"), name, mechanicId, actorId, variant, props: rest, createdAt: nowISO() });
    if (process.env.NODE_ENV !== "production") console.log(`[analytics] ${name}`, JSON.stringify(props));
  }
}

/** A snapshot of a sent estimate, kept when it's revised. */
function revisionOf(q: Quote): QuoteRevision {
  return {
    version: q.version ?? 1,
    sentAt: q.revisedAt ?? q.createdAt,
    totalCents: quoteTotals(q).total,
    laborCents: q.laborCents,
    partsEstimateCents: q.partsEstimateCents,
    diagnosticFeeCents: q.diagnosticFeeCents,
    travelFeeCents: q.travelFeeCents,
    partsIncluded: q.partsIncluded,
    scope: q.scope,
    availableOn: q.availableOn,
  };
}

/** Ratings are whole stars from 1 to 5; the comment is plain text. */
function reviewInput(input: Pick<Review, "overall" | "communication" | "timeliness" | "priceAccuracy" | "workmanship" | "comment">) {
  const star = (n: unknown) => {
    const v = Math.round(Number(n));
    if (!(v >= 1 && v <= 5)) throw new LifecycleError("Ratings are from 1 to 5 stars.", "invalid_input");
    return v;
  };
  return {
    overall: star(input.overall),
    communication: input.communication === undefined ? undefined : star(input.communication),
    timeliness: input.timeliness === undefined ? undefined : star(input.timeliness),
    priceAccuracy: input.priceAccuracy === undefined ? undefined : star(input.priceAccuracy),
    workmanship: input.workmanship === undefined ? undefined : star(input.workmanship),
    comment: String(input.comment ?? "").trim().slice(0, 2000),
  };
}
