import type { PublicMechanicProfile, ProfileSources } from "@/lib/domain/public-profile";
import type { IntakeDraft } from "@/lib/domain/intake-draft";
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
  Review,
  ScreeningKind,
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
export interface RepositoryCore {
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

  // ---- Mechanic writes ----
  upsertMechanicProfile(input: MechanicProfileInput): MechanicProfile;
  updatePricing(mechanicId: ID, input: PricingInput): void;
  startScreening(mechanicId: ID, kind: ScreeningKind, consent: boolean): Promise<void>;
  refreshScreening(mechanicId: ID, kind: ScreeningKind): Promise<void>;
  submitCredential(mechanicId: ID, input: Omit<Credential, "id" | "mechanicId">): void;
  submitEmployment(mechanicId: ID, input: Omit<EmploymentRecord, "id" | "mechanicId">): void;
  submitInsurance(mechanicId: ID, input: { carrier: string; expiresOn: string; documentName: string }): void;
  resubmit(verificationId: ID, note: string): void;
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
  startJob(jobId: ID): void;
  markJobDone(jobId: ID, finalAmountCents: number | undefined, notes?: string, confirm?: { engine?: string; transmission?: string; drivetrain?: string }): void;
  /** Customer confirms completion → Platform Verified repair entry. */
  completeJob(jobId: ID): void;
  /** A mechanic's cancellation reopens the request (and still-valid estimates) so the customer can pick again. */
  cancelJob(jobId: ID, by: "customer" | "mechanic", reason?: DeclineReason): void;
  confirmAppointment(jobId: ID): void;
  recordDiagnosis(jobId: ID, note: string, matchesEstimate: boolean): void;
  requestScopeChange(jobId: ID, description: string, extraCents: number): void;
  respondScopeChange(jobId: ID, approve: boolean): void;
  addJobPhotos(jobId: ID, photos: RepairPhoto[]): void;
  addRepairPhotos(pastRepairId: ID, photos: RepairPhoto[]): void;
  /** Customer opened an estimate; the mechanic is told once. */
  markQuoteViewed(quoteId: ID): void;
  declineQuote(quoteId: ID): void;
  findRepairWithPhoto(mediaId: ID): PastRepair | undefined;
  findJobWithPhoto(mediaId: ID): Job | undefined;
  createSupportReport(input: Omit<SupportReport, "id" | "createdAt" | "status">): SupportReport;
  listSupportReports(filter?: { userId?: ID }): SupportReport[];
  setJobNotes(jobId: ID, notes: string): void;
  answerQuoteQuestion(quoteId: ID, index: number, answer: string): void;
  getCustomerNote(mechanicId: ID, customerId: ID): string;
  setCustomerNote(mechanicId: ID, customerId: ID, note: string): void;

  // ---- Admin writes ----
  decideVerification(id: ID, decision: "verified" | "rejected" | "needs_info", reviewerId: ID, notes: string, expiresAt?: string): void;

  // ---- Customer writes ----
  /**
   * Posts a request. With `directTo` it goes only to that mechanic (requested from their profile);
   * with `rebookOf` only to that returning mechanic; otherwise to a small set of qualified mechanics.
   */
  createRequest(
    input: Omit<RepairRequest, "id" | "status" | "createdAt" | "matchedMechanicIds" | "declinedBy" | "questions" | "interested"> & {
      vehicle?: Omit<Vehicle, "id" | "customerId">;
      directTo?: ID;
    },
  ): RepairRequest;
  /** Customer replies to a mechanic's question, optionally with photos/video/audio. */
  /** Send an existing request to more mechanics, unchanged (after the customer's pick couldn't take it). */
  forwardRequest(requestId: ID, mechanicIds: ID[], kind: "replacement" | "broaden"): void;
  respondToQuestion(requestId: ID, questionIndex: number, response: string, attachments: RepairMedia[]): void;
  getDraft(customerId: ID): IntakeDraft | undefined;
  saveDraft(customerId: ID, draft: IntakeDraft): void;
  clearDraft(customerId: ID): void;
  acceptQuote(quoteId: ID): Job;
  submitReview(jobId: ID, input: Pick<Review, "overall" | "communication" | "timeliness" | "priceAccuracy" | "workmanship" | "comment">): void;
  toggleSaved(customerId: ID, mechanicId: ID): boolean;
  listQuotesForCustomer(customerId: ID): Quote[];
  /** The request a media file is attached to (directly or via a question reply). */
  findRequestWithMedia(mediaId: ID): RepairRequest | undefined;
  askAboutQuote(quoteId: ID, question: string): void;
  addVehicle(customerId: ID, v: Omit<Vehicle, "id" | "customerId">): Vehicle;
  updateVehicle(vehicleId: ID, patch: Partial<Omit<Vehicle, "id" | "customerId">>): void;
  listVehicleHistory(vehicleId: ID): PastRepair[];

  // ---- Accounts (one login, role profiles) ----
  getUserByEmail(email: string): User | undefined;
  createUser(input: { id?: ID; name: string; email: string; phone?: string; role: "customer" | "mechanic"; avatarUrl?: string }): User;
  addCustomerProfile(userId: ID): CustomerProfile;
  updateUser(userId: ID, patch: Partial<Pick<User, "name" | "email" | "phone" | "notificationPrefs" | "avatarUrl">>): void;
  getCustomerByUser(userId: ID): CustomerProfile | undefined;
  grantAdmin(userId: ID): void;
  getMechanicByUser(userId: ID): MechanicProfile | undefined;

  // ---- Notifications (role-aware) ----
  notify(userId: ID, mode: AppMode, kind: NotificationKind, title: string, href: string, body?: string): void;
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
  "addPastRepair",
  "requestCustomerConfirmation",
  "respondToConfirmation",
  "declineRequest",
  "askQuestion",
  "markInterested",
  "submitQuote",
  "startJob",
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

type Async<F> = F extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never;

export type Repository = {
  [K in keyof RepositoryCore]: K extends Mutation | "analyticsSummary" | "listEvents" ? Async<RepositoryCore[K]> : RepositoryCore[K];
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
  shopName?: string;
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
