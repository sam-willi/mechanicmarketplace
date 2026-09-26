import type { RecordedSpec, VehicleSpec } from "@/lib/vehicles/types";
// Domain model for Clutch. Mirrors supabase/migrations/0001_init.sql one to one
// (camelCase here, snake_case in Postgres). Money is always integer cents.

export type ID = string;
export type ISODate = string; // YYYY-MM-DD or full ISO timestamp

export type Role = "customer" | "mechanic" | "admin";

export const REPAIR_CATEGORIES = [
  "brakes",
  "suspension",
  "cooling",
  "starters",
  "alternators",
  "diagnostics",
  "electrical",
  "engine",
  "ac",
  "maintenance",
] as const;
export type RepairCategory = (typeof REPAIR_CATEGORIES)[number];

export const VEHICLE_MAKES = [
  "BMW",
  "Honda",
  "Toyota",
  "Ford",
  "Mercedes-Benz",
  "Lexus",
  "Acura",
  "Nissan",
  "Chevrolet",
  "Subaru",
  "Audi",
  "Volkswagen",
  "Hyundai",
  "Kia",
  "Mazda",
  "Jeep",
  "Tesla",
] as const;
export type VehicleMake = (typeof VEHICLE_MAKES)[number];

export type WorkModel = "mobile" | "shop" | "both";

// ---------------------------------------------------------------------------
// Provenance & verification
// ---------------------------------------------------------------------------

/** Where a public claim's proof comes from. Exactly one per claim. */
export type ProvenanceSource =
  | "platform"
  | "institution"
  | "employer"
  | "customer"
  | "document"
  | "self";

export type VerificationStatus =
  | "not_submitted"
  | "pending"
  | "verified"
  | "rejected"
  | "needs_info"
  | "expired"
  | "reverification_required";

/** Safety = baseline screening. Skill = competence evidence. Never mixed. */
export type VerificationTrack = "safety" | "skill";

export type VerificationCategory =
  | "identity"
  | "background"
  | "driving_record"
  | "insurance"
  | "credential"
  | "employment"
  | "past_repair";

export type VerificationMethod =
  | "vendor_screening" // third-party identity / background / MVR vendor
  | "document_review" // Clutch staff reviewed an uploaded document
  | "institution_check" // confirmed with issuing body
  | "employer_check" // confirmed with employer
  | "customer_confirmation" // prior customer confirmed via link
  | "platform_job"; // completed through Clutch

export type SubjectType =
  | "screening_check"
  | "insurance_record"
  | "credential"
  | "employment"
  | "past_repair";

