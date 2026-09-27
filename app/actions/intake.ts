"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getRepo } from "@/lib/data";
import { getSession, getSessionId, needs } from "@/lib/session";
import { stepErrors, type IntakeDraft } from "@/lib/domain/intake-draft";
import { draftToRequest } from "@/lib/domain/intake-preview";
import { resolveSpec } from "@/lib/vehicles/resolve";
import { VEHICLE_MAKES, type RepairMedia } from "@/lib/domain/types";

async function customerId() {
  const s = await getSession();
  if (s.role !== "customer") throw new Error("Log in with a customer account to do this.");
  return s.customerId;
}

/** The signed-in customer, with their own cars, draft and (optionally) one of their requests loaded. */
async function customerWith(what: { requestId?: string } = {}) {
  const s = await getSession();
  if (s.role !== "customer") throw new Error("Log in with a customer account to do this.");
  const n = await needs(s);
  await Promise.all([n.customerVehicleList(), n.customerDraft(), what.requestId ? n.ownRecords({ requestId: what.requestId }) : undefined]);
  return s.customerId;
}

/** Autosave. Called on every step change and when the customer taps "Save and finish later". */
export async function saveIntakeDraft(draft: IntakeDraft) {
  const repo = await getRepo();
  const cid = await customerWith();
  const first = !repo.getDraft(cid);
  await repo.saveDraft(cid, draft);
  if (first) repo.track("repair_request_started", { actorId: cid, mechanicId: draft.directTo ?? draft.rebookOf, session: await getSessionId() });
  return { savedAt: new Date().toISOString() };
}

export async function discardIntakeDraft() {
  const repo = await getRepo();
  const cid = await customerId();
  await repo.clearDraft(cid);
  revalidatePath("/customer/requests/new");
  revalidatePath("/customer");
}

/** Media attached to a draft must belong to the uploader; ids come from /api/media. */
function cleanMedia(list: RepairMedia[]): RepairMedia[] {
  return list.filter((m) => m && typeof m.id === "string" && typeof m.url === "string" && m.url.startsWith("/api/media/"));
}

export async function submitIntake(draft: IntakeDraft): Promise<{ errors: string[] } | void> {
  const repo = await getRepo();
  const cid = await customerWith();
  const hasSaved = repo.listVehicles(cid).length > 0;
  const errors = [0, 1, 2, 3].flatMap((st) => stepErrors(draft, st, hasSaved));
  if (errors.length) return { errors };

  const saved = repo.listVehicles(cid);
  const { fields, vehicle: v, isNewVehicle } = draftToRequest(draft, cid, saved);
  // The structured spec is rebuilt here from the choices, not taken from the browser.
  const spec = await resolveSpec(draft.vehicle.choice);
  let vehicle: Parameters<typeof repo.createRequest>[0]["vehicle"];
  if (isNewVehicle) {
    if (!VEHICLE_MAKES.includes(v.make)) return { errors: ["Choose the make."] };
    const { id: _id, customerId: _c, ...rest } = v;
    void _id;
    void _c;
    vehicle = { ...rest, spec };
  } else {
    // Keep the saved car current: mileage, VIN, transmission and configuration if newly given.
    const existing = repo.getVehicle(draft.vehicleId)!;
    await repo.updateVehicle(existing.id, {
      mileage: v.mileage ?? existing.mileage,
      vin: v.vin ?? existing.vin,
      transmission: v.transmission ?? existing.transmission,
      ...(spec ? { spec } : {}),
    });
  }
  const category = fields.repairCategory;
  const req = await repo.createRequest({
    customerId: cid,
    vehicleId: isNewVehicle ? "" : draft.vehicleId,
    vehicle,
    ...fields,
    media: cleanMedia(fields.media),
    rebookOf: draft.rebookOf,
    directTo: draft.directTo,
    idempotencyKey: typeof draft.key === "string" ? draft.key.slice(0, 64) : undefined,
  });
  await repo.clearDraft(cid);
  repo.track("repair_request_completed", {
    actorId: cid,
    mechanicId: draft.directTo,
    category,
    categorySource: fields.categorySource,
    media: req.media.length,
    session: await getSessionId(),
    rebook: Boolean(draft.rebookOf),
  });
  if (draft.rebookOf) repo.track("repeat_booking", { actorId: cid, mechanicId: draft.rebookOf, stage: "request" });
  redirect(`/customer/requests/${req.id}`);
}

export async function respondToMechanicQuestion(requestId: string, questionIndex: number, response: string, attachments: RepairMedia[]) {
  const repo = await getRepo();
  const cid = await customerWith({ requestId });
  const r = repo.getRequest(requestId);
  if (!r || r.customerId !== cid) return;
  await repo.respondToQuestion(requestId, questionIndex, response, cleanMedia(attachments).map((m) => ({ ...m, tag: "answer" as const })));
  revalidatePath(`/customer/requests/${requestId}`);
}
