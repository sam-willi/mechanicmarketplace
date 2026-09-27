"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getRepo } from "@/lib/data";
import { orBack } from "@/lib/lifecycle-action";
import { LifecycleError } from "@/lib/domain/transitions";
import { getMedia } from "@/lib/data/mock/media-store";
import { identityConfig } from "@/lib/verification/identity/config";
import { ProviderUnavailable } from "@/lib/verification/identity/types";
import { getAccount, getSession, MODE_COOKIE, needs, PERSONA_COOKIE } from "@/lib/session";
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
  type InsurancePolicyType,
  type VehicleMake,
} from "@/lib/domain/types";

async function mechanicId() {
  const s = await getSession();
  if (s.role !== "mechanic") throw new Error("Log in with a mechanic account to do this.");
  return s.mechanicId;
}

/** The signed-in mechanic and this request's loaders (their own records and requests sent to them only). */
async function mechanic() {
  const s = await getSession();
  if (s.role !== "mechanic") throw new Error("Log in with a mechanic account to do this.");
  return { id: s.mechanicId, n: await needs(s) };
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
  const repo = await getRepo();
  const s = await getSession();
  const categories = formData.getAll("categories").map(String).filter((c): c is RepairCategory => REPAIR_CATEGORIES.includes(c as RepairCategory));
  const makes = formData.getAll("makes").map(String).filter((m): m is VehicleMake => VEHICLE_MAKES.includes(m as VehicleMake));
  const acct = await getAccount();
  // Mechanic profiles always belong to a signed-in account.
  if (!acct) redirect("/signup?role=mechanic");
  // A portrait uploaded during onboarding: only the uploader's own image.
  const photoMediaId = str(formData, "photoUrl").replace(/^\/api\/media\//, "");
  const photo = photoMediaId ? await getMedia(repo.scope, photoMediaId) : undefined;
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
    workModel: "mobile",
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

    });
  }
  if (str(formData, "employer") && str(formData, "position")) {
    await repo.submitEmployment(m.id, {
      employer: str(formData, "employer"),
      position: str(formData, "position"),
      startedOn: str(formData, "empStart") || "2015-01-01",
      endedOn: str(formData, "empEnd") || undefined,

    });
  }
  const jar = await cookies();
  jar.set(MODE_COOKIE, "mechanic", { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  jar.delete(PERSONA_COOKIE);
  redirect(str(formData, "mode") === "edit" ? "/mechanic/profile?saved=1" : "/mechanic?welcome=1");
}

// -------------------------------------------------------------- verification
/**
 * Documents attached to a submission: each must be a verification document this account uploaded,
 * in this marketplace. Anything else (someone else's upload, a repair photo) is refused.
 */
async function ownDocuments(formData: FormData, userId: string, scope: "live" | "demo") {
  const ids = [...new Set(formData.getAll("documentIds").map(String).filter(Boolean))].slice(0, 5);
  for (const id of ids) {
    const m = await getMedia(scope, id);
    if (!m || m.ownerId !== userId || m.meta.tag !== "verification_doc") throw new LifecycleError("That document isn't one you uploaded here. Upload it again.", "forbidden");
  }
  return ids;
}

function origin(h: Headers) {
  const app = (process.env.APP_URL ?? "").replace(/\/$/, "");
  if (app) return app;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
}

/**
 * Identity: start (or resume) a hosted session with the configured provider, bound to this
 * signed-in mechanic and record, then hand over to the provider's short-lived URL. The result
 * only ever comes from the provider (signed webhook, or a server-side fetch on return).
 */
export async function startIdentity() {
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "mechanic") redirect("/login?next=/mechanic/verification");
  const cfg = identityConfig(repo.scope);
  if (!cfg.provider) redirect("/mechanic/verification?identity=unavailable#identity");
  await (await needs(s)).ownSources();
  let url: string;
  try {
    const rec = await repo.prepareIdentityCheck(s.mechanicId);
    const session = await cfg.provider.createSession({
      recordId: rec.id,
      accountId: s.userId,
      scope: repo.scope,
      returnUrl: `${origin(await headers())}/mechanic/verification/identity/return?r=${rec.id}`,
      idempotencyKey: `identity:${rec.id}:${(rec.events ?? []).filter((e) => e.action === "cancelled" || e.action === "started").length}`,
    });
    await repo.recordIdentityStart(s.mechanicId, { provider: cfg.provider.key, providerRef: session.providerRef, recordId: rec.id });
    url = session.url;
  } catch (e) {
    if (e instanceof ProviderUnavailable) redirect("/mechanic/verification?identity=outage#identity");
    if (e instanceof LifecycleError) redirect(`/mechanic/verification?error=${encodeURIComponent(e.message)}#identity`);
    throw e;
  }
  redirect(url);
}