export interface VerificationRecord {
  id: ID;
  mechanicId: ID;
  subjectType: SubjectType;
  subjectId: ID;
  category: VerificationCategory;
  method: VerificationMethod;
  /** Vendor key for screening (e.g. "mock", "persona", "checkr"). Never on the mechanic. */
  provider?: string;
  status: VerificationStatus;
  submittedAt?: ISODate;
  verifiedAt?: ISODate;
  expiresAt?: ISODate;
  reviewerId?: ID;
  notes?: string;
  /** What the mechanic submitted, described for the admin queue. Private. */
  evidenceSummary?: string;
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/**
 * Shared account: authentication identity and contact only. Everything
 * role-specific (and all professional or sensitive mechanic data) lives on
 * customer_profiles / mechanic_profiles, never here.
 */
export interface User {
  id: ID;
  /** Roles this account holds. One login can be both customer and mechanic. */
  roles: Role[];
  email: string;
  phone?: string;
  name: string;
  notificationPrefs: { email: boolean; sms: boolean; push: boolean };
  createdAt?: ISODate;
  avatarUrl?: string;
  /** Seeded demo account (one-click sign-in, no password). Real accounts use Supabase Auth and their id is the auth user id. */
  demo?: boolean;
}

export type AppMode = "customer" | "mechanic";

export type NotificationKind =
  // customer
  | "mechanic_interested"
  | "mechanic_question"
  | "new_quote"
  | "quote_updated"
  | "job_scheduled"
  | "repair_completed"
  | "review_requested"
  // mechanic
  | "new_opportunity"
  | "customer_answered"
  | "quote_accepted"
  | "job_reminder"
  | "customer_rebooked"
  | "new_review"
  | "verification_update"
  | "customer_question"
  | "quote_viewed"
  | "appointment_confirmed"
  | "mechanic_checked_in"
  | "upcoming_appointment"
  | "verification_expiring"
  | "diagnosis_shared"
  | "scope_change_requested"
  | "scope_change_answered"
  | "mechanic_declined";

/** A customer's "something went wrong" report. Goes to Clutch support (admin). */
export interface SupportReport {
  id: ID;
  userId: ID;
  jobId?: ID;
  requestId?: ID;
  topic: "work_quality" | "no_show" | "price" | "safety" | "damage" | "other";
  details: string;
  createdAt: ISODate;
  status: "open" | "in_review" | "resolved";
}

/** Role-aware: a dual-role user sees customer notifications only in customer mode, and vice versa. */
export interface AppNotification {
  id: ID;
  userId: ID;
  mode: AppMode;
  kind: NotificationKind;
  title: string;
  body?: string;
  href: string;
  createdAt: ISODate;
  read: boolean;
}

export interface FixedPrice {
  id: ID;
  repairCategory: RepairCategory;
  label: string;
  laborCents: number;
}

export interface MechanicProfile {
  id: ID;
  userId: ID;
  slug: string;
  displayName: string;
  firstName: string;
  photoUrl: string;
  city: string;
  neighborhood?: string;
  serviceRadiusMi: number;
  bio: string;
  workModel: WorkModel;
  shopName?: string;
  hourlyRateCents: number;
  diagnosticFeeCents: number;
  travelFeeCents?: number;
  fixedPrices: FixedPrice[];
  availabilityNote: string;
  nextAvailable: string; // human label, e.g. "Sat, Sep 27"
  nextAvailableOn: ISODate; // same date, sortable
  /** Next open appointment slots the mechanic has published (date + local time). */
  openings?: { on: ISODate; time: string }[];
  /** Short human line under the name, e.g. "Self-taught technician…". Mechanic's own words. */
  tagline?: string;
  languages?: string[];
  /** Where they learned / trained, in their words (verified employers show separately). */
  trainedAt?: string;
  /** A workmanship guarantee the MECHANIC offers. Never a Clutch guarantee. */
  guarantee?: string;
  /** Declared (self-reported) focus areas — shown only as the mechanic's claim. */
  declaredRepairCategories: RepairCategory[];
  declaredMakes: VehicleMake[];
  /** Free-text experience claims the mechanic makes about themselves. */
  selfReportedClaims: string[];
  yearsExperienceClaim?: number;
  joinedAt: ISODate;
  /** Distance used by demo matching; stands in for real geo. */
  lat: number;
  lng: number;
  isDemo: true;
}

export interface CustomerProfile {
  id: ID;
  userId: ID;
  displayName: string;
  city: string;
}

export interface Vehicle {
  id: ID;
  customerId: ID;
  year: number;
  make: VehicleMake;
  model: string;
  trim?: string;
  engine?: string;
  transmission?: Transmission;
  vin?: string;
  mileage?: number;
  /** Optional customer photo of the car. */
  photoUrl?: string;
  notes?: string;
  /**
   * Values a VIN decoder returned. Kept separately so manually entered fields are
   * never overwritten; display uses the manual value first (see resolvedVehicle).
   * No decoder is wired up in the MVP.
   */
  vinDecoded?: { year?: number; make?: string; model?: string; trim?: string; engine?: string; decodedAt: ISODate; source: string };
  /** Structured configuration with where each attribute came from (lib/vehicles). */
  spec?: VehicleSpec;
}

export type Transmission = "automatic" | "manual" | "cvt" | "dual_clutch" | "unsure";

// ---------------------------------------------------------------------------
// Safety (private — never selected by public queries)
// ---------------------------------------------------------------------------

export type ScreeningKind = "identity" | "background" | "driving_record";

export interface ScreeningCheck {
  id: ID;
  mechanicId: ID;
  kind: ScreeningKind;
  provider: string;
  providerRef: string;
  status: VerificationStatus;
  /** Raw adjudication from the vendor. Private. */
  result?: "clear" | "consider" | "failed";
  consentAt?: ISODate;
  completedAt?: ISODate;
  expiresAt?: ISODate;
}

export interface InsuranceRecord {
  id: ID;
  mechanicId: ID;
  carrier: string;
  policyLast4: string;
  coverageCents: number;
  documentName: string;
  effectiveOn: ISODate;
  expiresOn: ISODate;
}

// ---------------------------------------------------------------------------
// Skill evidence
// ---------------------------------------------------------------------------

export interface Credential {
  id: ID;
  mechanicId: ID;
  issuer: string; // "ASE", "BMW Group", "Toyota", "EPA", …
  name: string; // "A5 Brakes"
  code?: string;
  issuedOn?: ISODate;
  expiresOn?: ISODate;
  documentName?: string;
}

export interface EmploymentRecord {
  id: ID;
  mechanicId: ID;
  employer: string;
  position: string;
  startedOn: ISODate;
  endedOn?: ISODate;
  city?: string;
  documentName?: string;
}

/** "document" = a Clutch reviewer verified an invoice or work order for a prior repair. */
export type PastRepairSource = "self" | "customer_confirmed" | "document" | "platform";

export interface PastRepair {
  id: ID;
  mechanicId: ID;
  source: PastRepairSource;
  jobId?: ID;
  year: number;
  make: VehicleMake;
  model: string;
  repairCategory: RepairCategory;
  title: string; // "Front brake pads + rotors"
  description?: string;
  performedOn: ISODate; // month precision is fine
  customerId?: ID;
  evidence: { kind: "photo" | "invoice" | "document"; name: string }[];
  /** For platform jobs: the approved estimate / final job value. Used for earnings estimates. */
  valueCents?: number;
  /**
   * Photos tied to this repair record. "job" = uploaded during a Clutch job (a verified
   * repair photo); "mechanic" = added by the mechanic to a record afterwards.
   */
  photos?: RepairPhoto[];
  mileage?: number;
  /** What was recorded about the car's configuration. Older records don't have it and are never backfilled with guesses. */
  spec?: RecordedSpec;
}

export interface RepairPhoto {
  id: ID;
  url?: string;
  kind: "before" | "after" | "parts" | "completed" | "diagnostic" | "vehicle" | "on_site";
  /** "job" = taken during a Clutch job; "mechanic" = added to a record later; "customer" = attached by the customer to their review. */
  source: "job" | "mechanic" | "customer";
  /** Short videos are allowed alongside photos. */
  media?: "image" | "video";
  /** Sample photo in the demo data: shown, but never labelled as verified evidence. */
  demo?: boolean;
  caption?: string;
  uploadedAt: ISODate;
}

export interface CustomerConfirmation {
  id: ID;
  pastRepairId: ID;
  mechanicId: ID;
  token: string;
  contact: string; // phone or email as typed by mechanic; private
  contactName: string;
  sentAt: ISODate;
  respondedAt?: ISODate;
  response?: "confirmed" | "denied";
}

// ---------------------------------------------------------------------------
// Marketplace
// ---------------------------------------------------------------------------

export type RequestStatus = "draft" | "open" | "quoted" | "booked" | "completed" | "cancelled";

// ---- Intake vocabulary (labels live in lib/domain/intake.ts) ----
export type Onset = "today" | "few_days" | "few_weeks" | "over_month" | "unsure";
export type StartsStatus = "normal" | "difficult" | "cranks_no_start" | "clicks_no_crank" | "no_response" | "unsure";
export type Driveability = "normal" | "short_distance" | "unsafe" | "no";
export type YesNoUnsure = "yes" | "no" | "unsure";
export type Urgency = "stranded" | "today" | "one_two_days" | "this_week" | "flexible";
export type ParkingType = "driveway" | "private_garage" | "apartment_garage" | "parking_lot" | "street" | "parking_structure" | "other";
export type WorkSpace = "yes" | "limited" | "unsure";

export type MediaKind = "photo" | "video" | "audio" | "document";
export type MediaTag =
  | "portrait"
  | "before"
  | "after"
  | "parts"
  | "completed"
  | "diagnostic"
  | "vehicle"
  | "dashboard"
  | "damage"
  | "leak"
  | "engine_bay"
  | "wheel"
  | "part"
  | "issue"
  | "sound"
  | "vin"
  | "prior_estimate"
  | "customer_part"
  | "answer"
  | "other";

export interface RepairMedia {
  id: ID;
  kind: MediaKind;
  tag: MediaTag;
  name: string;
  contentType: string;
  size: number;
  description?: string;
  uploadedAt: ISODate;
  /** Served URL. In the MVP, /api/media/:id from the in-memory store. */
  url?: string;
}

export interface RepairLocation {
  serviceMode: "mobile" | "shop";
  /** Launch-market area key (lib/domain/areas.ts) — public to matched mechanics. */
  area?: string;
  /** Street address. PRIVATE: shown to a mechanic only after the customer books them. */
  address?: string;
  parkingType?: ParkingType;
  flatGround?: YesNoUnsure;
  workSpace?: WorkSpace;
  repairsAllowed?: YesNoUnsure;
  notes?: string;
  accessAvailable?: boolean;
  /** Keys, gate codes. PRIVATE until booking is confirmed. */
  accessInstructions?: string;
}

export interface RecentRepair {
  what: string;
  when?: string;
  shop?: string;
  notes?: string;
}

export interface PriorDiagnosis {
  said: string;
  quotedRepair?: string;
  quotedPriceCents?: number;
}

export interface CustomerPart {
  description: string;
  brand?: string;
  partNumber?: string;
}

export interface RequestQuestion {
  mechanicId: ID;
  customerId: ID;
  question: string;
  askedAt: ISODate;
  response?: string;
  respondedAt?: ISODate;
  attachments: RepairMedia[];
}

export interface RepairRequest {
  id: ID;
  customerId: ID;
  vehicleId: ID;
  /**
   * Routing category for matching. Either the customer's optional "known repair" or
   * inferred by Clutch from the description. Never shown to mechanics as a diagnosis.
   */
  repairCategory: RepairCategory;
  categorySource: "customer" | "inferred";
  /** The car's configuration as it stood when the request was posted. */
  vehicleSpec?: VehicleSpec;

