import type { PublicMechanicProfile, ProfileSources } from "@/lib/domain/public-profile";
import type { IntakeDraft } from "@/lib/domain/intake-draft";
import type { Scope } from "./scope";
import type { Actor } from "@/lib/domain/transitions";
import type { DeliveryEventType } from "@/lib/notify/events";
import type { QueueCounts } from "@/lib/admin-queue";
import type { BookingAcknowledgement } from "@/lib/domain/disclosure";
import type { SearchPool } from "@/lib/domain/search";
import type {
  AnalyticsEvent,
  DeclineReason,
  RepairPhoto,
  SupportReport,
  AppMode,
  AppNotification,
  NotificationKind,
  AnalyticsEventName,
  Credential,
  CustomerConfirmation,
  CustomerProfile,
  RepairMedia,
  EmploymentRecord,
  EvidenceVariant,
  ID,
  Job,
  MechanicProfile,
  PastRepair,
  Quote,
  RepairCategory,
  RepairRequest,
  RequestEdit,
  Review,
  Slot,
  ScreeningKind,
  InsurancePolicyType,
  User,
  Vehicle,
  VehicleMake,
  VerificationRecord,
  VerificationStatus,
  WorkModel,
} from "@/lib/domain/types";

/**
 * Data access contract. `RepositoryCore` is the synchronous domain logic (see
 * lib/data/mock/repository.ts) running on a snapshot of the data; `Repository`
 * is what the app uses: the same reads, with every write returning a Promise
 * that resolves once it's committed to the database (lib/data/store.ts).
 * Public pages must only use `getPublicProfile` / `listPublicProfiles` — they
 * never see private rows.
 */
export type ReviewAction = "approve" | "reject" | "request_info" | "revoke";

export interface InsuranceInput {
  policyType?: InsurancePolicyType;
  namedInsured?: string;
  carrier: string;
  effectiveOn?: string;
  expiresOn: string;
  documentName?: string;
  /** Private uploads (the certificate). Required. */
  documentIds: ID[];
}

export interface RepositoryCore {
  /** The data scope this repository reads and writes (lib/data/scope.ts). Fixed for its lifetime. */
  readonly scope: Scope;
  // ---- Public reads ----
  listPublicProfiles(): PublicMechanicProfile[];
  getPublicProfile(slug: string): PublicMechanicProfile | null;

  // ---- Private reads (owner / admin) ----
  getUser(id: ID): User | undefined;
  getMechanic(id: ID): MechanicProfile | undefined;
  getMechanicBySlug(slug: string): MechanicProfile | undefined;
  getMechanicByPhotoUrl(url: string): MechanicProfile | undefined;
  getMechanicSources(mechanicId: ID): ProfileSources;
  listVerifications(filter?: { mechanicId?: ID; statuses?: VerificationStatus[] }): VerificationRecord[];
  getVerification(id: ID): VerificationRecord | undefined;
  describeSubject(v: VerificationRecord): { title: string; detail: string[] };
  getConfirmationByToken(token: string): { confirmation: CustomerConfirmation; repair: PastRepair; mechanic: MechanicProfile } | null;
  listConfirmations(mechanicId: ID): CustomerConfirmation[];

  getCustomer(id: ID): CustomerProfile | undefined;
  listVehicles(customerId: ID): Vehicle[];
  getVehicle(id: ID): Vehicle | undefined;
  listRequestsForCustomer(customerId: ID): RepairRequest[];
  listRequestsForMechanic(mechanicId: ID): RepairRequest[];
  /** Every request in this scope (staff demand view). */
  listAllRequests(): RepairRequest[];
  getRequest(id: ID): RepairRequest | undefined;
  listQuotesForRequest(requestId: ID): Quote[];
  listQuotesForMechanic(mechanicId: ID): Quote[];
  getQuote(id: ID): Quote | undefined;
  listJobsForMechanic(mechanicId: ID): Job[];
  listJobsForCustomer(customerId: ID): Job[];
  getJob(id: ID): Job | undefined;
  getReviewForJob(jobId: ID): Review | undefined;
  listCustomerHistory(customerId: ID): PastRepair[];
  listSaved(customerId: ID): ID[];
  listMechanicCustomers(mechanicId: ID): {
    customer: CustomerProfile;
    jobs: PastRepair[];
    isRepeat: boolean;
  }[];
  analyticsSummary(mechanicId: ID): Record<AnalyticsEventName | "profile_view_total", number>;
  listEvents(limit?: number): AnalyticsEvent[];