export async function startScreening(kind: ScreeningKind, formData: FormData) {
  const repo = await getRepo();
  const id = await mechanicId();
  if (kind === "identity") return startIdentity();
  await repo.startScreening(id, kind, str(formData, "consent") === "on");
  refresh();
}

export async function refreshScreening(kind: ScreeningKind) {
  const repo = await getRepo();
  const id = await mechanicId();
  await repo.refreshScreening(id, kind);
  refresh();
}

export async function submitCredential(formData: FormData) {
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "mechanic") return;
  await (await needs(s)).ownSources();
  const documentIds = await ownDocuments(formData, s.userId, repo.scope);
  await repo.submitCredential(s.mechanicId, {
    issuer: str(formData, "issuer"),
    name: str(formData, "name"),
    code: str(formData, "code") || undefined,
    issuedOn: str(formData, "issuedOn") || undefined,
    expiresOn: str(formData, "expiresOn") || undefined,
    documentIds,
  } as never);
  refresh();
}

export async function submitEmployment(formData: FormData) {
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "mechanic") return;
  await (await needs(s)).ownSources();
  const documentIds = await ownDocuments(formData, s.userId, repo.scope);
  await repo.submitEmployment(s.mechanicId, {
    employer: str(formData, "employer"),
    position: str(formData, "position"),
    startedOn: str(formData, "startedOn") || "2015-01-01",
    endedOn: str(formData, "endedOn") || undefined,
    documentIds,
  } as never);
  refresh();
}

const POLICY_TYPES: InsurancePolicyType[] = ["general_liability", "garage_liability", "garagekeepers", "commercial_auto", "other"];

export async function submitInsurance(formData: FormData) {
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "mechanic") return;
  await (await needs(s)).ownSources();
  const policyType = str(formData, "policyType") as InsurancePolicyType;
  try {
    const documentIds = await ownDocuments(formData, s.userId, repo.scope);
    await repo.submitInsurance(s.mechanicId, {
      policyType: POLICY_TYPES.includes(policyType) ? policyType : undefined,
      namedInsured: str(formData, "namedInsured") || undefined,
      carrier: str(formData, "carrier"),
      effectiveOn: str(formData, "effectiveOn") || undefined,
      expiresOn: str(formData, "expiresOn"),
      documentIds,
    });
  } catch (e) {
    if (e instanceof LifecycleError) redirect(`/mechanic/verification?error=${encodeURIComponent(e.message)}#insurance`);
    throw e;
  }
  refresh();
  redirect("/mechanic/verification?sent=insurance#insurance");
}

