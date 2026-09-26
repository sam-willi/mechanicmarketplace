"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getRepo } from "@/lib/data";
import { getMedia } from "@/lib/data/mock/media-store";
import { getSession, needs } from "@/lib/session";
import { resolveSpec } from "@/lib/vehicles/resolve";
import { EMPTY_CHOICE, type VehicleChoice } from "@/lib/vehicles/choice";
import { REPAIR_CATEGORIES, VEHICLE_MAKES, type RepairCategory, type Urgency, type VehicleMake } from "@/lib/domain/types";
import { findArea } from "@/lib/domain/areas";
import { slotLabel } from "@/lib/domain/schedule";
import { URGENCY } from "@/lib/domain/intake";
import { replacementFor } from "@/lib/replacement";
import { orBack } from "@/lib/lifecycle-action";

async function customerId() {
  const s = await getSession();
  if (s.role !== "customer") throw new Error("Log in with a customer account to do this.");
  return s.customerId;
}

/** The signed-in customer and this request's loaders (their own records only). */
async function customer() {
  const s = await getSession();
  if (s.role !== "customer") throw new Error("Log in with a customer account to do this.");
  return { cid: s.customerId, n: await needs(s) };
}

export async function toggleSaveMechanic(mechanicId: string) {
  const repo = await getRepo();
  const cid = await customerId();
  await repo.toggleSaved(cid, mechanicId);
  revalidatePath("/customer");
}

/**
 * Book one estimate. The form carries the version the customer read; if the mechanic revised it
 * since, or anything else changed (another tab booked someone, the mechanic withdrew), the
 * repository refuses inside the same transaction and the page says why.
 */
export async function acceptQuote(quoteId: string, formData?: FormData) {
  const repo = await getRepo();
  const { cid, n } = await customer();
  await n.ownRecords({ quoteId });
  const q = repo.getQuote(quoteId);
  if (!q || repo.getRequest(q.requestId)?.customerId !== cid) redirect("/customer/requests");
  await n.historyWith(q.mechanicId);
  const version = Number(formData?.get("version"));
  const history = repo.listCustomerHistory(cid).filter((r) => r.mechanicId === q.mechanicId);
  // From the confirmation step: the acknowledgement counts only if the box was ticked. The repository
  // checks it against the mechanic's checks as they are now (and refuses without it), whatever the form says.
  const fromReview = formData?.get("from") === "review";
  const ack = formData?.get("acknowledge") === "yes" ? { version: String(formData.get("ackVersion") ?? ""), snapshot: String(formData.get("ackSnapshot") ?? "") } : undefined;
  const back = fromReview ? `/customer/quotes/${quoteId}/book` : `/customer/quotes/${quoteId}`;
  const job = await orBack(back, () => repo.acceptQuote(quoteId, cid, Number.isFinite(version) && version > 0 ? version : undefined, ack));
  repo.track("mechanic_selected", { actorId: cid, mechanicId: q.mechanicId, quoteId, laborCents: q.laborCents });
  if (history.length) repo.track("repeat_booking", { actorId: cid, mechanicId: q.mechanicId, stage: "booked" });
  revalidatePath("/customer", "layout");
  redirect(`/customer/jobs/${job.id}`);
}

export async function markQuoteViewed(quoteId: string, mechanicId: string) {
  const repo = await getRepo();
  const cid = await customerId();
  repo.track("quote_viewed", { actorId: cid, mechanicId, quoteId });
}

