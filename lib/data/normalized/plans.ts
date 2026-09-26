import type { Reader } from "./reader";
import { attachCounts } from "../evidence";
import { findArea } from "@/lib/domain/areas";
import type { Mutation } from "../repository";
import type { Quote, RepairRequest } from "@/lib/domain/types";
import { toPublicProfile } from "@/lib/domain/public-profile";
import { eligibility } from "@/lib/domain/eligibility";

/**
 * What each write reads, inside its own database transaction, before the domain rules run
 * (lib/data/mock/repository.ts). The rules then re-check ownership, state and versions on
 * exactly these rows; `Reader.closeForWrite` adds the records around them (a request's
 * estimates and jobs, the accounts notifications go to…), and the commit compares every
 * changed row's version, so a concurrent change anywhere in that set re-runs the write.
 *
 * Matching (a new request, or anything that can make a mechanic bookable) reads only
 * bookable candidates and their evidence, never every mechanic.
 */
type A = unknown[];
export type Plan = (r: Reader) => Promise<void>;

/** Candidates whose evidence is read per round of queries (small enough for index lookups). */
export const EVIDENCE_BATCH = 100;

/** How many requests still waiting for a mechanic one write will try to match. Oldest first; the rest wait for the next such write. */
export const WAITING_BATCH = 200;

/**
 * Bookable candidates (basic profile complete, verified or not) for the matching rule
 * (qualifiedMechanics): their rows, the records behind their checks, and their verified-repair
 * counts from the database. Never their repair documents. For one request, only mechanics who
 * could qualify for it are read (they do that repair type or have verified work on the repair or make).
 */
export async function loadPool(r: Reader, opts: { relevantTo?: { category: string; make: string; area?: { lat: number; lng: number } } } = {}) {
  const ids = await r.bookableCandidateIds({ relevantTo: opts.relevantTo });
  for (let i = 0; i < ids.length; i += EVIDENCE_BATCH) {
    const batch = ids.slice(i, i + EVIDENCE_BATCH);
    await Promise.all([r.byIds("mechanics", batch, "full"), r.checkRecords(batch, "full")]);
    const facts = await r.evidenceFacts(batch, { pairs: true });
    attachCounts(r.slice.db, new Map([...facts].map(([id, f]) => [id, { pairs: f.pairs, total: f.total }])));
  }
  return ids;
}

async function matchWaiting(r: Reader) {
  await r.waitingRequests(WAITING_BATCH);
  await loadPool(r);
}

const job = (i = 0) => async (r: Reader, a: A) => void (await r.jobs([a[i] as string]));
const quote = (i = 0) => async (r: Reader, a: A) => void (await r.quotes([a[i] as string]));
const request = (i = 0) => async (r: Reader, a: A) => void (await r.requests([a[i] as string]));
const mechanic = (i = 0) => async (r: Reader, a: A) => void (await r.byIds("mechanics", [a[i] as string]));
const user = (i = 0) => async (r: Reader, a: A) => void (await r.user(a[i] as string));

/** Evidence of every mechanic a write's eligibility checks will look at. */
async function sourcesOf(r: Reader, ids: string[]) {
  await r.sources(ids, "full");
}