export async function resubmitVerification(verificationId: string, formData: FormData) {
  const repo = await getRepo();
  const { id, n } = await mechanic();
  await n.ownSources();
  const v = repo.getVerification(verificationId);
  if (!v || v.mechanicId !== id) return;
  const s = await getSession();
  const documentIds = s.role === "mechanic" ? await ownDocuments(formData, s.userId, repo.scope) : [];
  try {
    await repo.resubmit(verificationId, str(formData, "note"), documentIds);
  } catch (e) {
    if (e instanceof LifecycleError) redirect(`/mechanic/verification?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  refresh();
}

// ---------------------------------------------------------------- past repairs
export async function addPastRepair(formData: FormData) {
  const repo = await getRepo();
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
  const repo = await getRepo();
  const { id, n } = await mechanic();
  await n.ownSources();
  const r = repo.getMechanicSources(id).pastRepairs.find((x) => x.id === pastRepairId);
  if (!r) return;
  await repo.requestCustomerConfirmation(pastRepairId, str(formData, "contactName") || "your customer", str(formData, "contact"));
  refresh();
}

// ---------------------------------------------------------------- marketplace
/** Mechanics only ever act on requests Clutch sent them. */
async function matchedRequest(requestId: string) {
  const repo = await getRepo();
  const { id, n } = await mechanic();
  await n.mechanicRequest(requestId);
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
  const repo = await getRepo();
  const { id } = await matchedRequest(requestId);
  await orBack(`/mechanic/requests/${requestId}`, () => repo.declineRequest(requestId, id, reasonOf(formData)));
  refresh();
  redirect("/mechanic/requests");
}

export async function askQuestion(requestId: string, formData: FormData) {
  const repo = await getRepo();
  const { id } = await matchedRequest(requestId);
  const q = str(formData, "question");
  if (q) await orBack(`/mechanic/requests/${requestId}`, () => repo.askQuestion(requestId, id, q));
  refresh();
}

export async function markInterested(requestId: string, formData: FormData) {
  const repo = await getRepo();
  const { id, n } = await mechanic();
  await n.ownRecords({ requestId });
  const r = repo.getRequest(requestId);
  if (!r || !r.matchedMechanicIds.includes(id)) return;
  await orBack(`/mechanic/requests/${requestId}`, () => repo.markInterested(requestId, id, str(formData, "note")));
  refresh();
  // Straight into the estimate: interest and estimate are one step.
  redirect(`/mechanic/requests/${requestId}#estimate`);
}

export async function submitQuote(requestId: string, formData: FormData) {
  const repo = await getRepo();
  const { id } = await matchedRequest(requestId);
  const draft = str(formData, "intent") === "draft";
  if (!draft) {
    // Sending needs a complete basic profile (lib/domain/eligibility.ts); verification is shown to customers, not required. Drafts are always allowed.
    if (!eligibility(toPublicProfile(repo.getMechanicSources(id))).eligible) redirect(`/mechanic/requests/${requestId}?blocked=1#estimate`);
  }
  await orBack(`/mechanic/requests/${requestId}#estimate`, () => repo.submitQuote({
    requestId,
    mechanicId: id,
    laborCents: cents(formData, "labor"),
    diagnosticFeeCents: cents(formData, "diagnosticFee"),
    travelFeeCents: cents(formData, "travelFee"),
    partsIncluded: str(formData, "partsIncluded") === "yes",
    partsEstimateCents: cents(formData, "partsEstimate"),
    durationHours: Number(str(formData, "duration")) || 1,
    availableOn: str(formData, "availableOn"),
    serviceMode: "mobile",
    scope: str(formData, "scope"),
    notes: str(formData, "notes") || undefined,
  }, { draft }));
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
  /** Always "mobile": the mechanic goes to the car. Kept so older drafts still load. */
  serviceMode: "mobile";
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
  const repo = await getRepo();
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
    if (!eligibility(toPublicProfile(repo.getMechanicSources(id))).eligible) return { ok: false, error: "Finish your profile (service area, repairs, pricing, availability) to send estimates. Your draft is saved." };
    if (!laborCents) return { ok: false, error: "Add at least one labor line with a price." };
    if (!scope) return { ok: false, error: "Describe the scope of work." };
    if (!slot) return { ok: false, error: "Pick the date and time you can do it." };
  }
  const expires = /^\d{4}-\d{2}-\d{2}$/.test(text(input.expiresOn)) ? text(input.expiresOn) : undefined;
  try {
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
      serviceMode: "mobile",
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
  } catch (e) {
    // Accepted, withdrawn or closed since the builder was opened: say so instead of saving.
    if (e instanceof LifecycleError) return { ok: false, error: e.message };
    throw e;
  }
  refresh();
  if (intent === "send") redirect(`/mechanic/requests/${requestId}?sent=1#estimate`);
  return { ok: true, savedAt: new Date().toISOString() };
}

export async function answerQuoteQuestion(quoteId: string, index: number, formData: FormData) {
  const repo = await getRepo();
  const id = await mechanicId();
  await orBack("/mechanic/quotes", () => repo.answerQuoteQuestion(quoteId, id, index, str(formData, "answer")));
  refresh();
}

// ---------------------------------------------------------------- jobs
async function myJob(jobId: string) {
  const repo = await getRepo();
  const { id, n } = await mechanic();
  await n.ownRecords({ jobId });
  const job = repo.getJob(jobId);
  if (!job || job.mechanicId !== id) throw new Error("Not your job.");
  return job;
}

/** Every job action: this mechanic's own job, and the rules decide inside the transaction. */
async function onJob(jobId: string, fn: (repo: Awaited<ReturnType<typeof getRepo>>, mechanicId: string) => unknown, hash = "") {
  const repo = await getRepo();
  const id = await mechanicId();
  await orBack(`/mechanic/jobs/${jobId}${hash}`, async () => {
    await fn(repo, id);
  });
  refresh();
  revalidatePath(`/customer/jobs/${jobId}`);
}

export async function startJob(jobId: string) {
  await onJob(jobId, (repo, id) => repo.startJob(jobId, id));
}

/** Mechanic marks complete; the customer confirms, which creates the Platform Verified entry. */
export async function markJobDone(jobId: string, formData: FormData) {
  const raw = str(formData, "finalAmount");
  const paid = str(formData, "paid");
  await onJob(jobId, (repo, id) =>
    repo.markJobDone(
      jobId,
      id,
      raw ? cents(formData, "finalAmount") : undefined,
      str(formData, "completionNotes") || undefined,
      {
        engine: str(formData, "confirm_engine") || undefined,
        transmission: str(formData, "confirm_transmission") || undefined,
        drivetrain: str(formData, "confirm_drivetrain") || undefined,
      },
      paid === "paid" || paid === "not_paid" ? { status: paid, amountCents: str(formData, "paidAmount") ? cents(formData, "paidAmount") : raw ? cents(formData, "finalAmount") : undefined } : undefined,
    ),
  );
}

export async function cancelJobAsMechanic(jobId: string, formData?: FormData) {
  await onJob(jobId, (repo, id) => repo.cancelJob(jobId, { role: "mechanic", mechanicId: id }, reasonOf(formData)));
}

export async function proposeNewTimeAsMechanic(jobId: string, formData: FormData) {
  const date = str(formData, "date");
  const time = str(formData, "time");
  const slot = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) ? { date, time } : undefined;
  await onJob(jobId, (repo, id) => repo.proposeReschedule(jobId, { role: "mechanic", mechanicId: id }, slot ? slotLabel(slot) : str(formData, "when"), slot, str(formData, "note")), "#reschedule");
}

