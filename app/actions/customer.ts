"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ready, repo } from "@/lib/data";
import { getMedia } from "@/lib/data/mock/media-store";
import { getSession } from "@/lib/session";
import { eligibility } from "@/lib/domain/eligibility";
import { resolveSpec } from "@/lib/vehicles/resolve";
import { EMPTY_CHOICE, type VehicleChoice } from "@/lib/vehicles/choice";
import { VEHICLE_MAKES, type VehicleMake } from "@/lib/domain/types";
import { replacementFor } from "@/lib/replacement";

async function customerId() {
  const s = await getSession();
  if (s.role !== "customer") throw new Error("Switch to the customer demo persona to do this.");
  return s.customerId;
}

export async function toggleSaveMechanic(mechanicId: string) {
  await ready();
  const cid = await customerId();
  await repo.toggleSaved(cid, mechanicId);
  revalidatePath("/customer");
}

export async function acceptQuote(quoteId: string) {
  await ready();
  const cid = await customerId();
  const q = repo.getQuote(quoteId);
  // Only the customer who owns the request can choose, and only a sent estimate.
  if (!q || q.status !== "submitted" || repo.getRequest(q.requestId)?.customerId !== cid) return;
  const mech = repo.getPublicProfile(repo.getMechanic(q.mechanicId)!.slug)!;
  if (!eligibility(mech).eligible) redirect(`/customer/quotes/${quoteId}?blocked=1`);
  const history = repo.listCustomerHistory(cid).filter((r) => r.mechanicId === q.mechanicId);
  const job = await repo.acceptQuote(quoteId);
  repo.track("mechanic_selected", { actorId: cid, mechanicId: q.mechanicId, quoteId, laborCents: q.laborCents });
  if (history.length) repo.track("repeat_booking", { actorId: cid, mechanicId: q.mechanicId, stage: "booked" });
  redirect(`/customer/jobs/${job.id}`);
}

export async function markQuoteViewed(quoteId: string, mechanicId: string) {
  await ready();
  const cid = await customerId();
  repo.track("quote_viewed", { actorId: cid, mechanicId, quoteId });
}

export async function submitReview(jobId: string, formData: FormData) {
  await ready();
  const cid = await customerId();
  const n = (k: string) => Math.max(1, Math.min(5, Number(formData.get(k)) || 5));
  const job = repo.getJob(jobId);
  // Reviews only from customers who actually hired this mechanic, after the job is confirmed complete.
  if (!job || job.customerId !== cid || job.status !== "completed") return;
  await repo.submitReview(jobId, {
    overall: n("overall"),
    communication: n("communication"),
    timeliness: n("timeliness"),
    priceAccuracy: n("priceAccuracy"),
    workmanship: n("workmanship"),
    comment: String(formData.get("comment") ?? "").trim(),
  });
  // Optional customer photo: only the reviewer's own image, attached to this repair's record.
  const photoId = String(formData.get("reviewPhotoId") ?? "");
  const media = photoId ? await getMedia(photoId) : undefined;
  const s = await getSession();
  const record = repo.getMechanicSources(job.mechanicId).pastRepairs.find((r) => r.jobId === jobId);
  if (media && record && s.role === "customer" && media.ownerId === s.userId && media.meta.contentType.startsWith("image/")) {
    await repo.addRepairPhotos(record.id, [{ id: photoId, url: media.meta.url, kind: "after", source: "customer", media: "image", uploadedAt: media.meta.uploadedAt }]);
  }
  repo.track("review_submitted", { actorId: cid, mechanicId: job.mechanicId, jobId });
  revalidatePath(`/customer/jobs/${jobId}`);
}


async function ownJob(jobId: string) {
  const cid = await customerId();
  const job = repo.getJob(jobId);
  if (!job || job.customerId !== cid) throw new Error("Not your repair.");
  return job;
}

/** Customer confirms the mechanic finished. This is what creates the Platform Verified entry. */
export async function confirmCompletion(jobId: string) {
  await ready();
  const job = await ownJob(jobId);
  if (job.status !== "awaiting_customer") return;
  await repo.completeJob(jobId);
  revalidatePath("/customer", "layout");
  redirect(`/customer/jobs/${jobId}?confirmed=1`);
}

export async function cancelRepair(jobId: string) {
  await ready();
  await ownJob(jobId);
  await repo.cancelJob(jobId, "customer");
  revalidatePath("/customer", "layout");
}

