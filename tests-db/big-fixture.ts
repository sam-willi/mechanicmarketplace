import type postgres from "postgres";
import { SPECS, type Spec } from "@/lib/data/normalized/spec";
import { jsonCols } from "@/lib/data/normalized/store";
import { AREAS } from "@/lib/domain/areas";
import { REPAIR_CATEGORIES, VEHICLE_MAKES } from "@/lib/domain/types";
import type { DB } from "@/lib/data/mock/seed";

/**
 * A large, fictional, deterministic live marketplace for the targeted-read tests: thousands
 * of mechanics (a small share bookable, plus look-alikes that the candidate prefilter must
 * let through and the exact rule must reject), tens of thousands of requests, estimates,
 * repairs and notifications. Every name is invented; every address is @example.test.
 *
 * Rows go in through the store's own column specs (typed columns and child tables exactly
 * as the app writes them), in bulk, with row triggers off for speed.
 */

type Doc = Record<string, unknown>;
const SPEC = Object.fromEntries(SPECS.map((s) => [s.collection, s])) as Record<keyof DB, Spec>;

/** CLUTCH_FIXTURE_SCALE multiplies the marketplace (e.g. 5 for ~1.4M rows); the heavy customer stays the same. */
const SCALE = Math.max(1, Math.min(20, Number(process.env.CLUTCH_FIXTURE_SCALE) || 1));
export const SIZES = { mechanics: 3000 * SCALE, customers: 4000 * SCALE, requests: 20000 * SCALE, notifications: 50000 * SCALE, support: 2000 * SCALE, heavyRequests: 140, heavyNotifications: 300 };
export const HEAVY_CUSTOMER = "big-c-0000";
export const HEAVY_USER = "big-cu-0000";

/** mulberry32: the same dataset on every run. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number) => String(n).padStart(4, "0");
const day = (base: string, add: number) => new Date(new Date(`${base}T12:00:00Z`).getTime() + add * 86_400_000).toISOString().slice(0, 10);

export interface Fixture {
  counts: Record<string, number>;
  /** Basic profile complete: bookable under the 2026-09-26 policy, verified or not. */
  ready: string[];
  /** Ready AND every check verified. */
  bookable: string[];
  /** Verified identity and background but the latest check was rejected: the prefilter lets them through, the exact rule doesn't. */
  lookAlikes: string[];
}