/** Post (or edit) the one verified review for a completed job. Only that job's customer. */
export async function submitReview(jobId: string, formData: FormData) {
  const repo = await getRepo();
  const cid = await customerId();
  const n = (k: string) => Math.max(1, Math.min(5, Number(formData.get(k)) || 5));
  const input = {
    overall: n("overall"),
    communication: n("communication"),
    timeliness: n("timeliness"),
    priceAccuracy: n("priceAccuracy"),
    workmanship: n("workmanship"),
    comment: String(formData.get("comment") ?? "").trim(),
  };
  const back = `/customer/jobs/${jobId}#review`;
  const editing = formData.get("edit") === "1";
  await (await customer()).n.customerJob(jobId);
  await orBack(back, () => (editing ? repo.updateReview(jobId, cid, input) : repo.submitReview(jobId, cid, input)));
  const job = repo.getJob(jobId)!;
  // Optional customer photo: only the reviewer's own image, attached to this repair's record.
  const photoId = String(formData.get("reviewPhotoId") ?? "");
  const media = photoId ? await getMedia(repo.scope, photoId) : undefined;
  const s = await getSession();
  const record = repo.getMechanicSources(job.mechanicId).pastRepairs.find((r) => r.jobId === jobId);
  if (!editing && media && record && s.role === "customer" && media.ownerId === s.userId && media.meta.contentType.startsWith("image/")) {
    await repo.addRepairPhotos(record.id, [{ id: photoId, url: media.meta.url, kind: "after", source: "customer", media: "image", uploadedAt: media.meta.uploadedAt }]);
  }
  if (!editing) repo.track("review_submitted", { actorId: cid, mechanicId: job.mechanicId, jobId });
  revalidatePath(`/customer/jobs/${jobId}`);
  redirect(`/customer/jobs/${jobId}?${editing ? "reviewEdited" : "reviewed"}=1#review`);
}

/** "Paid" / "not paid yet" and an optional amount, entered by the customer. Self-reported; Clutch never handles money. */
function paymentFrom(formData: FormData | undefined) {
  const status = formData?.get("paid");
  if (status !== "paid" && status !== "not_paid") return undefined;
  const raw = String(formData?.get("paidAmount") ?? "").replace(/[^0-9.]/g, "");
  return { status, amountCents: raw ? Math.round(Number(raw) * 100) : undefined } as const;
}

/** Customer confirms the mechanic finished. This is what creates the Platform Verified entry. */
export async function confirmCompletion(jobId: string, formData?: FormData) {
  const repo = await getRepo();
  const cid = await customerId();
  await orBack(`/customer/jobs/${jobId}`, () => repo.completeJob(jobId, cid, paymentFrom(formData)));
  revalidatePath("/customer", "layout");
  redirect(`/customer/jobs/${jobId}?confirmed=1`);
}

/** Not finished: send it back to the mechanic with what's left. */
export async function reopenRepair(jobId: string, formData: FormData) {
  const repo = await getRepo();
  const cid = await customerId();
  await orBack(`/customer/jobs/${jobId}`, () => repo.reopenJob(jobId, cid, String(formData.get("note") ?? "")));
  revalidatePath("/customer", "layout");
  redirect(`/customer/jobs/${jobId}?reopened=1`);
}

export async function cancelRepair(jobId: string) {
  const repo = await getRepo();
  const cid = await customerId();
  await orBack(`/customer/jobs/${jobId}`, () => repo.cancelJob(jobId, { role: "customer", customerId: cid }));
  revalidatePath("/customer", "layout");
  redirect(`/customer/jobs/${jobId}?cancelled=1`);
}

export async function proposeNewTime(jobId: string, formData: FormData) {
  const repo = await getRepo();
  const cid = await customerId();
  const { when, slot } = timeFrom(formData);
  await orBack(`/customer/jobs/${jobId}#reschedule`, () => repo.proposeReschedule(jobId, { role: "customer", customerId: cid }, when, slot, String(formData.get("note") ?? "")));
  revalidatePath(`/customer/jobs/${jobId}`);
  redirect(`/customer/jobs/${jobId}?proposed=1#reschedule`);
}

export async function answerNewTime(jobId: string, accept: boolean) {
  const repo = await getRepo();
  const cid = await customerId();
  await orBack(`/customer/jobs/${jobId}#reschedule`, () => repo.respondReschedule(jobId, { role: "customer", customerId: cid }, accept));
  revalidatePath("/customer", "layout");
  redirect(`/customer/jobs/${jobId}#reschedule`);
}

