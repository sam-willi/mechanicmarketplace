import { effectiveStatus, isPubliclyValid } from "@/lib/verification/lifecycle";
import { platformFor } from "@/lib/vehicles/catalog";
import { methodToProvenance, repairSourceToProvenance } from "./provenance";
import {
  countByCategory,
  countByMake,
  repeatCustomerCount,
  customerRelationships,
  verifiedRating,
  type CategoryCount,
  type MakeCount,
  type RatingSummary,
} from "./reputation";
import type {
  Credential,
  EmploymentRecord,
  ISODate,
  MechanicProfile,
  PastRepair,
  ProvenanceSource,
  RepairCategory,
  Review,
  ScreeningCheck,
  InsuranceRecord,
  VehicleMake,
  VerificationRecord,
  VerificationStatus,
  WorkModel,
  FixedPrice,
} from "./types";

/**
 * The public shape of a mechanic. This is the ONLY type public pages receive.
 * Screening data is reduced to outcome status + dates: no provider, no report
 * reference, no adjudication, no documents, no policy numbers.
 */
export interface PublicStatus {
  status: VerificationStatus;
  verifiedAt?: ISODate;
  expiresAt?: ISODate;
}

export interface PublicClaim {
  id: string;
  provenance: ProvenanceSource;
  status: VerificationStatus;
  verifiedAt?: ISODate;
  expiresAt?: ISODate;
}

export interface PublicCredential extends PublicClaim {
  issuer: string;
  name: string;
  code?: string;
  issuedOn?: ISODate;
}

export interface PublicEmployment extends PublicClaim {
  employer: string;
  position: string;
  startedOn: ISODate;
  endedOn?: ISODate;
}

export interface PublicRepair {
  id: string;
  year: number;
  make: VehicleMake;
  model: string;
  category: RepairCategory;
  title: string;
  performedOn: ISODate;
  provenance: ProvenanceSource;
  hasReview: boolean;
  photos: { id: string; url?: string; kind: string; verified: boolean; source: "job" | "mechanic" | "customer"; video: boolean; demo: boolean; caption?: string }[];
  /** Ticket number in the mechanic's verified record, oldest = 1. Absent for self-reported. */
  ticket?: number;
  /** Chassis/platform: recorded, or from factory data when the year and model allow only one. */
  platform?: string;
  /** Only when the job recorded it. Never inferred from the model name. */
  engineCode?: string;
  transmissionType?: string;
}

export interface PublicReview {
  id: string;
  kind: Review["kind"];
  overall: number;
  communication?: number;
  timeliness?: number;
  priceAccuracy?: number;
  workmanship?: number;
  comment: string;
  authorName: string;
  vehicleLabel?: string;
  repairLabel?: string;
  createdAt: ISODate;
  photoUrl?: string;
}

export interface PublicMechanicProfile {
  id: string;
  slug: string;
  displayName: string;
  firstName: string;
  initials: string;
  /** Stable record number printed on the profile, e.g. "CL-4180". */
  recordNo: string;
  photoUrl: string;
  city: string;
  neighborhood?: string;
  serviceRadiusMi: number;
  workModel: WorkModel;
  shopName?: string;
  bio: string;
  availabilityNote: string;
  nextAvailable: string;
  nextAvailableOn: ISODate;
  openings: { on: ISODate; time: string }[];
  tagline?: string;
  languages: string[];
  trainedAt?: string;
  yearsExperience?: number;
  /** Mechanic-provided guarantee (never a Clutch guarantee). */
  guarantee?: string;
  lat: number;
  lng: number;
  joinedAt: ISODate;
  pricing: {
    hourlyRateCents: number;
    diagnosticFeeCents: number;
    travelFeeCents?: number;
    fixed: FixedPrice[];
  };
  safety: {
    identity: PublicStatus;
    background: PublicStatus;
    driving_record: PublicStatus;
    insurance: PublicStatus;
    /** Whether a driving-record check applies to this mechanic (mobile work / test drives). */
    drivingApplies: boolean;
  };
  credentials: PublicCredential[];
  employment: PublicEmployment[];
  reputation: {
    verifiedRepairs: number;
    platformRepairs: number;
    customerRepairs: number;
    byCategory: CategoryCount[];
    byMake: MakeCount[];
    rating: RatingSummary | null;
    repeatCustomers: number;
    totalCustomers: number;
  };
  verifiedWork: PublicRepair[];
  /**
   * What this mechanic's completed Clutch jobs actually came to (labor + fees),
   * per repair type. Only shown with at least 3 jobs; middle 80% of values.
   */
  priceRanges: { category: RepairCategory; lowCents: number; highCents: number; jobs: number }[];
  selfReported: {
    repairs: PublicRepair[];
    claims: string[];
    yearsExperienceClaim?: number;
    declaredCategories: RepairCategory[];
    declaredMakes: VehicleMake[];
  };
  reviews: {
    verified: PublicReview[];
    customerConfirmed: PublicReview[];
    testimonials: PublicReview[];
  };
}