export async function askAboutQuote(quoteId: string, formData: FormData) {
  await ready();
  const cid = await customerId();
  const q = repo.getQuote(quoteId);
  if (!q || repo.getRequest(q.requestId)?.customerId !== cid) return;
  await repo.askAboutQuote(quoteId, String(formData.get("question") ?? ""));
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
  await ready();
  const cid = await customerId();
  const v = await vehicleFields(formData);
  if (!VEHICLE_MAKES.includes(v.make) || !v.model) redirect("/customer/vehicles?add=1&error=1");
  const created = await repo.addVehicle(cid, v);
  revalidatePath("/customer", "layout");
  redirect(`/customer/vehicles/${created.id}`);
}

export async function updateVehicle(vehicleId: string, formData: FormData) {
  await ready();
  const cid = await customerId();
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
  await ready();
  const cid = await customerId();
  const r = repo.getRequest(requestId);
  if (!r || r.customerId !== cid) return;
  const rep = replacementFor(r);
  if (!rep?.suggestions.some((x) => x.fit.p.id === mechanicId)) redirect(`/customer/requests/${requestId}`);
  await repo.forwardRequest(requestId, [mechanicId], "replacement");
  repo.track("replacement_sent", { actorId: cid, mechanicId, requestId, kind: "replacement" });
  revalidatePath(`/customer/requests/${requestId}`);
  redirect(`/customer/requests/${requestId}?sent=1`);
}

/** Or send it to a few more qualified mechanics and compare estimates. */
export async function sendToMoreMechanics(requestId: string) {
  await ready();
  const cid = await customerId();
  const r = repo.getRequest(requestId);
  if (!r || r.customerId !== cid) return;
  const rep = replacementFor(r);
  if (!rep?.broaden.length) redirect(`/customer/requests/${requestId}`);
  await repo.forwardRequest(requestId, rep.broaden, "broaden");
  repo.track("replacement_sent", { actorId: cid, requestId, kind: "broaden", count: rep.broaden.length });
  revalidatePath(`/customer/requests/${requestId}`);
  redirect(`/customer/requests/${requestId}?sent=1`);
}

export async function declineQuote(quoteId: string) {
  await ready();
  const cid = await customerId();
  const q = repo.getQuote(quoteId);
  if (!q || q.status !== "submitted" || repo.getRequest(q.requestId)?.customerId !== cid) return;
  await repo.declineQuote(quoteId);
  repo.track("quote_declined", { actorId: cid, mechanicId: q.mechanicId, quoteId });
  revalidatePath(`/customer/requests/${q.requestId}`);
  redirect(`/customer/requests/${q.requestId}`);
}

/** Set the car's photo from something the customer just uploaded (tag "vehicle"). */
export async function setVehiclePhoto(vehicleId: string, mediaId: string) {
  await ready();
  const s = await getSession();
  if (s.role !== "customer") return;
  const v = repo.getVehicle(vehicleId);
  const m = await getMedia(mediaId);
  if (!v || v.customerId !== s.customerId || !m || m.ownerId !== s.userId || !m.meta.contentType.startsWith("image/")) return;
  await repo.updateVehicle(vehicleId, { photoUrl: m.meta.url });
  revalidatePath(`/customer/vehicles/${vehicleId}`);
  revalidatePath("/customer");
}

export async function reportIssue(formData: FormData) {
  await ready();
  const s = await getSession();
  if (s.role !== "customer" && s.role !== "mechanic") return;
  const topics = ["work_quality", "no_show", "price", "safety", "damage", "other"] as const;
  const topic = topics.find((t) => t === formData.get("topic")) ?? "other";
  const details = String(formData.get("details") ?? "").trim().slice(0, 4000);
  if (!details) return;
  const jobId = String(formData.get("jobId") ?? "") || undefined;
  const requestId = String(formData.get("requestId") ?? "") || undefined;
  const job = jobId ? repo.getJob(jobId) : undefined;
  const req = requestId ? repo.getRequest(requestId) : undefined;
  // Only attach records that belong to the person reporting.
  const ownsJob = job && (s.role === "customer" ? job.customerId === s.customerId : job.mechanicId === s.mechanicId);
  const ownsReq = req && s.role === "customer" && req.customerId === s.customerId;
  const rep = await repo.createSupportReport({ userId: s.userId, topic, details, jobId: ownsJob ? jobId : undefined, requestId: ownsReq ? requestId : undefined });
  redirect(`${s.role === "customer" ? "/customer" : "/mechanic"}/help?sent=${rep.id}`);
}

export async function respondScopeChange(jobId: string, approve: boolean) {
  await ready();
  const cid = await customerId();
  const job = repo.getJob(jobId);
  if (!job || job.customerId !== cid) return;
  await repo.respondScopeChange(jobId, approve);
  revalidatePath(`/customer/jobs/${jobId}`);
}