export async function reportPaymentAsCustomer(jobId: string, formData: FormData) {
  const repo = await getRepo();
  const cid = await customerId();
  const payment = paymentFrom(formData);
  if (!payment) redirect(`/customer/jobs/${jobId}#payment`);
  await orBack(`/customer/jobs/${jobId}#payment`, () => repo.reportPayment(jobId, { role: "customer", customerId: cid }, payment));
  revalidatePath(`/customer/jobs/${jobId}`);
  redirect(`/customer/jobs/${jobId}?paymentSaved=1#payment`);
}

export async function askAboutQuote(quoteId: string, formData: FormData) {
  const repo = await getRepo();
  const cid = await customerId();
  await orBack(`/customer/quotes/${quoteId}`, () => repo.askAboutQuote(quoteId, cid, String(formData.get("question") ?? "")));
  revalidatePath("/customer/quotes");
  revalidatePath(`/customer/quotes/${quoteId}`);
}

/** Parse the vehicle picker's choice; the spec is rebuilt on the server from it. */
async function vehicleFields(f: FormData) {
  let c: VehicleChoice = EMPTY_CHOICE;
  try {
    const raw = JSON.parse(String(f.get("choice") ?? "{}")) as Partial<Record<keyof VehicleChoice, unknown>>;
    c = Object.fromEntries(Object.entries(EMPTY_CHOICE).map(([k, d]) => [k, typeof raw[k as keyof VehicleChoice] === typeof d ? raw[k as keyof VehicleChoice] : d])) as unknown as VehicleChoice;
  } catch {
    /* fall through with an empty choice */
  }
  const vin = c.vin.trim().toUpperCase();
  const spec = await resolveSpec({ ...c, model: c.model.slice(0, 80) });
  const firm = (st?: string) => st && st !== "needs_confirmation";
  const t = firm(spec?.transmission?.status) ? spec?.transmission?.type : undefined;
  return {
    year: Number(c.year) || 2015,
    make: c.make as VehicleMake,
    model: c.model.trim().slice(0, 80),
    trim: firm(spec?.trim?.status) ? spec?.trim?.label : undefined,
    engine: firm(spec?.engine?.status) ? spec?.engine?.label : c.engineText.trim() || undefined,
    transmission: t === "manual" ? ("manual" as const) : t === "automatic" ? ("automatic" as const) : t === "cvt" || t === "ecvt" ? ("cvt" as const) : t === "dct" ? ("dual_clutch" as const) : undefined,
    mileage: Number(String(f.get("mileage") ?? "").replace(/[^0-9]/g, "")) || undefined,
    vin: /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : undefined,
    spec,
  };
}

export async function addVehicle(formData: FormData) {
  const repo = await getRepo();
  const cid = await customerId();
  const v = await vehicleFields(formData);
  if (!VEHICLE_MAKES.includes(v.make) || !v.model) redirect("/customer/vehicles?add=1&error=1");
  const created = await repo.addVehicle(cid, v);
  revalidatePath("/customer", "layout");
  redirect(`/customer/vehicles/${created.id}`);
}

export async function updateVehicle(vehicleId: string, formData: FormData) {
  const repo = await getRepo();
  const { cid, n } = await customer();
  await n.ownRecords({ vehicleId });
  const existing = repo.getVehicle(vehicleId);
  if (!existing || existing.customerId !== cid) return;
  const v = await vehicleFields(formData);
  await repo.updateVehicle(vehicleId, { ...v, make: VEHICLE_MAKES.includes(v.make) ? v.make : existing.make, vin: v.vin ?? existing.vin });
  revalidatePath(`/customer/vehicles/${vehicleId}`);
  redirect(`/customer/vehicles/${vehicleId}?saved=1`);
}

/**
 * After the customer's pick couldn't take the job: send the same request to a
 * suggested mechanic. Only mechanics the server itself suggests are accepted.
 */