  // What is the car doing? (evidence, in the customer's words)
  symptomDescription: string;
  occurrence: { conditions: string[]; notes?: string };
  onset: { when?: Onset; firstNoticed?: string };
  startsStatus?: StartsStatus;
  driveability?: Driveability;
  safeToDrive?: YesNoUnsure;
  warningLights: string[];
  /** Customer-provided codes. Never a confirmed diagnosis. */
  diagnosticCodes: string[];
  sounds?: { present: YesNoUnsure; kinds: string[]; description?: string };
  smells: string[];
  leaks?: { present: YesNoUnsure; location?: string; color?: string; amount?: string };

  // Context
  recentRepairs: RecentRepair[];
  modifications?: { kinds: string[]; notes?: string };
  /** The customer's own guess. Labelled "Customer's suspected issue", never "diagnosis". */
  suspectedIssue?: string;
  priorDiagnosis?: PriorDiagnosis;
  customerParts: CustomerPart[];

  // Where and when
  location: RepairLocation;
  urgency?: Urgency;
  preferredTimes?: string;

  media: RepairMedia[];

  status: RequestStatus;
  createdAt: ISODate;
  /** Mechanic ids this request was matched/sent to. */
  matchedMechanicIds: ID[];
  declinedBy: ID[];
  questions: RequestQuestion[];
  /** Mechanics who said they're interested and available to help, before (or instead of) quoting. */
  interested: { mechanicId: ID; note?: string; at: ISODate }[];
  /** Set when the request was a rebook of a specific mechanic. */
  rebookOf?: ID;
  /** The mechanic the customer picked (a direct request or a rebook). Only they received it at first. */
  requestedMechanicId?: ID;
  /** Why a mechanic declined or cancelled. The reason, if given, is shown to the customer. */
  declines?: { mechanicId: ID; reason?: DeclineReason; at: ISODate; cancelledJob?: boolean }[];
  /** The customer re-sent this request after their pick couldn't take it. */
  handoffs?: { to: ID[]; at: ISODate; kind: "replacement" | "broaden" }[];
}

/** A mechanic's reason for declining or cancelling. Shared with the customer in plain words. */
export type DeclineReason = "booked_up" | "not_my_specialty" | "too_far" | "other";

/** draft = saved by the mechanic, never visible to the customer. declined = customer chose someone else. */
export type QuoteStatus = "draft" | "submitted" | "accepted" | "declined" | "withdrawn" | "expired";

export interface Quote {
  id: ID;
  requestId: ID;
  mechanicId: ID;
  laborCents: number;
  diagnosticFeeCents: number;
  travelFeeCents: number;
  partsIncluded: boolean;
  partsEstimateCents: number;
  durationHours: number;
  availableOn: string;
  serviceMode: "mobile" | "shop";
  scope: string;
  notes?: string;
  status: QuoteStatus;
  createdAt: ISODate;
  /** First time the customer opened the written estimate. */
  viewedAt?: ISODate;
  /** Customer questions about this estimate, answered by the mechanic. */
  customerQuestions: { question: string; askedAt: ISODate; answer?: string; answeredAt?: ISODate }[];
  /** Itemized lines. When present, laborCents / partsEstimateCents are their sums. */
  lineItems?: QuoteLine[];
  /** The estimate is honored until this date. */
  expiresOn?: ISODate;
  /** What the price assumes (e.g. "Rotors are within spec and only need pads"). */
  assumptions?: string;
  /** What isn't included. */
  exclusions?: string;
  /** Other outcomes when the diagnosis is uncertain, each with its own price. */
  alternates?: QuoteAlternate[];
  /** Why a declined estimate was closed: the customer booked someone else, or turned it down. */
  closedReason?: "chose_other" | "customer_declined";
}

export interface QuoteLine {
  id: string;
  kind: "labor" | "part";
  label: string;
  cents: number;
}

export interface QuoteAlternate {
  label: string;
  description?: string;
  laborCents: number;
  partsCents: number;
}

/**
 * scheduled → in_progress → awaiting_customer (mechanic marked complete) →
 * completed (customer confirmed; creates the Platform Verified repair entry).
 */
export type JobStatus = "scheduled" | "in_progress" | "awaiting_customer" | "completed" | "cancelled";

export interface Job {
  id: ID;
  quoteId: ID;
  requestId: ID;
  mechanicId: ID;
  customerId: ID;
  vehicleId: ID;
  repairCategory: RepairCategory;
  title: string;
  status: JobStatus;
  scheduledFor: string;
  /** Mechanic confirmed the appointment time. */
  confirmedAt?: ISODate;
  startedAt?: ISODate;
  mechanicCompletedAt?: ISODate;
  completedAt?: ISODate;
  cancelledAt?: ISODate;
  cancelledBy?: "customer" | "mechanic";
  /** Final job value entered by the mechanic at completion. An estimate record, not a payment. */
  finalAmountCents?: number;
  completionNotes?: string;
  /** Mechanic's private notes for this job. */
  mechanicNotes?: string;
  /** Photos the mechanic took during the job; they join the verified repair record on confirmation. */
  photos?: RepairPhoto[];
  /** What the mechanic found, shared with the customer. */
  diagnosis?: { note: string; matchesEstimate: boolean; at: ISODate };
  /** The car's configuration for this job; the mechanic can confirm open items at completion. */
  vehicleSpec?: VehicleSpec;
  /** Work beyond the approved estimate needs the customer's approval first. */
  scopeChange?: { description: string; extraCents: number; status: "pending" | "approved" | "declined"; requestedAt: ISODate; respondedAt?: ISODate };
}

export type ReviewKind = "verified_job" | "customer_confirmed" | "testimonial";

export interface Review {
  id: ID;
  mechanicId: ID;
  kind: ReviewKind;
  jobId?: ID;
  pastRepairId?: ID;
  overall: number;
  communication?: number;
  timeliness?: number;
  priceAccuracy?: number;
  workmanship?: number;
  comment: string;
  authorName: string; // first name + initial
  vehicleLabel?: string;
  repairLabel?: string;
  createdAt: ISODate;
}

export interface SavedMechanic {
  customerId: ID;
  mechanicId: ID;
  savedAt: ISODate;
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export type AnalyticsEventName =
  | "profile_view"
  | "profile_share"
  | "verification_badge_clicked"
  | "repair_request_started"
  | "repair_request_completed"
  | "quote_requested"
  | "quote_viewed"
  | "mechanic_selected"
  | "repeat_booking"
  | "review_submitted"
  | "quote_declined"
  | "replacement_sent";

export type EvidenceVariant = "high" | "low";

export interface AnalyticsEvent {
  id: ID;
  name: AnalyticsEventName;
  mechanicId?: ID;
  actorId?: ID;
  sessionId?: string;
  variant?: EvidenceVariant;
  props: Record<string, string | number | boolean | undefined>;
  createdAt: ISODate;
}