export interface ProfileSources {
  mechanic: MechanicProfile;
  screenings: ScreeningCheck[];
  insurance: InsuranceRecord[];
  credentials: Credential[];
  employment: EmploymentRecord[];
  pastRepairs: PastRepair[];
  reviews: Review[];
  verifications: VerificationRecord[];
}

const NONE: PublicStatus = { status: "not_submitted" };

export function toPublicProfile(src: ProfileSources, now = new Date()): PublicMechanicProfile {
  const m = src.mechanic;
  const ver = (subjectId: string) => src.verifications.find((v) => v.subjectId === subjectId);

  const screening = (kind: ScreeningCheck["kind"]): PublicStatus => {
    const sc = src.screenings.filter((s) => s.kind === kind).sort((a, b) => ((a.completedAt ?? "") < (b.completedAt ?? "") ? 1 : -1))[0];
    if (!sc) return NONE;
    return { status: effectiveStatus(sc.status, sc.expiresAt, now), verifiedAt: sc.completedAt, expiresAt: sc.expiresAt };
  };
  const insurance = (): PublicStatus => {
    const ins = [...src.insurance].sort((a, b) => (a.expiresOn < b.expiresOn ? 1 : -1))[0];
    if (!ins) return NONE;
    const v = ver(ins.id);
    if (!v) return { status: "pending" };
    return { status: effectiveStatus(v.status, ins.expiresOn, now), verifiedAt: v.verifiedAt, expiresAt: ins.expiresOn };
  };

  const claim = (subjectId: string, expiresOn?: ISODate): Omit<PublicClaim, "id"> => {
    const v = ver(subjectId);
    const status = v ? effectiveStatus(v.status, expiresOn ?? v.expiresAt, now) : "not_submitted";
    return {
      provenance: v && isPubliclyValid(status) ? methodToProvenance(v.method) : "self",
      status,
      verifiedAt: v?.verifiedAt,
      expiresAt: expiresOn ?? v?.expiresAt,
    };
  };

  const repairs = src.pastRepairs;
  const reviewByRepair = new Set(src.reviews.map((r) => r.pastRepairId).filter(Boolean));
  const toPublicRepair = (r: PastRepair): PublicRepair => ({
    id: r.id,
    year: r.year,
    make: r.make,
    model: r.model,
    category: r.repairCategory,
    title: r.title,
    performedOn: r.performedOn,
    provenance: repairSourceToProvenance(r.source),
    hasReview: reviewByRepair.has(r.id),
    ticket: ticketOf.get(r.id),
    // Photos on a verified record uploaded during the Clutch job are "verified repair photos";
    // anything the mechanic added afterwards is labelled as mechanic-uploaded.
    platform: r.spec?.platform ?? platformFor(r.year, r.make, r.model, /convertible/i.test(r.model) ? "convertible" : undefined)?.code,
    engineCode: r.spec?.engineCode,
    transmissionType: r.spec?.transmissionType,
    photos: (r.photos ?? []).map((ph) => ({
      id: ph.id,
      url: ph.url,
      kind: ph.kind,
      caption: ph.caption,
      source: ph.source,
      video: ph.media === "video",
      demo: Boolean(ph.demo),
      verified: !ph.demo && ph.source === "job" && r.source !== "self",
    })),
  });
  const byDateDesc = (a: PastRepair, b: PastRepair) => (a.performedOn < b.performedOn ? 1 : -1);
  const verified = repairs.filter((r) => r.source !== "self").sort(byDateDesc);
  const ticketOf = new Map([...verified].reverse().map((r, i) => [r.id, i + 1]));
  const selfRepairs = repairs.filter((r) => r.source === "self").sort(byDateDesc);

  const repairById = new Map(repairs.map((x) => [x.id, x]));
  const toPublicReview = (r: Review): PublicReview => ({
    photoUrl: r.pastRepairId ? repairById.get(r.pastRepairId)?.photos?.find((ph) => ph.url)?.url : undefined,
    id: r.id,
    kind: r.kind,
    overall: r.overall,
    communication: r.communication,
    timeliness: r.timeliness,
    priceAccuracy: r.priceAccuracy,
    workmanship: r.workmanship,
    comment: r.comment,
    authorName: r.authorName,
    vehicleLabel: r.vehicleLabel,
    repairLabel: r.repairLabel,
    createdAt: r.createdAt,
  });
  const byCreated = (a: Review, b: Review) => (a.createdAt < b.createdAt ? 1 : -1);

  const credOrder = (c: PublicCredential) => (c.provenance === "self" ? 1 : 0);

  return {
    id: m.id,
    slug: m.slug,
    displayName: m.displayName,
    firstName: m.firstName,
    initials: m.displayName
      .split(/\s+/)
      .map((p) => p[0])
      .join("")
      .slice(0, 2),
    recordNo: `CL-${String([...m.slug].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9000, 7) + 1000)}`,
    photoUrl: m.photoUrl,
    city: m.city,
    neighborhood: m.neighborhood,
    serviceRadiusMi: m.serviceRadiusMi,
    workModel: m.workModel,
    shopName: m.shopName,
    bio: m.bio,
    availabilityNote: m.availabilityNote,
    nextAvailable: m.nextAvailable,
    nextAvailableOn: m.nextAvailableOn,
    openings: m.openings ?? [{ on: m.nextAvailableOn, time: "" }],
    tagline: m.tagline,
    languages: m.languages ?? [],
    trainedAt: m.trainedAt,
    yearsExperience: m.yearsExperienceClaim,
    guarantee: m.guarantee,
    lat: m.lat,
    lng: m.lng,
    joinedAt: m.joinedAt,
    pricing: {
      hourlyRateCents: m.hourlyRateCents,
      diagnosticFeeCents: m.diagnosticFeeCents,
      travelFeeCents: m.travelFeeCents,
      fixed: m.fixedPrices,
    },
    safety: {
      identity: screening("identity"),
      background: screening("background"),
      driving_record: screening("driving_record"),
      insurance: insurance(),
      drivingApplies: m.workModel !== "shop",
    },
    credentials: src.credentials
      .map((c) => ({ id: c.id, issuer: c.issuer, name: c.name, code: c.code, issuedOn: c.issuedOn, ...claim(c.id, c.expiresOn) }))
      .sort((a, b) => credOrder(a) - credOrder(b)),
    employment: src.employment
      .map((e) => ({ id: e.id, employer: e.employer, position: e.position, startedOn: e.startedOn, endedOn: e.endedOn, ...claim(e.id) }))
      .sort((a, b) => (a.startedOn < b.startedOn ? 1 : -1)),
    reputation: {
      verifiedRepairs: verified.length,
      platformRepairs: verified.filter((r) => r.source === "platform").length,
      customerRepairs: verified.filter((r) => r.source === "customer_confirmed").length,
      byCategory: countByCategory(repairs),
      byMake: countByMake(repairs),
      rating: verifiedRating(src.reviews),
      repeatCustomers: repeatCustomerCount(repairs),
      totalCustomers: customerRelationships(repairs).length,
    },
    verifiedWork: verified.map(toPublicRepair),
    priceRanges: priceRanges(repairs),
    selfReported: {
      repairs: selfRepairs.map(toPublicRepair),
      claims: m.selfReportedClaims,
      yearsExperienceClaim: m.yearsExperienceClaim,
      declaredCategories: m.declaredRepairCategories,
      declaredMakes: m.declaredMakes,
    },
    reviews: {
      verified: src.reviews.filter((r) => r.kind === "verified_job").sort(byCreated).map(toPublicReview),
      customerConfirmed: src.reviews.filter((r) => r.kind === "customer_confirmed").sort(byCreated).map(toPublicReview),
      testimonials: src.reviews.filter((r) => r.kind === "testimonial").sort(byCreated).map(toPublicReview),
    },
  };
}

function priceRanges(repairs: PastRepair[]) {
  const by = new Map<RepairCategory, number[]>();
  for (const r of repairs) if (r.source === "platform" && r.valueCents) by.set(r.repairCategory, [...(by.get(r.repairCategory) ?? []), r.valueCents]);
  return [...by]
    .filter(([, v]) => v.length >= 3)
    .map(([category, v]) => {
      const sorted = [...v].sort((a, b) => a - b);
      const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
      return { category, lowCents: Math.round(at(0.1) / 500) * 500, highCents: Math.round(at(0.9) / 500) * 500, jobs: v.length };
    })
    .sort((a, b) => b.jobs - a.jobs);
}