export async function sendToReplacement(requestId: string, mechanicId: string) {
  const repo = await getRepo();
  const { cid, n } = await customer();
  await n.customerRequest(requestId);
  const r = repo.getRequest(requestId);
  if (!r || r.customerId !== cid) return;
  const rep = await replacementFor(repo, r);
  if (!rep?.suggestions.some((x) => x.fit.p.id === mechanicId)) redirect(`/customer/requests/${requestId}`);
  await orBack(`/customer/requests/${requestId}`, () => repo.forwardRequest(requestId, [mechanicId], "replacement"));
  repo.track("replacement_sent", { actorId: cid, mechanicId, requestId, kind: "replacement" });
  revalidatePath(`/customer/requests/${requestId}`);
  redirect(`/customer/requests/${requestId}?sent=1`);
}

/** Or send it to a few more mechanics who match the car, repair and area, and compare estimates. */
export async function sendToMoreMechanics(requestId: string) {
  const repo = await getRepo();
  const { cid, n } = await customer();
  await n.customerRequest(requestId);
  const r = repo.getRequest(requestId);
  if (!r || r.customerId !== cid) return;
  const rep = await replacementFor(repo, r);
  if (!rep?.broaden.length) redirect(`/customer/requests/${requestId}`);
  await orBack(`/customer/requests/${requestId}`, () => repo.forwardRequest(requestId, rep!.broaden, "broaden"));
  repo.track("replacement_sent", { actorId: cid, requestId, kind: "broaden", count: rep.broaden.length });
  revalidatePath(`/customer/requests/${requestId}`);
  redirect(`/customer/requests/${requestId}?sent=1`);
}

export async function declineQuote(quoteId: string) {
  const repo = await getRepo();
  const { cid, n } = await customer();
  await n.ownRecords({ quoteId });
  const q = repo.getQuote(quoteId);
  if (!q || repo.getRequest(q.requestId)?.customerId !== cid) redirect("/customer/requests");
  await orBack(`/customer/quotes/${quoteId}`, () => repo.declineQuote(quoteId, cid));
  repo.track("quote_declined", { actorId: cid, mechanicId: q.mechanicId, quoteId });
  revalidatePath(`/customer/requests/${q.requestId}`);
  redirect(`/customer/requests/${q.requestId}`);
}

/** Set the car's photo from something the customer just uploaded (tag "vehicle"). */
export async function setVehiclePhoto(vehicleId: string, mediaId: string) {
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "customer") return;
  await (await needs(s)).ownRecords({ vehicleId });
  const v = repo.getVehicle(vehicleId);
  const m = await getMedia(repo.scope, mediaId);
  if (!v || v.customerId !== s.customerId || !m || m.ownerId !== s.userId || !m.meta.contentType.startsWith("image/")) return;
  await repo.updateVehicle(vehicleId, { photoUrl: m.meta.url });
  revalidatePath(`/customer/vehicles/${vehicleId}`);
  revalidatePath("/customer");
}

export async function reportIssue(formData: FormData) {
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "customer" && s.role !== "mechanic") return;
  const topics = ["work_quality", "no_show", "price", "safety", "damage", "other"] as const;
  const topic = topics.find((t) => t === formData.get("topic")) ?? "other";
  const details = String(formData.get("details") ?? "").trim().slice(0, 4000);
  if (!details) return;
  const jobId = String(formData.get("jobId") ?? "") || undefined;
  const requestId = String(formData.get("requestId") ?? "") || undefined;
  await (await needs(s)).ownRecords({ jobId, requestId });
  const job = jobId ? repo.getJob(jobId) : undefined;
  const req = requestId ? repo.getRequest(requestId) : undefined;
  // Only attach records that belong to the person reporting.
  const ownsJob = job && (s.role === "customer" ? job.customerId === s.customerId : job.mechanicId === s.mechanicId);
  const ownsReq = req && s.role === "customer" && req.customerId === s.customerId;
  const rep = await repo.createSupportReport({ userId: s.userId, reporterRole: s.role, topic, details, jobId: ownsJob ? jobId : undefined, requestId: ownsReq ? requestId : undefined });
  redirect(`${s.role === "customer" ? "/customer" : "/mechanic"}/help?sent=${rep.id}`);
}