  // ---- Candidate and aggregate reads (async on the app's Repository; SQL in targeted live mode) ----
  /**
   * Profiles that search and replacement suggestions rank. Targeted live mode returns only
   * BOOKABLE mechanics (plus, with `unbookable`, a bounded sample of others); in memory, every profile.
   */
  searchPool(opts?: { unbookable?: number; repair?: RepairCategory; make?: VehicleMake; model?: string }): SearchPool;
  /** Full public profiles for a few mechanics (e.g. the suggestions shown). */
  publicProfiles(ids: ID[]): PublicMechanicProfile[];
  /** Is at least one mechanic bookable right now? */
  anyBookable(): boolean;
  /** Staff: bookable mechanics and profiles in total. */
  supplyCounts(): { profiles: number; bookable: number };
  /** Staff review queue: items per tab, and approvals in the last week. */
  verificationCounts(nowIso: string, weekAgo: string): QueueCounts;
  openSupportCount(): number;
  /** Staff: support cases per status. */
  supportStatusCounts(): Record<string, number>;
  /** A mechanic's own estimates, counted per status (the Estimates tabs). */
  quoteStatusCounts(mechanicId: ID): Record<string, number>;
  /** Saved requests this mechanic would be sent once matchable (a count; no request is read). */
  waitingDemandCount(mechanic: MechanicProfile): number;
  /** After a staff decision: the next pending item (this mechanic's first, else the oldest). */
  nextPendingVerification(excludeId: ID, mechanicId: ID, nowIso: string): ID | undefined;