export async function loadBigFixture(sql: postgres.Sql, today: string): Promise<Fixture> {
  const r = rng(20260926);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const cats = REPAIR_CATEGORIES;
  const makes = VEHICLE_MAKES;
  const langs = ["Spanish", "Korean", "Armenian", "Tagalog"];
  const d: Record<string, Doc[]> = {};
  const push = (c: keyof DB, doc: Doc) => (d[c] ??= []).push(doc);
  const bookable: string[] = [];
  const ready: string[] = [];
  const lookAlikes: string[] = [];
  const far = "2027-12-31";

  // ---------------------------------------------------------------- mechanics
  const mechs: { id: string; userId: string; cats: string[]; makes: string[] }[] = [];
  for (let i = 0; i < SIZES.mechanics; i++) {
    const id = `big-m-${pad(i)}`;
    const userId = `big-mu-${pad(i)}`;
    const area = AREAS[i % AREAS.length];
    // Legacy values on purpose: records from before every mechanic was mobile must read as mobile.
    const workModel = (["shop", "mobile", "both"] as const)[i % 3];
    const mc = [...new Set([pick(cats), pick(cats), pick(cats)])];
    const mm = [...new Set([pick(makes), pick(makes)])];
    mechs.push({ id, userId, cats: mc, makes: mm });
    push("users", { id: userId, roles: ["mechanic"], name: `Fixture Mechanic ${i}`, email: `mech${i}@example.test`, notificationPrefs: { email: true, sms: false, push: true }, createdAt: "2026-01-01" });
    // 40% have finished their profile (availability given); every fully verified one has.
    const isReady = i % 5 < 2 || i % 20 === 0;
    if (isReady) ready.push(id);
    const openings = isReady ? Array.from({ length: Math.floor(r() * 3) }, (_, k) => ({ on: day(today, 1 + Math.floor(r() * 9) + k), time: pick(["8:00 AM", "9:30 AM", "1:00 PM", "4:30 PM"]) })) : [];
    push("mechanics", {
      id, userId, slug: `fixture-mechanic-${i}`, displayName: `Fixture Mechanic ${i}`, firstName: "Fixture", photoUrl: "", city: "Los Angeles",
      neighborhood: area.label, lat: area.lat, lng: area.lng, serviceRadiusMi: 10 + (i % 16), bio: "Fictional test fixture.", workModel,
      hourlyRateCents: 8000 + (i % 9) * 500, diagnosticFeeCents: 5000, fixedPrices: [], availabilityNote: isReady ? "Weekdays" : "", nextAvailable: "Soon",
      nextAvailableOn: day(today, 1 + (i % 12)), openings, languages: i % 4 ? ["English"] : ["English", pick(langs)],
      declaredRepairCategories: mc, declaredMakes: mm, selfReportedClaims: [], joinedAt: "2026-01-01",
    });
    const kinds = ["identity", "background", "driving_record"];
    const isBookable = i % 20 === 0;
    const insuranceLapsed = i % 20 === 5;
    const lookAlike = i % 20 === 10;
    const pending = i % 20 === 15;
    if (isBookable) bookable.push(id);
    if (lookAlike) lookAlikes.push(id);
    if (isBookable || insuranceLapsed || lookAlike || pending) {
      for (const kind of kinds) {
        const sid = `big-scr-${pad(i)}-${kind}`;
        push("screenings", { id: sid, mechanicId: id, kind, provider: "provider-under-test", providerRef: `ref-${i}-${kind}`, status: pending ? "in_progress" : "verified", result: pending ? undefined : "clear", completedAt: pending ? undefined : "2026-01-10", expiresAt: pending ? undefined : far });
        push("verifications", { id: `big-ver-${pad(i)}-${kind}`, mechanicId: id, subjectType: "screening_check", subjectId: sid, category: kind, method: "vendor_screening", provider: "provider-under-test", status: pending ? "in_progress" : "verified", submittedAt: day("2026-01-01", i % 200), verifiedAt: pending ? undefined : "2026-01-10", expiresAt: pending ? undefined : far, notes: "Fixture." });
      }
      if (lookAlike) push("screenings", { id: `big-scr-${pad(i)}-identity-2`, mechanicId: id, kind: "identity", provider: "provider-under-test", providerRef: `ref-${i}-again`, status: "failed", result: "consider", completedAt: "2026-06-01" });
      const insId = `big-ins-${pad(i)}`;
      const expiresOn = insuranceLapsed ? day(today, -3) : far;
      push("insurance", { id: insId, mechanicId: id, carrier: "Fixture Mutual", policyLast4: "0000", coverageCents: 100_000_000, documentName: "coi.pdf", effectiveOn: "2026-01-01", expiresOn });
      push("verifications", { id: `big-ver-${pad(i)}-ins`, mechanicId: id, subjectType: "insurance_record", subjectId: insId, category: "insurance", method: "document_review", status: pending ? "under_review" : "verified", submittedAt: day("2026-02-01", i % 200), verifiedAt: pending ? undefined : "2026-02-02", expiresAt: expiresOn, notes: "Fixture." });
    }
    // Staff-review work: credentials pending / needs info / verified and expiring soon.
    if (i % 7 === 0) {
      const cid = `big-cred-${pad(i)}`;
      push("credentials", { id: cid, mechanicId: id, issuer: "ASE", name: "A5 Brakes", code: "A5", issuedOn: "2024-01-01", expiresOn: i % 14 === 0 ? day(today, 12) : "2028-01-01", documentName: "a5.pdf" });
      const st = (["under_review", "needs_more_info", "verified", "failed"] as const)[i % 4];
      push("verifications", { id: `big-ver-${pad(i)}-cred`, mechanicId: id, subjectType: "credential", subjectId: cid, category: "credential", method: "institution_check", status: st, submittedAt: day("2026-03-01", i % 150), verifiedAt: st === "verified" ? day(today, -(i % 10)) : undefined, expiresAt: i % 14 === 0 ? day(today, 12) : "2028-01-01", evidenceSummary: "ASE A5 fixture" });
    }
  }

  // ---------------------------------------------------------------- customers
  const custs: { id: string; userId: string; vehicleId: string; make: string }[] = [];
  for (let i = 0; i < SIZES.customers; i++) {
    const id = `big-c-${pad(i)}`;
    const userId = `big-cu-${pad(i)}`;
    const vehicleId = `big-v-${pad(i)}`;
    const make = pick(makes);
    custs.push({ id, userId, vehicleId, make });
    push("users", { id: userId, roles: ["customer"], name: `Fixture Customer ${i}`, email: `cust${i}@example.test`, notificationPrefs: { email: true, sms: false, push: true }, createdAt: "2026-01-01" });
    push("customers", { id, userId, displayName: `Fixture Customer ${i}`, city: "Los Angeles" });
    push("vehicles", { id: vehicleId, customerId: id, year: 2010 + (i % 14), make, model: "Fixture", vin: `FIXTUREVIN${pad(i)}`, notes: `private note ${i}` });
  }

  // ---------------------------------------------------------------- requests, estimates, jobs
  let q = 0;
  let j = 0;
  for (let i = 0; i < SIZES.requests; i++) {
    const c = i < SIZES.heavyRequests ? custs[0] : custs[1 + Math.floor(r() * (custs.length - 1))];
    const id = `big-r-${String(i).padStart(5, "0")}`;
    const status = pick(["open", "open", "quoted", "booked", "completed", "completed", "completed", "cancelled", "cancelled"] as const);
    const cat = pick(cats);
    // Few distinct days, so many requests share a createdAt: pagination must break ties by id.
    const createdAt = day("2025-10-01", Math.floor(r() * 300));
    const invited = status === "open" && r() < 0.15 ? [] : [...new Set(Array.from({ length: 1 + Math.floor(r() * 3) }, () => pick(mechs).id))];
    const req: Doc = {
      id, customerId: c.id, vehicleId: c.vehicleId, repairCategory: cat, categorySource: "customer", symptomDescription: `Fixture symptom ${i} at 1 Private Way`,
      occurrence: { conditions: [] }, onset: {}, warningLights: [], diagnosticCodes: [], smells: [], recentRepairs: [], customerParts: [],
      location: { serviceMode: pick(["mobile", "shop"]) /* legacy "shop" on purpose */, area: pick(AREAS).key, address: "1 Private Way" }, media: i % 50 === 0 ? [{ id: `big-media-${i}`, url: `/api/media/big-media-${i}`, kind: "photo", tag: "overview" }] : [],
      status, createdAt, matchedMechanicIds: invited, declinedBy: [], interested: [], history: [{ at: `${createdAt}T10:00:00.000Z`, by: "customer", action: "sent" }],
      questions: invited.length && r() < 0.1 ? [{ mechanicId: invited[0], customerId: c.id, question: "Fixture question?", askedAt: createdAt, attachments: [] }] : [],
      ...(invited.length ? {} : { waitingSince: `${createdAt}T10:00:00.000Z` }),
    };
    push("requests", req);
    if (status === "open" || status === "cancelled" || !invited.length) continue;
    const accepted = status === "booked" || status === "completed" ? invited[0] : undefined;
    for (const mid of invited) {
      const qid = `big-q-${String(q++).padStart(5, "0")}`;
      const qst = mid === accepted ? "accepted" : accepted ? "declined" : pick(["submitted", "submitted", "draft"] as const);
      push("quotes", {
        id: qid, requestId: id, mechanicId: mid, laborCents: 20000 + (q % 30) * 1000, diagnosticFeeCents: 5000, travelFeeCents: 0, partsIncluded: true, partsEstimateCents: 9000,
        durationHours: 2, availableOn: "Fixture day · 9:00 AM", serviceMode: "shop", scope: "Fixture scope. Private pricing.", status: qst, createdAt, version: qst === "draft" ? undefined : 1,
        customerQuestions: q % 17 === 0 ? [{ question: "Fixture?", askedAt: createdAt }] : [], ...(qst === "accepted" ? { acceptedVersion: 1, acceptedAt: `${createdAt}T12:00:00.000Z` } : {}),
        ...(qst === "declined" ? { closedReason: "chose_other" } : {}),
      });
      if (mid === accepted) {
        const jid = `big-j-${String(j++).padStart(5, "0")}`;
        const jst = status === "completed" ? "completed" : pick(["scheduled", "in_progress"] as const);
        push("jobs", { id: jid, quoteId: qid, requestId: id, mechanicId: mid, customerId: c.id, vehicleId: c.vehicleId, repairCategory: cat, title: "Fixture repair", status: jst, scheduledFor: "Fixture day", history: [{ at: `${createdAt}T12:00:00.000Z`, by: "customer", action: "booked" }], ...(jst === "completed" ? { completedAt: createdAt, finalAmountCents: 30000 } : {}) });
        if (jst === "completed") {
          push("pastRepairs", { id: `big-pr-${jid}`, mechanicId: mid, source: "platform", jobId: jid, year: 2016, make: c.make, model: "Fixture", repairCategory: cat, title: "Fixture repair", performedOn: createdAt, customerId: c.id, evidence: [], valueCents: 30000, description: "private repair notes" });
          if (j % 3 === 0) push("reviews", { id: `big-rev-${jid}`, mechanicId: mid, kind: "verified_job", jobId: jid, overall: 3 + (j % 3), comment: "Fixture review", authorName: "Fixture C.", createdAt });
        }
      }
    }
  }
  // Evidence volume: earlier repairs per mechanic (customer-confirmed, document, self-reported).
  let pr = 0;
  for (const m of mechs) {
    for (let k = 0; k < 6 + Math.floor(r() * 8); k++) {
      push("pastRepairs", { id: `big-prx-${pr++}`, mechanicId: m.id, source: pick(["customer_confirmed", "document", "self"] as const), year: 2012 + (k % 10), make: r() < 0.6 ? pick(m.makes) : pick(makes), model: pick(["Fixture", "328i", "Civic", "Camry"]), repairCategory: r() < 0.6 ? pick(m.cats) : pick(cats), title: "Fixture earlier repair", performedOn: day("2024-01-01", pr % 600), evidence: [], photos: pr % 97 === 0 ? [{ id: `big-photo-${pr}`, url: `/api/media/big-photo-${pr}`, kind: "after", source: "mechanic" }] : undefined });
    }
  }

  // ---------------------------------------------------------------- notifications and support
  for (let i = 0; i < SIZES.notifications; i++) {
    const heavy = i < SIZES.heavyNotifications;
    const u = heavy ? HEAVY_USER : r() < 0.5 ? pick(custs).userId : pick(mechs).userId;
    const mode = u.startsWith("big-mu") ? "mechanic" : "customer";
    push("notifications", { id: `big-n-${String(i).padStart(5, "0")}`, userId: u, mode, kind: "new_quote", title: `Fixture update ${i}`, href: "/customer", createdAt: `${day("2026-01-01", Math.floor(r() * 250))}T${String(Math.floor(r() * 24)).padStart(2, "0")}:00:00.000Z`, read: r() < 0.7 });
  }
  for (let i = 0; i < SIZES.support; i++) {
    const c = pick(custs);
    push("supportReports", { id: `big-sup-${pad(i)}`, userId: c.userId, reporterRole: "customer", topic: "other", details: `Fixture report ${i}, private details`, createdAt: `${day("2026-01-01", i % 250)}T09:00:00.000Z`, updatedAt: `${day("2026-01-01", i % 250)}T09:00:00.000Z`, status: pick(["open", "in_review", "resolved", "resolved"] as const), messages: [], history: [{ at: "2026-01-01T09:00:00.000Z", by: "customer", action: "report filed" }] });
  }

  // ---------------------------------------------------------------- write it
  // Several test files share one disposable database: the first loads the fixture, the rest reuse it.
  const [loaded] = await sql`select 1 from lv_mechanics where id = ${mechs[0].id}`;
  if (loaded) return { counts: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.length])), ready, bookable, lookAlikes };
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    for (const [collection, docs] of Object.entries(d)) await insertDocs(tx, collection as keyof DB, docs);
  });
  // Bulk-loaded with row triggers off: count the per-mechanic evidence numbers once, as the migration does.
  await sql`select lv_rebuild_mechanic_stats()`;
  for (const t of ["lv_users", "lv_user_roles", "lv_customers", "lv_vehicles", "lv_mechanics", "lv_screenings", "lv_insurance", "lv_credentials", "lv_verifications", "lv_requests", "lv_request_invitations", "lv_request_questions", "lv_quotes", "lv_quote_questions", "lv_jobs", "lv_past_repairs", "lv_reviews", "lv_notifications", "lv_support_cases"]) await sql.unsafe(`analyze ${t}`);
  return { counts: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.length])), ready, bookable, lookAlikes };
}

async function insertDocs(tx: postgres.TransactionSql, collection: keyof DB, docs: Doc[]) {
  const spec = SPEC[collection];
  const batch = async (table: string, rows: Record<string, unknown>[]) => {
    for (let i = 0; i < rows.length; i += 1000) await tx`insert into ${tx(table)} ${tx(rows.slice(i, i + 1000) as never)}`;
  };
  await batch(spec.table, docs.map((doc) => ({ id: spec.id(doc), ...spec.cols(doc), data: tx.json(doc as postgres.JSONValue) })));
  for (const child of spec.children ?? []) await batch(child.table, docs.flatMap((doc) => child.rows(doc).map((row) => jsonCols(tx, row))));
}