export async function respondScopeChange(jobId: string, approve: boolean) {
  const repo = await getRepo();
  const cid = await customerId();
  await orBack(`/customer/jobs/${jobId}`, () => repo.respondScopeChange(jobId, cid, approve));
  revalidatePath(`/customer/jobs/${jobId}`);
}

// ------------------------------------------------------------ requests

async function ownRequest(requestId: string) {
  const repo = await getRepo();
  const { cid, n } = await customer();
  await n.customerRequest(requestId);
  const r = repo.getRequest(requestId);
  if (!r || r.customerId !== cid) redirect("/customer/requests");
  return { repo, cid, r };
}

/** Edit a request no mechanic has responded to yet. Errors come back to the form, never a crash page. */
export async function editRequest(requestId: string, formData: FormData) {
  const { repo, cid } = await ownRequest(requestId);
  const str = (k: string) => String(formData.get(k) ?? "").trim();
  const category = str("repairCategory") as RepairCategory;
  const urgency = str("urgency") as Urgency;
  const back = (error: string) => redirect(`/customer/requests/${requestId}/edit?error=${encodeURIComponent(error)}`);
  if (!REPAIR_CATEGORIES.includes(category)) back("Choose what kind of repair it is.");
  if (!findArea(str("area"))) back("Choose the area the car is in.");
  try {
    await repo.updateRequest(requestId, {
      symptomDescription: str("symptomDescription"),
      repairCategory: category,
      area: str("area"),
      serviceMode: "mobile",
      urgency: URGENCY.some((u) => u.value === urgency) ? urgency : undefined,
      preferredTimes: str("preferredTimes"),
    });
  } catch (e) {
    back((e as Error).message);
  }
  repo.track("request_edited", { actorId: cid, requestId });
  revalidatePath(`/customer/requests/${requestId}`);
  revalidatePath("/customer");
  redirect(`/customer/requests/${requestId}?edited=1`);
}

export async function cancelRequest(requestId: string) {
  const { repo, cid } = await ownRequest(requestId);
  try {
    await repo.cancelRequest(requestId);
  } catch (e) {
    redirect(`/customer/requests/${requestId}?error=${encodeURIComponent((e as Error).message)}`);
  }
  repo.track("request_cancelled", { actorId: cid, requestId });
  revalidatePath("/customer");
  revalidatePath("/customer/requests");
  redirect(`/customer/requests/${requestId}?cancelled=1`);
}

/** "Check again": look for mechanics for a request saved with none. */
export async function rematchRequest(requestId: string) {
  const { repo, cid } = await ownRequest(requestId);
  const n = await repo.rematchRequest(requestId);
  repo.track("request_rematched", { actorId: cid, requestId, found: n });
  revalidatePath(`/customer/requests/${requestId}`);
  redirect(`/customer/requests/${requestId}?checked=${n}`);
}

/** Shared by both apps' help pages (the account's own report only), and the time fields of a reschedule form. */
export async function addReportMessage(reportId: string, formData: FormData) {
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "customer" && s.role !== "mechanic") redirect("/login");
  const back = `/${s.role}/help#report-${reportId}`;
  await orBack(back, () => repo.addSupportMessage(reportId, s.userId, String(formData.get("message") ?? "")));
  revalidatePath(`/${s.role}/help`);
  redirect(back);
}

function timeFrom(formData: FormData) {
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "");
  const slot = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) ? { date, time } : undefined;
  const when = slot ? slotLabel(slot) : String(formData.get("when") ?? "").trim();
  return { when, slot };
}