  // ---- Mechanic writes ----
  upsertMechanicProfile(input: MechanicProfileInput): MechanicProfile;
  updatePricing(mechanicId: ID, input: PricingInput): void;
  startScreening(mechanicId: ID, kind: ScreeningKind, consent: boolean): Promise<void>;
  refreshScreening(mechanicId: ID, kind: ScreeningKind): Promise<void>;
  submitCredential(mechanicId: ID, input: Omit<Credential, "id" | "mechanicId">): void;
  submitEmployment(mechanicId: ID, input: Omit<EmploymentRecord, "id" | "mechanicId">): void;
  submitInsurance(mechanicId: ID, input: InsuranceInput): void;
  resubmit(verificationId: ID, note: string, documentIds?: ID[]): void;
  /** Identity (hosted provider flow): the record a new session belongs to, and recording the session. */
  prepareIdentityCheck(mechanicId: ID): VerificationRecord;
  recordIdentityStart(mechanicId: ID, input: { provider: string; providerRef: string; recordId: ID }): void;
  /** A provider result fetched server-side after a signed webhook (idempotent on eventId). */
  applyProviderResult(input: { providerRef: string; recordId?: ID; status: VerificationStatus; reasonCodes: string[]; eventId: string; provider: string; nameMatches?: boolean; validMonths?: number }): { applied: boolean; status: VerificationStatus };
  /** Renewal reminders and expiry (idempotent); one mechanic, or everyone. */
  remindRenewals(nowIso: string, mechanicId?: ID): number;
  currentCheck(mechanicId: ID, category: VerificationRecord["category"]): VerificationRecord | undefined;
  addPastRepair(mechanicId: ID, input: Omit<PastRepair, "id" | "mechanicId" | "source" | "evidence"> & { evidenceNames: string[] }): PastRepair;
  requestCustomerConfirmation(pastRepairId: ID, contactName: string, contact: string): CustomerConfirmation;
  respondToConfirmation(token: string, response: "confirmed" | "denied"): void;
  /** A mechanic passes on a request. If the customer picked them, the customer is told and shown others. */
  declineRequest(requestId: ID, mechanicId: ID, reason?: DeclineReason): void;
  askQuestion(requestId: ID, mechanicId: ID, question: string): void;
  /** "Interested in this job" — a mechanic signals they can help before sending an estimate. */
  markInterested(requestId: ID, mechanicId: ID, note?: string): void;
  /** Send (or, with draft, save privately) an estimate. Never exposes other mechanics' estimates. */
  submitQuote(input: Omit<Quote, "id" | "status" | "createdAt" | "customerQuestions">, opts?: { draft?: boolean }): Quote;
  // Lifecycle writes take the acting customer/mechanic id and check it against the record in the same
  // transaction; out-of-order moves throw a LifecycleError (lib/domain/transitions.ts).
  startJob(jobId: ID, mechanicId: ID): void;
  markJobDone(
    jobId: ID,
    mechanicId: ID,
    finalAmountCents: number | undefined,
    notes?: string,
    confirm?: { engine?: string; transmission?: string; drivetrain?: string },
    payment?: { status: "paid" | "not_paid"; amountCents?: number },
  ): void;
  /** Customer: the repair isn't finished. Back to in progress, with their reason. */
  reopenJob(jobId: ID, customerId: ID, note: string): void;
  proposeReschedule(jobId: ID, who: Actor, when: string, slot?: Slot, note?: string): void;
  respondReschedule(jobId: ID, who: Actor, accept: boolean): void;
  /** Self-reported payment facts from either side. Clutch doesn't process money. */
  reportPayment(jobId: ID, who: Actor, report: { status: "paid" | "not_paid"; amountCents?: number }): void;
  /** Accepted estimate + approved extra work (labor and fees). */
  approvedLaborAndFees(job: Job): number;
  /** Customer confirms completion → Platform Verified repair entry. */
  completeJob(jobId: ID, customerId: ID, payment?: { status: "paid" | "not_paid"; amountCents?: number }): void;
  /** A mechanic's cancellation reopens the request (and still-valid estimates) so the customer can pick again. */
  cancelJob(jobId: ID, who: Actor, reason?: DeclineReason): void;
  confirmAppointment(jobId: ID, mechanicId: ID): void;
  recordDiagnosis(jobId: ID, mechanicId: ID, note: string, matchesEstimate: boolean): void;
  requestScopeChange(jobId: ID, mechanicId: ID, description: string, extraCents: number): void;
  respondScopeChange(jobId: ID, customerId: ID, approve: boolean): void;
  addJobPhotos(jobId: ID, photos: RepairPhoto[]): void;
  addRepairPhotos(pastRepairId: ID, photos: RepairPhoto[]): void;
  /** Customer opened an estimate; the mechanic is told once. */
  markQuoteViewed(quoteId: ID): void;
  declineQuote(quoteId: ID, customerId: ID): void;
  findRepairWithPhoto(mediaId: ID): PastRepair | undefined;
  findJobWithPhoto(mediaId: ID): Job | undefined;
  createSupportReport(input: Omit<SupportReport, "id" | "createdAt" | "status" | "messages" | "history" | "updatedAt">): SupportReport;
  listSupportReports(filter?: { userId?: ID }): SupportReport[];
  getSupportReport(id: ID): SupportReport | undefined;
  /** The reporter adds a message to their own case (reopens a resolved one). */
  addSupportMessage(reportId: ID, userId: ID, body: string): void;
  /** Staff only: change status and/or reply. The reporter sees it in the app. */
  updateSupportCase(reportId: ID, staffUserId: ID, change: { status?: SupportReport["status"]; reply?: string }): void;
  setJobNotes(jobId: ID, notes: string): void;
  answerQuoteQuestion(quoteId: ID, mechanicId: ID, index: number, answer: string): void;
  getCustomerNote(mechanicId: ID, customerId: ID): string;
  setCustomerNote(mechanicId: ID, customerId: ID, note: string): void;