export async function answerNewTimeAsMechanic(jobId: string, accept: boolean) {
  await onJob(jobId, (repo, id) => repo.respondReschedule(jobId, { role: "mechanic", mechanicId: id }, accept), "#reschedule");
}

export async function reportPaymentAsMechanic(jobId: string, formData: FormData) {
  const paid = str(formData, "paid");
  if (paid !== "paid" && paid !== "not_paid") return;
  const raw = str(formData, "paidAmount");
  await onJob(jobId, (repo, id) => repo.reportPayment(jobId, { role: "mechanic", mechanicId: id }, { status: paid, amountCents: raw ? cents(formData, "paidAmount") : undefined }), "#payment");
}

export async function saveJobNotes(jobId: string, formData: FormData) {
  const repo = await getRepo();
  await myJob(jobId);
  await repo.setJobNotes(jobId, str(formData, "notes"));
  refresh();
}

/** Private notes about the mechanic's own customers. */
export async function saveCustomerNote(customerId: string, formData: FormData) {
  const repo = await getRepo();
  const { id, n } = await mechanic();
  await n.mechanicCustomer(customerId);
  const isMine = repo.listMechanicCustomers(id).some((c) => c.customer.id === customerId);
  if (!isMine) return;
  await repo.setCustomerNote(id, customerId, str(formData, "note"));
  refresh();
}

export async function updatePricing(formData: FormData) {
  const repo = await getRepo();
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
  const repo = await getRepo();
  const id = await mechanicId();
  await orBack(`/mechanic/jobs/${jobId}`, () => repo.confirmAppointment(jobId, id));
  refresh();
}

const PHOTO_KINDS = ["before", "after", "parts", "completed", "diagnostic", "vehicle"] as const;

/** Attach photos the mechanic just uploaded to a job. Only their own uploads, only repair-photo tags. */
export async function attachJobPhotos(jobId: string, items: { id: string; kind: string; caption?: string }[]) {
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "mechanic") throw new Error("Switch to your mechanic account to do this.");
  await myJob(jobId);
  const media = await Promise.all(items.map((it) => getMedia(repo.scope, it.id)));
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
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "mechanic") throw new Error("Switch to your mechanic account to do this.");
  const mid = s.mechanicId;
  await (await needs(s)).ownSources();
  const rec = repo.getMechanicSources(mid).pastRepairs.find((r) => r.id === pastRepairId);
  if (!rec) throw new Error("Not your repair record.");
  const media = await Promise.all(items.map((it) => getMedia(repo.scope, it.id)));
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
  const repo = await getRepo();
  const id = await mechanicId();
  const note = str(formData, "note");
  if (!note) return;
  await orBack(`/mechanic/jobs/${jobId}`, () => repo.recordDiagnosis(jobId, id, note, str(formData, "matches") !== "no"));
  refresh();
  revalidatePath(`/customer/jobs/${jobId}`);
}

export async function requestScopeChange(jobId: string, formData: FormData) {
  const repo = await getRepo();
  const id = await mechanicId();
  const description = str(formData, "description");
  if (!description) return;
  await orBack(`/mechanic/jobs/${jobId}`, () => repo.requestScopeChange(jobId, id, description, cents(formData, "extra")));
  refresh();
  revalidatePath(`/customer/jobs/${jobId}`);
}