export const PLANS: Record<Mutation, (r: Reader, a: A) => Promise<void>> = {
  // ---- mechanic profile and evidence
  async upsertMechanicProfile(r, [input]) {
    const i = input as { id?: string; userId?: string; displayName: string };
    if (i.id) await r.byIds("mechanics", [i.id]);
    if (i.userId) await Promise.all([r.user(i.userId), r.mechanicByUser(i.userId)]);
    const base = i.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    // The slug check reads only names that could collide.
    await r.load("mechanics", r.sql`slug = ${base} or slug like ${`${base.replace(/[\\%_]/g, "\\$&")}-%`}`, "full", r.sql`limit 200`);
    // New or edited, the profile may now fit requests that are waiting (onboarding publishes it all at once).
    await matchWaiting(r);
  },
  async updatePricing(r, [mid]) {
    await r.byIds("mechanics", [mid as string]);
    await matchWaiting(r);
  },
  startScreening: mechanic(),
  async refreshScreening(r, [mid]) {
    await r.mechanics([mid as string], "full");
    await matchWaiting(r);
  },
  submitCredential: mechanic(),
  submitEmployment: mechanic(),
  submitInsurance: mechanic(),
  async resubmit(r, [vid]) {
    await r.verifications([vid as string]);
  },
  addPastRepair: mechanic(),
  async requestCustomerConfirmation(r, [repairId]) {
    await Promise.all([r.byIds("pastRepairs", [repairId as string]), r.load("verifications", r.sql`subject_id = ${repairId as string}`)]);
  },
  async respondToConfirmation(r, [token]) {
    const c = await r.confirmationByToken(token as string);
    if (c[0]) await Promise.all([r.byIds("pastRepairs", [String(c[0].pastRepairId)]), r.load("verifications", r.sql`subject_id = ${String(c[0].pastRepairId)}`)]);
  },
  async addTestScreening(r, [mid]) {
    await r.mechanics([mid as string], "full");
    await matchWaiting(r);
  },

  // ---- requests
  async declineRequest(r, [rid, mid]) {
    await Promise.all([r.requests([rid as string]), r.byIds("mechanics", [mid as string])]);
  },
  async forwardRequest(r, [rid, mids]) {
    await Promise.all([r.requests([rid as string]), r.byIds("mechanics", mids as string[])]);
  },
  async askQuestion(r, [rid, mid]) {
    await Promise.all([r.requests([rid as string]), r.byIds("mechanics", [mid as string])]);
  },
  async markInterested(r, [rid, mid]) {
    await Promise.all([r.requests([rid as string]), r.byIds("mechanics", [mid as string])]);
  },
  async submitQuote(r, [input]) {
    const q = input as Pick<Quote, "requestId" | "mechanicId">;
    await Promise.all([r.requests([q.requestId]), r.byIds("mechanics", [q.mechanicId])]);
  },
  async createRequest(r, [input]) {
    const i = input as RepairRequest & { directTo?: string; vehicle?: unknown };
    await Promise.all([
      r.customers([i.customerId]),
      i.vehicleId ? r.vehicles([i.vehicleId]) : undefined,
      i.idempotencyKey ? r.load("requests", r.sql`customer_id = ${i.customerId} and idempotency_key = ${i.idempotencyKey}`) : undefined,
      r.byIds("mechanics", [i.directTo, i.rebookOf]),
    ]);
    if (!i.directTo && !i.rebookOf) {
      // The car's make: the one being added, or the saved car read above.
      const make = (i.vehicle as { make?: string } | undefined)?.make ?? r.slice.db.vehicles.find((v) => v.id === i.vehicleId)?.make ?? "";
      await loadPool(r, { relevantTo: { category: i.repairCategory, make, area: findArea(i.location?.area) } });
    }
  },
  async updateRequest(r, [rid, edit]) {
    const got = await r.requests([rid as string]);
    const req = got[0] as unknown as RepairRequest | undefined;
    if (!req || req.matchedMechanicIds.length) return;
    // Exactly what the edit will set (RepositoryCore.updateRequest takes all three from the edit).
    const e = edit as { repairCategory: string; area?: string; serviceMode: string };
    const [v] = await r.vehicles([req.vehicleId]);
    await loadPool(r, { relevantTo: { category: e.repairCategory, make: String(v?.make ?? ""), area: findArea(e.area) } });
  },
  cancelRequest: request(),
  async rematchRequest(r, [rid]) {
    const got = await r.requests([rid as string]);
    const req = got[0] as unknown as RepairRequest | undefined;
    if (!req) return;
    const [v] = await r.vehicles([req.vehicleId]);
    await loadPool(r, { relevantTo: { category: req.repairCategory, make: String(v?.make ?? ""), area: findArea(req.location.area) } });
  },
  respondToQuestion: request(),

  // ---- estimates
  markQuoteViewed: quote(),
  declineQuote: quote(),
  askAboutQuote: quote(),
  answerQuoteQuestion: quote(),
  async acceptQuote(r, [qid]) {
    const q = await r.quotes([qid as string]);
    if (q[0]) await sourcesOf(r, [String(q[0].mechanicId)]);
  },

  // ---- jobs
  async startJob(r, [jid]) {
    const j = await r.jobs([jid as string]);
    if (j[0]) await sourcesOf(r, [String(j[0].mechanicId)]);
  },
  markJobDone: job(),
  reopenJob: job(),
  proposeReschedule: job(),
  respondReschedule: job(),
  reportPayment: job(),
  completeJob: job(),
  async cancelJob(r, [jid]) {
    const j = await r.jobs([jid as string]);
    if (!j[0]) return;
    // A mechanic's cancellation reopens estimates from other mechanics that are still eligible.
    const quotes = await r.quotesOfRequests([String(j[0].requestId)]);
    await sourcesOf(r, quotes.map((q) => String(q.mechanicId)));
  },
  confirmAppointment: job(),
  recordDiagnosis: job(),
  requestScopeChange: job(),
  respondScopeChange: job(),
  addJobPhotos: job(),
  setJobNotes: job(),
  submitReview: job(),
  updateReview: job(),
  async addRepairPhotos(r, [id]) {
    await r.byIds("pastRepairs", [id as string]);
  },

  // ---- support
  async createSupportReport(r, [input]) {
    const uid = (input as { userId?: string }).userId;
    if (uid) await r.user(uid);
  },
  async addSupportMessage(r, [rid]) {
    await r.supportCases({ ids: [rid as string], limit: 1 });
  },
  async updateSupportCase(r, [rid, staffId]) {
    await Promise.all([r.supportCases({ ids: [rid as string], limit: 1 }), r.user(staffId as string)]);
  },

  // ---- staff
  async decideVerification(r, [vid, decision, reviewerId]) {
    const v = await r.verifications([vid as string]);
    await r.user(reviewerId as string);
    if (!v[0]) return;
    await Promise.all([r.byIds("screenings", [String(v[0].subjectId)]), r.byIds("pastRepairs", [String(v[0].subjectId)]), r.byIds("mechanics", [String(v[0].mechanicId)])]);
    if (decision === "verified") await matchWaiting(r);
  },

  // ---- customer odds and ends
  async saveDraft(r, [cid]) {
    await r.draftOf(cid as string);
  },
  async clearDraft(r, [cid]) {
    await r.draftOf(cid as string);
  },
  async toggleSaved(r, [cid, mid]) {
    await Promise.all([r.customers([cid as string]), r.byIds("mechanics", [mid as string]), r.savedOf(cid as string, mid as string)]);
  },
  async addVehicle(r, [cid]) {
    await r.customers([cid as string]);
  },
  async updateVehicle(r, [vid]) {
    await r.vehicles([vid as string]);
  },
  async setCustomerNote(r, [mid, cid]) {
    await Promise.all([r.byIds("mechanics", [mid as string]), r.customers([cid as string]), r.notesOf(mid as string, [cid as string])]);
  },

  // ---- accounts and notifications
  async createUser(r, [input]) {
    const id = (input as { id?: string }).id;
    if (id) await Promise.all([r.user(id), r.customerByUser(id)]);
  },
  async addCustomerProfile(r, [uid]) {
    await Promise.all([r.user(uid as string), r.customerByUser(uid as string)]);
  },
  updateUser: user(),
  grantAdmin: user(),
  notify: user(),
  async markNotificationsRead(r, [uid, mode]) {
    await Promise.all([r.user(uid as string), r.notifications(uid as string, mode as string, { unreadOnly: true, limit: 499 })]);
  },
};

/** The exact bookable rule over loaded candidates (the prefilter is only a superset). */
export function bookableIds(db: import("../mock/seed").DB, ids: string[], sources: (id: string) => Parameters<typeof toPublicProfile>[0], now = new Date()) {
  const have = new Set(db.mechanics.map((m) => m.id));
  return ids.filter((id) => have.has(id) && eligibility(toPublicProfile(sources(id), now)).eligible);
}