  /** Local browser testing only: a fictional test mechanic becomes bookable. Refused unless CLUTCH_TEST_LOGINS=on. */
  addTestScreening(mechanicId: ID): void;
  /** A real mechanic's screening check that no real provider ran (it can't be approved). */
  unrunScreening(v: VerificationRecord): boolean;

  // ---- Admin writes ----
  decideVerification(id: ID, action: ReviewAction, reviewerId: ID, input: { reasonCode: string; note?: string; expiresAt?: string }): void;

  // ---- Customer writes ----
  /**
   * Posts a request. With `directTo` it goes only to that mechanic (requested from their profile);
   * with `rebookOf` only to that returning mechanic; otherwise to a small set of matching mechanics (complete profile, serves the area, fits the repair).
   */
  createRequest(
    input: Omit<RepairRequest, "id" | "status" | "createdAt" | "matchedMechanicIds" | "declinedBy" | "questions" | "interested" | "history"> & {
      vehicle?: Omit<Vehicle, "id" | "customerId">;
      directTo?: ID;
    },
  ): RepairRequest;
  /** Customer replies to a mechanic's question, optionally with photos/video/audio. */
  /** Send an existing request to more mechanics, unchanged (after the customer's pick couldn't take it). */
  forwardRequest(requestId: ID, mechanicIds: ID[], kind: "replacement" | "broaden"): void;
  /** Customer edits a request no mechanic has responded to yet. Re-runs matching if it was waiting. */
  updateRequest(requestId: ID, edit: RequestEdit): RepairRequest;
  /** Customer withdraws a request that isn't booked. Mechanics it was sent to stop seeing it as open. */
  cancelRequest(requestId: ID): void;
  /** Looks again for bookable mechanics for a request that was saved with none. Returns how many it was sent to. */
  rematchRequest(requestId: ID): number;
  respondToQuestion(requestId: ID, questionIndex: number, response: string, attachments: RepairMedia[]): void;
  getDraft(customerId: ID): IntakeDraft | undefined;
  saveDraft(customerId: ID, draft: IntakeDraft): void;
  clearDraft(customerId: ID): void;
  /** Atomic: one job, competing estimates closed, and only the version the customer saw (`expectedVersion`). Idempotent. */
  /**
   * Book the estimate. When Clutch hasn't verified every check of that mechanic, `ack` must carry
   * the current disclosure version and the statuses the customer read (lib/domain/disclosure.ts);
   * a missing, outdated or tampered acknowledgement is refused. The statuses, disclosure and who
   * acknowledged are stored with the job and never change.
   */
  acceptQuote(quoteId: ID, customerId: ID, expectedVersion?: number, ack?: BookingAcknowledgement): Job;
  submitReview(jobId: ID, customerId: ID, input: Pick<Review, "overall" | "communication" | "timeliness" | "priceAccuracy" | "workmanship" | "comment">): Review;
  updateReview(jobId: ID, customerId: ID, input: Pick<Review, "overall" | "communication" | "timeliness" | "priceAccuracy" | "workmanship" | "comment">): Review;
  toggleSaved(customerId: ID, mechanicId: ID): boolean;
  listQuotesForCustomer(customerId: ID): Quote[];
  /** The request a media file is attached to (directly or via a question reply). */
  findRequestWithMedia(mediaId: ID): RepairRequest | undefined;
  askAboutQuote(quoteId: ID, customerId: ID, question: string): void;
  addVehicle(customerId: ID, v: Omit<Vehicle, "id" | "customerId">): Vehicle;
  updateVehicle(vehicleId: ID, patch: Partial<Omit<Vehicle, "id" | "customerId">>): void;
  listVehicleHistory(vehicleId: ID): PastRepair[];

  // ---- Accounts (one login, role profiles) ----
  getUserByEmail(email: string): User | undefined;
  createUser(input: { id?: ID; name: string; email: string; phone?: string; role: "customer" | "mechanic"; avatarUrl?: string }): User;
  addCustomerProfile(userId: ID): CustomerProfile;
  updateUser(userId: ID, patch: Partial<Pick<User, "name" | "email" | "phone" | "notificationPrefs" | "avatarUrl" | "emailVerifiedAt">>): void;
  getCustomerByUser(userId: ID): CustomerProfile | undefined;
  grantAdmin(userId: ID): void;
  getMechanicByUser(userId: ID): MechanicProfile | undefined;

