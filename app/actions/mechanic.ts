"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ready, repo } from "@/lib/data";
import { getMedia } from "@/lib/data/mock/media-store";
import { getAccount, getSession, MODE_COOKIE, PERSONA_COOKIE } from "@/lib/session";
import { toPublicProfile } from "@/lib/domain/public-profile";
import { eligibility } from "@/lib/domain/eligibility";
import { DECLINE_REASONS } from "@/lib/domain/decline";
import { slotLabel } from "@/lib/domain/schedule";
import {
  REPAIR_CATEGORIES,
  VEHICLE_MAKES,
  type DeclineReason,
  type RepairCategory,
  type ScreeningKind,
  type VehicleMake,
  type WorkModel,
} from "@/lib/domain/types";

async function mechanicId() {
  const s = await getSession();
  if (s.role !== "mechanic") throw new Error("Switch to a mechanic demo persona to do this.");
  return s.mechanicId;
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const cents = (f: FormData, k: string) => Math.round((Number(str(f, k).replace(/[^0-9.]/g, "")) || 0) * 100);
const fileName = (f: FormData, k: string) => {
  const v = f.get(k);
  return v && typeof v === "object" && "name" in v && (v as File).size > 0 ? (v as File).name : "";
};

function refresh() {
  revalidatePath("/mechanic", "layout");
}

// ---------------------------------------------------------------- onboarding
export async function saveOnboarding(formData: FormData) {
  await ready();
  const s = await getSession();
  const categories = formData.getAll("categories").map(String).filter((c): c is RepairCategory => REPAIR_CATEGORIES.includes(c as RepairCategory));
  const makes = formData.getAll("makes").map(String).filter((m): m is VehicleMake => VEHICLE_MAKES.includes(m as VehicleMake));
  const acct = await getAccount();
  // Mechanic profiles always belong to a signed-in account.
  if (!acct) redirect("/signup?role=mechanic");
  // A portrait uploaded during onboarding: only the uploader's own image.
  const photoMediaId = str(formData, "photoUrl").replace(/^\/api\/media\//, "");
  const photo = photoMediaId ? await getMedia(photoMediaId) : undefined;
  const photoUrl = photo && photo.ownerId === acct.user.id && photo.meta.contentType.startsWith("image/") ? photo.meta.url : undefined;
  const m = await repo.upsertMechanicProfile({
    id: s.role === "mechanic" && str(formData, "mode") === "edit" ? s.mechanicId : undefined,
    // Signed-in customer becoming a mechanic keeps one login.
    userId: acct.user.id,
    displayName: str(formData, "displayName") || "New Mechanic",
    photoUrl,
    city: str(formData, "city") || "Los Angeles",
    neighborhood: str(formData, "neighborhood") || undefined,
    serviceRadiusMi: Number(str(formData, "serviceRadiusMi")) || 10,
    bio: str(formData, "bio"),
    workModel: (str(formData, "workModel") as WorkModel) || "mobile",
    shopName: str(formData, "shopName") || undefined,
    declaredRepairCategories: categories,
    declaredMakes: makes,
    hourlyRateCents: cents(formData, "hourlyRate"),
    diagnosticFeeCents: cents(formData, "diagnosticFee"),
    travelFeeCents: cents(formData, "travelFee") || undefined,
    availabilityNote: str(formData, "availability") || undefined,
  });
  // Credentials / employment / insurance entered during onboarding go straight to review.
  const credIssuer = str(formData, "credIssuer");
  if (credIssuer && str(formData, "credName")) {
    await repo.submitCredential(m.id, {
      issuer: credIssuer,
      name: str(formData, "credName"),
      code: str(formData, "credCode") || undefined,
      expiresOn: str(formData, "credExpires") || undefined,
      documentName: fileName(formData, "credDoc") || undefined,
    });
  }
  if (str(formData, "employer") && str(formData, "position")) {
    await repo.submitEmployment(m.id, {
      employer: str(formData, "employer"),
      position: str(formData, "position"),
      startedOn: str(formData, "empStart") || "2015-01-01",
      endedOn: str(formData, "empEnd") || undefined,
      documentName: fileName(formData, "empDoc") || undefined,
    });
  }
  const insDoc = fileName(formData, "insDoc");
  if (str(formData, "insCarrier") && str(formData, "insExpires")) {
    await repo.submitInsurance(m.id, { carrier: str(formData, "insCarrier"), expiresOn: str(formData, "insExpires"), documentName: insDoc || "certificate-of-insurance.pdf" });
  }
  const jar = await cookies();
  jar.set(MODE_COOKIE, "mechanic", { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  jar.delete(PERSONA_COOKIE);
  redirect(str(formData, "mode") === "edit" ? "/mechanic/profile?saved=1" : "/mechanic?welcome=1");
}

// -------------------------------------------------------------- verification
export async function startScreening(kind: ScreeningKind, formData: FormData) {
  await ready();
  const id = await mechanicId();
  await repo.startScreening(id, kind, str(formData, "consent") === "on" || kind === "identity");
  refresh();
}

export async function refreshScreening(kind: ScreeningKind) {
  await ready();
  const id = await mechanicId();
  await repo.refreshScreening(id, kind);
  refresh();
}

export async function submitCredential(formData: FormData) {
  await ready();
  const id = await mechanicId();
  await repo.submitCredential(id, {
    issuer: str(formData, "issuer"),
    name: str(formData, "name"),
    code: str(formData, "code") || undefined,
    issuedOn: str(formData, "issuedOn") || undefined,
    expiresOn: str(formData, "expiresOn") || undefined,
    documentName: fileName(formData, "document") || "certificate.pdf",
  });
  refresh();
}

export async function submitEmployment(formData: FormData) {
  await ready();
  const id = await mechanicId();
  await repo.submitEmployment(id, {
    employer: str(formData, "employer"),
    position: str(formData, "position"),
    startedOn: str(formData, "startedOn") || "2015-01-01",
    endedOn: str(formData, "endedOn") || undefined,
    documentName: fileName(formData, "document") || undefined,
  });
  refresh();
}

export async function submitInsurance(formData: FormData) {
  await ready();
  const id = await mechanicId();
  await repo.submitInsurance(id, {
    carrier: str(formData, "carrier"),
    expiresOn: str(formData, "expiresOn"),
    documentName: fileName(formData, "document") || "certificate-of-insurance.pdf",
  });
  refresh();
}

export async function resubmitVerification(verificationId: string, formData: FormData) {
  await ready();
  const id = await mechanicId();
  const v = repo.getVerification(verificationId);
  if (!v || v.mechanicId !== id) return;
  await repo.resubmit(verificationId, str(formData, "note"));
  refresh();
}

// ---------------------------------------------------------------- past repairs
export async function addPastRepair(formData: FormData) {
  await ready();
  const id = await mechanicId();
  const make = str(formData, "make") as VehicleMake;
  const category = str(formData, "repairCategory") as RepairCategory;
  if (!VEHICLE_MAKES.includes(make) || !REPAIR_CATEGORIES.includes(category)) throw new Error("Choose a make and repair type.");
  const r = await repo.addPastRepair(id, {
    year: Number(str(formData, "year")) || 2015,
    make,
    model: str(formData, "model"),
    repairCategory: category,
    title: str(formData, "title"),
    description: str(formData, "description") || undefined,
    performedOn: (str(formData, "performedOn") || new Date().toISOString().slice(0, 7)) + "-01",
    evidenceNames: [fileName(formData, "photo"), fileName(formData, "invoice")],
  });
  const contact = str(formData, "contact");
  if (contact) await repo.requestCustomerConfirmation(r.id, str(formData, "contactName") || "your customer", contact);
  refresh();
}

export async function requestConfirmation(pastRepairId: string, formData: FormData) {
  await ready();
  const id = await mechanicId();
  const r = repo.getMechanicSources(id).pastRepairs.find((x) => x.id === pastRepairId);
  if (!r) return;
  await repo.requestCustomerConfirmation(pastRepairId, str(formData, "contactName") || "your customer", str(formData, "contact"));
  refresh();
}

// ---------------------------------------------------------------- marketplace
/** Mechanics only ever act on requests Clutch sent them. */
async function matchedRequest(requestId: string) {
  const id = await mechanicId();
  const r = repo.getRequest(requestId);
  if (!r || !r.matchedMechanicIds.includes(id)) throw new Error("This request wasn't sent to you.");
  return { id, r };
}

const REASONS = DECLINE_REASONS;
const reasonOf = (formData?: FormData) => {
  const v = formData?.get("reason");
  return REASONS.includes(v as DeclineReason) ? (v as DeclineReason) : undefined;
};

export async function declineRequest(requestId: string, formData?: FormData) {
  await ready();
  const { id } = await matchedRequest(requestId);
  await repo.declineRequest(requestId, id, reasonOf(formData));
  refresh();
  redirect("/mechanic/requests");
}

export async function askQuestion(requestId: string, formData: FormData) {
  await ready();
  const { id } = await matchedRequest(requestId);
  const q = str(formData, "question");
  if (q) await repo.askQuestion(requestId, id, q);
  refresh();
}

export async function markInterested(requestId: string, formData: FormData) {
  await ready();
  const id = await mechanicId();
  const r = repo.getRequest(requestId);
  if (!r || !r.matchedMechanicIds.includes(id)) return;
  await repo.markInterested(requestId, id, str(formData, "note"));
  refresh();
  // Straight into the estimate: interest and estimate are one step.
  redirect(`/mechanic/requests/${requestId}#estimate`);
}

export async function submitQuote(requestId: string, formData: FormData) {
  await ready();
  const { id } = await matchedRequest(requestId);
  const draft = str(formData, "intent") === "draft";
  if (!draft) {
    // Estimates for real work need required screening current (lib/domain/eligibility.ts). Drafts are always allowed.
    if (!eligibility(toPublicProfile(repo.getMechanicSources(id))).eligible) redirect(`/mechanic/requests/${requestId}?blocked=1#estimate`);
  }
  await repo.submitQuote({
    requestId,
    mechanicId: id,
    laborCents: cents(formData, "labor"),
    diagnosticFeeCents: cents(formData, "diagnosticFee"),
    travelFeeCents: cents(formData, "travelFee"),
    partsIncluded: str(formData, "partsIncluded") === "yes",
    partsEstimateCents: cents(formData, "partsEstimate"),
    durationHours: Number(str(formData, "duration")) || 1,
    availableOn: str(formData, "availableOn"),
    serviceMode: (str(formData, "serviceMode") as "mobile" | "shop") || "mobile",
    scope: str(formData, "scope"),
    notes: str(formData, "notes") || undefined,
  }, { draft });
  refresh();
  redirect(draft ? "/mechanic/quotes?saved=1" : "/mechanic/quotes?sent=1");
}

export interface EstimateInput {
  lines: { id: string; kind: "labor" | "part"; label: string; cents: number }[];
  diagnosticFeeCents: number;
  travelFeeCents: number;
  partsIncluded: boolean;
  durationHours: number;
  availableOn: string;
  /** The appointment you're offering, for both calendars: "YYYY-MM-DD" and "HH:MM". */
  availableDate: string;
  availableTime: string;
  serviceMode: "mobile" | "shop";
  scope: string;
  notes: string;
  expiresOn: string;
  assumptions: string;
  exclusions: string;
  alternates: { label: string; description?: string; laborCents: number; partsCents: number }[];
}

const money = (n: unknown) => Math.max(0, Math.min(10_000_000, Math.round(Number(n) || 0)));
const text = (v: unknown, max = 2000) => String(v ?? "").trim().slice(0, max);

/**
 * Save (autosave) or send an itemized estimate. Returns a result instead of
 * redirecting so the builder can show "Saved" and errors inline.
 */
export async function saveEstimate(requestId: string, input: EstimateInput, intent: "draft" | "send"): Promise<{ ok: boolean; savedAt?: string; error?: string }> {
  await ready();
  const { id, r } = await matchedRequest(requestId);
  const existing = repo.listQuotesForRequest(requestId).find((q) => q.mechanicId === id);
  if (existing && existing.status !== "draft" && intent === "draft") return { ok: false, error: "This estimate was already sent." };
  if (r.declinedBy.includes(id)) return { ok: false, error: "You declined this request." };
  const slot =
    /^\d{4}-\d{2}-\d{2}$/.test(text(input.availableDate)) && /^\d{2}:\d{2}$/.test(text(input.availableTime)) ? { date: text(input.availableDate), time: text(input.availableTime) } : undefined;
  const lines = (Array.isArray(input.lines) ? input.lines : []).slice(0, 30).map((l, i) => ({
    id: text(l.id, 40) || `l${i}`,
    kind: l.kind === "part" ? ("part" as const) : ("labor" as const),
    label: text(l.label, 140),
    cents: money(l.cents),
  })).filter((l) => l.label || l.cents);
  const laborCents = lines.filter((l) => l.kind === "labor").reduce((n, l) => n + l.cents, 0);
  const partsCents = lines.filter((l) => l.kind === "part").reduce((n, l) => n + l.cents, 0);
  const scope = text(input.scope);
  if (intent === "send") {
    if (!eligibility(toPublicProfile(repo.getMechanicSources(id))).eligible) return { ok: false, error: "Your screening isn't current, so you can't send estimates yet. Your draft is saved." };
    if (!laborCents) return { ok: false, error: "Add at least one labor line with a price." };
    if (!scope) return { ok: false, error: "Describe the scope of work." };
    if (!slot) return { ok: false, error: "Pick the date and time you can do it." };
  }
  const expires = /^\d{4}-\d{2}-\d{2}$/.test(text(input.expiresOn)) ? text(input.expiresOn) : undefined;
  await repo.submitQuote(
    {
      requestId,
      mechanicId: id,
      laborCents,
      diagnosticFeeCents: money(input.diagnosticFeeCents),
      travelFeeCents: money(input.travelFeeCents),
      partsIncluded: Boolean(input.partsIncluded),
      partsEstimateCents: partsCents,
      durationHours: Math.max(0.25, Math.min(100, Number(input.durationHours) || 1)),
      availableOn: slot ? slotLabel(slot) : text(input.availableOn, 120),
      availableAt: slot,
      serviceMode: input.serviceMode === "shop" ? "shop" : "mobile",
      scope,
      notes: text(input.notes) || undefined,
      lineItems: lines,
      expiresOn: expires,
      assumptions: text(input.assumptions) || undefined,
      exclusions: text(input.exclusions) || undefined,
      alternates: (Array.isArray(input.alternates) ? input.alternates : [])
        .slice(0, 3)
        .map((a) => ({ label: text(a.label, 120), description: text(a.description, 400) || undefined, laborCents: money(a.laborCents), partsCents: money(a.partsCents) }))
        .filter((a) => a.label),
    },
    { draft: intent === "draft" },
  );
  refresh();
  if (intent === "send") redirect(`/mechanic/requests/${requestId}?sent=1#estimate`);
  return { ok: true, savedAt: new Date().toISOString() };
}

export async function answerQuoteQuestion(quoteId: string, index: number, formData: FormData) {
  await ready();
  const id = await mechanicId();
  const q = repo.getQuote(quoteId);
  if (!q || q.mechanicId !== id) return;
  await repo.answerQuoteQuestion(quoteId, index, str(formData, "answer"));
  refresh();
}

// ---------------------------------------------------------------- jobs
async function myJob(jobId: string) {
  const id = await mechanicId();
  const job = repo.getJob(jobId);
  if (!job || job.mechanicId !== id) throw new Error("Not your job.");
  return job;
}

export async function startJob(jobId: string) {
  await ready();
  await myJob(jobId);
  await repo.startJob(jobId);
  refresh();
}

/** Mechanic marks complete; the customer confirms, which creates the Platform Verified entry. */
export async function markJobDone(jobId: string, formData: FormData) {
  await ready();
  await myJob(jobId);
  const amount = cents(formData, "finalAmount");
  await repo.markJobDone(jobId, amount || undefined, str(formData, "completionNotes") || undefined, {
    engine: str(formData, "confirm_engine") || undefined,
    transmission: str(formData, "confirm_transmission") || undefined,
    drivetrain: str(formData, "confirm_drivetrain") || undefined,
  });
  refresh();
}

export async function cancelJobAsMechanic(jobId: string, formData?: FormData) {
  await ready();
  await myJob(jobId);
  await repo.cancelJob(jobId, "mechanic", reasonOf(formData));
  refresh();
}

export async function saveJobNotes(jobId: string, formData: FormData) {
  await ready();
  await myJob(jobId);
  await repo.setJobNotes(jobId, str(formData, "notes"));
  refresh();
}

/** Private notes about the mechanic's own customers. */
export async function saveCustomerNote(customerId: string, formData: FormData) {
  await ready();
  const id = await mechanicId();
  const isMine = repo.listMechanicCustomers(id).some((c) => c.customer.id === customerId);
  if (!isMine) return;
  await repo.setCustomerNote(id, customerId, str(formData, "note"));
  refresh();
}

export async function updatePricing(formData: FormData) {
  await ready();
  const id = await mechanicId();
  const labels = formData.getAll("fixedLabel").map(String);
  const cats = formData.getAll("fixedCategory").map(String);
  const prices = formData.getAll("fixedPrice").map(String);
  const fixed = labels
    .map((label, i) => ({ label: label.trim(), repairCategory: cats[i] as RepairCategory, laborCents: Math.round((Number(prices[i]) || 0) * 100) }))
    .filter((f) => f.label && f.laborCents > 0 && REPAIR_CATEGORIES.includes(f.repairCategory));
  await repo.updatePricing(id, {
    hourlyRateCents: cents(formData, "hourlyRate"),
    diagnosticFeeCents: cents(formData, "diagnosticFee"),
    travelFeeCents: cents(formData, "travelFee") || undefined,
    fixed,
  });
  refresh();
  redirect("/mechanic/settings?saved=1");
}

export async function confirmAppointment(jobId: string) {
  await ready();
  await myJob(jobId);
  await repo.confirmAppointment(jobId);
  refresh();
}

const PHOTO_KINDS = ["before", "after", "parts", "completed", "diagnostic", "vehicle"] as const;

/** Attach photos the mechanic just uploaded to a job. Only their own uploads, only repair-photo tags. */
export async function attachJobPhotos(jobId: string, items: { id: string; kind: string; caption?: string }[]) {
  await ready();
  const s = await getSession();
  if (s.role !== "mechanic") throw new Error("Switch to your mechanic account to do this.");
  await myJob(jobId);
  const media = await Promise.all(items.map((it) => getMedia(it.id)));
  const photos = items.flatMap((it, i) => {
    const m = media[i];
    if (!m || m.ownerId !== s.userId || !/^(image|video)\//.test(m.meta.contentType)) return [];
    const kind = PHOTO_KINDS.find((k) => k === it.kind) ?? "completed";
    return [{ id: it.id, url: m.meta.url, kind, source: "job" as const, media: m.meta.contentType.startsWith("video/") ? ("video" as const) : ("image" as const), caption: it.caption?.slice(0, 140), uploadedAt: m.meta.uploadedAt }];
  });
  await repo.addJobPhotos(jobId, photos);
  refresh();
  revalidatePath(`/customer/jobs/${jobId}`);
}

/** Photos added to an existing record are labelled mechanic-uploaded, never "verified repair photo". */
export async function attachRepairPhotos(pastRepairId: string, items: { id: string; kind: string; caption?: string }[]) {
  await ready();
  const s = await getSession();
  if (s.role !== "mechanic") throw new Error("Switch to your mechanic account to do this.");
  const mid = s.mechanicId;
  const rec = repo.getMechanicSources(mid).pastRepairs.find((r) => r.id === pastRepairId);
  if (!rec) throw new Error("Not your repair record.");
  const media = await Promise.all(items.map((it) => getMedia(it.id)));
  const photos = items.flatMap((it, i) => {
    const m = media[i];
    if (!m || m.ownerId !== s.userId || !/^(image|video)\//.test(m.meta.contentType)) return [];
    const kind = PHOTO_KINDS.find((k) => k === it.kind) ?? "completed";
    return [{ id: it.id, url: m.meta.url, kind, source: "mechanic" as const, media: m.meta.contentType.startsWith("video/") ? ("video" as const) : ("image" as const), caption: it.caption?.slice(0, 140), uploadedAt: m.meta.uploadedAt }];
  });
  await repo.addRepairPhotos(pastRepairId, photos);
  refresh();
  revalidatePath(`/mechanics/${repo.getMechanic(mid)?.slug}`);
}

export async function recordDiagnosis(jobId: string, formData: FormData) {
  await ready();
  await myJob(jobId);
  const note = str(formData, "note");
  if (!note) return;
  await repo.recordDiagnosis(jobId, note, str(formData, "matches") !== "no");
  refresh();
  revalidatePath(`/customer/jobs/${jobId}`);
}

export async function requestScopeChange(jobId: string, formData: FormData) {
  await ready();
  await myJob(jobId);
  const description = str(formData, "description");
  if (!description) return;
  await repo.requestScopeChange(jobId, description, cents(formData, "extra"));
  refresh();
  revalidatePath(`/customer/jobs/${jobId}`);
}