  // ---- Notifications (role-aware) ----
  notify(userId: ID, mode: AppMode, kind: NotificationKind, title: string, href: string, body?: string, event?: DeliveryEventType | "none"): void;
  listNotifications(userId: ID, mode: AppMode): AppNotification[];
  markNotificationsRead(userId: ID, mode: AppMode): void;

  // ---- Analytics ----
  track(name: AnalyticsEventName, props: { mechanicId?: ID; actorId?: ID; variant?: EvidenceVariant; [k: string]: string | number | boolean | undefined }): void;
}

/** Every method that changes data. The facade runs these inside a committed transaction. */
export const MUTATIONS = [
  "upsertMechanicProfile",
  "updatePricing",
  "startScreening",
  "refreshScreening",
  "submitCredential",
  "submitEmployment",
  "submitInsurance",
  "resubmit",
  "prepareIdentityCheck",
  "recordIdentityStart",
  "applyProviderResult",
  "remindRenewals",
  "addPastRepair",
  "requestCustomerConfirmation",
  "respondToConfirmation",
  "declineRequest",
  "askQuestion",
  "markInterested",
  "submitQuote",
  "startJob",
  "reopenJob",
  "proposeReschedule",
  "respondReschedule",
  "reportPayment",
  "updateReview",
  "addSupportMessage",
  "updateSupportCase",
  "addTestScreening",
  "markJobDone",
  "completeJob",
  "cancelJob",
  "confirmAppointment",
  "recordDiagnosis",
  "requestScopeChange",
  "respondScopeChange",
  "addJobPhotos",
  "addRepairPhotos",
  "markQuoteViewed",
  "declineQuote",
  "createSupportReport",
  "setJobNotes",
  "answerQuoteQuestion",
  "setCustomerNote",
  "decideVerification",
  "createRequest",
  "respondToQuestion",
  "forwardRequest",
  "updateRequest",
  "cancelRequest",
  "rematchRequest",
  "saveDraft",
  "clearDraft",
  "acceptQuote",
  "submitReview",
  "toggleSaved",
  "askAboutQuote",
  "addVehicle",
  "updateVehicle",
  "createUser",
  "addCustomerProfile",
  "updateUser",
  "grantAdmin",
  "notify",
  "markNotificationsRead",
] as const satisfies readonly (keyof RepositoryCore)[];
export type Mutation = (typeof MUTATIONS)[number];

/** Reads that are async on the app's Repository (SQL in targeted live mode). */
export const QUERIES = ["analyticsSummary", "listEvents", "searchPool", "publicProfiles", "anyBookable", "supplyCounts", "verificationCounts", "openSupportCount", "supportStatusCounts", "quoteStatusCounts", "waitingDemandCount", "nextPendingVerification"] as const satisfies readonly (keyof RepositoryCore)[];
export type Query = (typeof QUERIES)[number];

type Async<F> = F extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never;

export type Repository = {
  [K in keyof RepositoryCore]: K extends Mutation | Query ? Async<RepositoryCore[K]> : RepositoryCore[K];
};

export interface MechanicProfileInput {
  id?: ID;
  /** Existing account to attach the mechanic role to (dual-role users). */
  userId?: ID;
  displayName: string;
  photoUrl?: string;
  city: string;
  neighborhood?: string;
  serviceRadiusMi: number;
  bio: string;
  workModel: WorkModel;
  declaredRepairCategories: RepairCategory[];
  declaredMakes: VehicleMake[];
  hourlyRateCents: number;
  diagnosticFeeCents: number;
  travelFeeCents?: number;
  availabilityNote?: string;
}

export interface PricingInput {
  hourlyRateCents: number;
  diagnosticFeeCents: number;
  travelFeeCents?: number;
  fixed: { id?: ID; repairCategory: RepairCategory; label: string; laborCents: number }[];
}
