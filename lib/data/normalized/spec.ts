import type { DB } from "../mock/seed";
import type { AuditEntry } from "@/lib/domain/transitions";
import { quoteTotals } from "@/lib/domain/quote";

/**
 * How each collection of the domain model maps onto the normalized live tables
 * (supabase/migrations/0004_live_normalized.sql): the row's typed columns, and the
 * child rows derived from lists inside the record. The record itself is kept in the
 * row's `data` jsonb, so the domain layer reads exactly what it wrote; the typed
 * columns and child tables are what the database constrains.
 */

type Doc = Record<string, unknown>;
export type Row = Record<string, unknown>;

export interface ChildSpec {
  table: string;
  /** Primary-key columns (including the parent column). */
  pk: string[];
  parentCol: string;
  /**
   * append: rows are only ever added (history, estimate versions, edits, messages); an
   *   existing row must match what's being written, or the write is refused.
   * upsert: rows are inserted or updated in place (the table's triggers police changes);
   *   rows no longer present are removed.
   * replace: the set is rewritten (simple lookup sets like roles or categories).
   */
  mode: "append" | "upsert" | "replace";
  rows(doc: Doc): Row[];
}

export interface Spec {
  collection: keyof DB;
  table: string;
  /** The row-version column used for compare-and-swap. */
  versionCol: "version" | "row_version";
  /** Map-shaped collections (drafts, notes, shares) are stored one row per entry. */
  map?: true;
  id(doc: Doc): string;
  cols(doc: Doc): Row;
  children?: ChildSpec[];
}

const s = (v: unknown) => (v === undefined || v === null ? null : String(v));
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const arr = <T = Doc>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);

const history = (entity: "request" | "quote" | "job" | "support_case"): ChildSpec => ({
  table: "lv_history",
  pk: ["entity_type", "entity_id", "seq"],
  parentCol: "entity_id",
  mode: "append",
  rows: (d) =>
    arr<AuditEntry>(d.history).map((h, seq) => ({ entity_type: entity, entity_id: d.id, seq, at: h.at, actor: h.by, action: h.action, detail: h.detail ?? null })),
});

/** Estimate versions: every sent version (earlier ones from `revisions`, plus the current one). */
function quoteVersionRows(d: Doc): Row[] {
  const rows: Row[] = arr(d.revisions).map((r) => ({ quote_id: d.id, version: r.version, total_cents: r.totalCents, data: r }));
  // Drafts were never sent, so they have no version yet.
  if (d.status !== "draft") {
    const t = quoteTotals(d as never).total;
    const version = (d.version as number | undefined) ?? 1;
    if (!rows.some((r) => r.version === version)) {
      rows.push({
        quote_id: d.id,
        version,
        total_cents: t,
        data: {
          version,
          totalCents: t,
          laborCents: d.laborCents,
          partsEstimateCents: d.partsEstimateCents,
          diagnosticFeeCents: d.diagnosticFeeCents,
          travelFeeCents: d.travelFeeCents,
          partsIncluded: d.partsIncluded,
          scope: d.scope,
          availableOn: d.availableOn,
          sentAt: d.revisedAt ?? d.createdAt,
        },
      });
    }
  }
  return rows;
}

export const SPECS: Spec[] = [
  {
    collection: "users",
    table: "lv_users",
    versionCol: "version",
    id: (d) => String(d.id),
    cols: (d) => ({ email: String(d.email ?? ""), name: String(d.name ?? ""), demo: d.demo === true }),
    children: [{ table: "lv_user_roles", pk: ["user_id", "role"], parentCol: "user_id", mode: "replace", rows: (d) => arr<string>(d.roles).map((role) => ({ user_id: d.id, role })) }],
  },
  { collection: "customers", table: "lv_customers", versionCol: "version", id: (d) => String(d.id), cols: (d) => ({ user_id: d.userId }) },
  { collection: "vehicles", table: "lv_vehicles", versionCol: "version", id: (d) => String(d.id), cols: (d) => ({ customer_id: d.customerId, year: n(d.year), make: s(d.make), model: s(d.model) }) },
  {
    collection: "mechanics",
    table: "lv_mechanics",
    versionCol: "version",
    id: (d) => String(d.id),
    cols: (d) => ({
      user_id: d.userId,
      slug: d.slug,
      work_model: d.workModel,
      neighborhood: s(d.neighborhood),
      service_radius_mi: n(d.serviceRadiusMi) ?? 0,
      hourly_rate_cents: n(d.hourlyRateCents) ?? 0,
      diagnostic_fee_cents: n(d.diagnosticFeeCents) ?? 0,
    }),
    children: [
      { table: "lv_mechanic_categories", pk: ["mechanic_id", "category"], parentCol: "mechanic_id", mode: "replace", rows: (d) => [...new Set(arr<string>(d.declaredRepairCategories))].map((category) => ({ mechanic_id: d.id, category })) },
      { table: "lv_mechanic_makes", pk: ["mechanic_id", "make"], parentCol: "mechanic_id", mode: "replace", rows: (d) => [...new Set(arr<string>(d.declaredMakes))].map((make) => ({ mechanic_id: d.id, make })) },
      {
        table: "lv_mechanic_openings",
        pk: ["mechanic_id", "on_date", "at_time"],
        parentCol: "mechanic_id",
        mode: "replace",
        rows: (d) => {
          const seen = new Set<string>();
          return arr<{ on: string; time: string }>(d.openings)
            .filter((o) => !seen.has(`${o.on}|${o.time}`) && seen.add(`${o.on}|${o.time}`))
            .map((o) => ({ mechanic_id: d.id, on_date: o.on, at_time: o.time ?? "" }));
        },
      },
    ],
  },
  { collection: "screenings", table: "lv_screenings", versionCol: "version", id: (d) => String(d.id), cols: (d) => ({ mechanic_id: d.mechanicId, kind: d.kind, provider: String(d.provider ?? ""), status: d.status }) },
  { collection: "insurance", table: "lv_insurance", versionCol: "version", id: (d) => String(d.id), cols: (d) => ({ mechanic_id: d.mechanicId, expires_on: String(d.expiresOn ?? "") }) },
  { collection: "credentials", table: "lv_credentials", versionCol: "version", id: (d) => String(d.id), cols: (d) => ({ mechanic_id: d.mechanicId }) },
  { collection: "employment", table: "lv_employment", versionCol: "version", id: (d) => String(d.id), cols: (d) => ({ mechanic_id: d.mechanicId }) },
  {
    collection: "verifications",
    table: "lv_verifications",
    versionCol: "version",
    id: (d) => String(d.id),
    cols: (d) => ({ mechanic_id: d.mechanicId, subject_type: d.subjectType, subject_id: d.subjectId, category: d.category, status: d.status, reviewer_id: s(d.reviewerId) }),
  },
  {
    collection: "requests",
    table: "lv_requests",
    versionCol: "version",
    id: (d) => String(d.id),
    cols: (d) => ({ customer_id: d.customerId, vehicle_id: d.vehicleId, status: d.status, idempotency_key: s(d.idempotencyKey) }),
    children: [
      {
        table: "lv_request_invitations",
        pk: ["request_id", "mechanic_id"],
        parentCol: "request_id",
        mode: "upsert",
        rows: (d) => {
          const declined = new Set(arr<string>(d.declinedBy));
          const interested = new Set(arr<{ mechanicId: string }>(d.interested).map((i) => i.mechanicId));
          return [...new Set(arr<string>(d.matchedMechanicIds))].map((mid) => ({ request_id: d.id, mechanic_id: mid, declined: declined.has(mid), interested: interested.has(mid) }));
        },
      },
      {
        table: "lv_request_questions",
        pk: ["request_id", "seq"],
        parentCol: "request_id",
        mode: "upsert",
        rows: (d) =>
          arr<{ mechanicId: string; question: string; response?: string; respondedAt?: string; attachments?: unknown[] }>(d.questions).map((q, seq) => ({
            request_id: d.id,
            seq,
            mechanic_id: q.mechanicId,
            question: q.question,
            response: q.response ?? null,
            responded: Boolean(q.respondedAt || q.response || q.attachments?.length),
          })),
      },
      history("request"),
    ],
  },
  {
    collection: "quotes",
    table: "lv_quotes",
    versionCol: "row_version",
    id: (d) => String(d.id),
    cols: (d) => ({
      request_id: d.requestId,
      mechanic_id: d.mechanicId,
      status: d.status,
      version: d.status === "draft" ? null : ((d.version as number | undefined) ?? 1),
      total_cents: quoteTotals(d as never).total,
      accepted_version: d.status === "accepted" || (d.status === "withdrawn" && d.acceptedVersion !== undefined) ? ((d.acceptedVersion as number | undefined) ?? (d.version as number | undefined) ?? 1) : null,
      accepted_total_cents: d.status === "accepted" || d.acceptedTotalCents !== undefined ? ((d.acceptedTotalCents as number | undefined) ?? quoteTotals(d as never).total) : null,
    }),
    children: [
      { table: "lv_quote_versions", pk: ["quote_id", "version"], parentCol: "quote_id", mode: "append", rows: quoteVersionRows },
      {
        table: "lv_quote_questions",
        pk: ["quote_id", "seq"],
        parentCol: "quote_id",
        mode: "upsert",
        rows: (d) => arr<{ question: string; answer?: string }>(d.customerQuestions).map((q, seq) => ({ quote_id: d.id, seq, question: q.question, answer: q.answer ?? null })),
      },
      history("quote"),
    ],
  },
  {
    collection: "jobs",
    table: "lv_jobs",
    versionCol: "version",
    id: (d) => String(d.id),
    cols: (d) => ({ quote_id: d.quoteId, request_id: d.requestId, mechanic_id: d.mechanicId, customer_id: d.customerId, status: d.status, final_amount_cents: n(d.finalAmountCents) }),
    children: [
      {
        table: "lv_job_extras",
        pk: ["job_id", "seq"],
        parentCol: "job_id",
        mode: "upsert",
        rows: (d) =>
          [...arr<Doc>(d.scopeChangeHistory), ...(d.scopeChange ? [d.scopeChange as Doc] : [])].map((x, seq) => ({
            job_id: d.id,
            seq,
            description: String(x.description ?? ""),
            extra_cents: n(x.extraCents) ?? 0,
            status: x.status,
            requested_at: String(x.requestedAt ?? ""),
            responded_at: s(x.respondedAt),
          })),
      },
      {
        table: "lv_job_reschedules",
        pk: ["job_id"],
        parentCol: "job_id",
        mode: "upsert",
        rows: (d) => {
          const r = d.reschedule as Doc | undefined;
          return r ? [{ job_id: d.id, proposed_by: r.proposedBy, when_text: String(r.when ?? ""), status: r.status, proposed_at: String(r.at ?? ""), responded_at: s(r.respondedAt) }] : [];
        },
      },
      {
        table: "lv_job_payment_reports",
        pk: ["job_id", "side"],
        parentCol: "job_id",
        mode: "upsert",
        rows: (d) => {
          const p = (d.payment ?? {}) as Record<string, Doc | undefined>;
          return (["customer", "mechanic"] as const).flatMap((side) =>
            p[side] ? [{ job_id: d.id, side, status: p[side]!.status, amount_cents: n(p[side]!.amountCents), reported_at: String(p[side]!.at ?? "") }] : [],
          );
        },
      },
      history("job"),
    ],
  },
  {
    collection: "reviews",
    table: "lv_reviews",
    versionCol: "version",
    id: (d) => String(d.id),
    cols: (d) => ({ job_id: d.jobId, mechanic_id: d.mechanicId, overall: n(d.overall) }),
    children: [
      {
        table: "lv_review_edits",
        pk: ["review_id", "seq"],
        parentCol: "review_id",
        mode: "append",
        rows: (d) => arr<{ at: string; overall: number; comment: string }>(d.edits).map((e, seq) => ({ review_id: d.id, seq, overall: e.overall, comment: e.comment ?? "", at: e.at })),
      },
    ],
  },
  { collection: "pastRepairs", table: "lv_past_repairs", versionCol: "version", id: (d) => String(d.id), cols: (d) => ({ mechanic_id: d.mechanicId, customer_id: s(d.customerId), job_id: s(d.jobId) }) },
  { collection: "confirmations", table: "lv_confirmations", versionCol: "version", id: (d) => String(d.id), cols: (d) => ({ past_repair_id: d.pastRepairId, token: d.token }) },
  { collection: "saved", table: "lv_saved", versionCol: "version", id: (d) => `${d.customerId}:${d.mechanicId}`, cols: (d) => ({ customer_id: d.customerId, mechanic_id: d.mechanicId }) },
  { collection: "notifications", table: "lv_notifications", versionCol: "version", id: (d) => String(d.id), cols: (d) => ({ user_id: d.userId, mode: d.mode, kind: d.kind, read: d.read === true }) },
  {
    collection: "supportReports",
    table: "lv_support_cases",
    versionCol: "version",
    id: (d) => String(d.id),
    cols: (d) => ({ user_id: d.userId, job_id: s(d.jobId), request_id: s(d.requestId), status: d.status, reporter_role: s(d.reporterRole) }),
    children: [
      {
        table: "lv_support_messages",
        pk: ["case_id", "seq"],
        parentCol: "case_id",
        mode: "append",
        rows: (d) => arr<{ at: string; from: string; body: string }>(d.messages).map((m, seq) => ({ case_id: d.id, seq, sender: m.from, body: m.body, at: m.at })),
      },
      history("support_case"),
    ],
  },
  // Map-shaped collections, one row per entry.
  { collection: "drafts", table: "lv_drafts", versionCol: "version", map: true, id: (d) => String(d.id), cols: () => ({}) },
  { collection: "customerNotes", table: "lv_customer_notes", versionCol: "version", map: true, id: (d) => String(d.id), cols: (d) => ({ mechanic_id: d.mechanicId, customer_id: d.customerId }) },
  { collection: "profileShares", table: "lv_profile_shares", versionCol: "version", map: true, id: (d) => String(d.id), cols: () => ({}) },
];

/** The records a DB holds, per spec, keyed `collection\0id`. Map entries become small records. */
export function recordsOf(db: DB): Map<string, { spec: Spec; id: string; doc: Doc }> {
  const out = new Map<string, { spec: Spec; id: string; doc: Doc }>();
  for (const spec of SPECS) {
    for (const doc of mapDocs(db, spec)) {
      const id = spec.id(doc);
      out.set(`${spec.collection}\u0000${id}`, { spec, id, doc });
    }
  }
  return out;
}

function mapDocs(db: DB, spec: Spec): Doc[] {
  if (!spec.map) return (db[spec.collection] as unknown as Doc[]) ?? [];
  if (spec.collection === "drafts") return Object.entries(db.drafts ?? {}).map(([customerId, draft]) => ({ id: customerId, draft }));
  if (spec.collection === "profileShares") return Object.entries(db.profileShares ?? {}).map(([mechanicId, count]) => ({ id: mechanicId, count }));
  return Object.entries(db.customerNotes ?? {}).flatMap(([mechanicId, notes]) =>
    Object.entries(notes).map(([customerId, note]) => ({ id: `${mechanicId}:${customerId}`, mechanicId, customerId, note })),
  );
}

/** Rebuild a DB from rows (the stored `data` of each record). */
export function dbFromRecords(rows: { spec: Spec; data: Doc }[]): DB {
  const db = { profileShares: {}, drafts: {}, customerNotes: {}, events: [] } as unknown as Record<string, unknown>;
  for (const spec of SPECS) if (!spec.map) db[spec.collection] = [];
  for (const { spec, data } of rows) {
    if (!spec.map) (db[spec.collection] as Doc[]).push(data);
    else if (spec.collection === "drafts") (db.drafts as Record<string, unknown>)[String(data.id)] = data.draft;
    else if (spec.collection === "profileShares") (db.profileShares as Record<string, unknown>)[String(data.id)] = data.count;
    else ((db.customerNotes as Record<string, Record<string, string>>)[String(data.mechanicId)] ??= {})[String(data.customerId)] = String(data.note ?? "");
  }
  return db as unknown as DB;
}

/** Put one record into a DB (replacing the one with the same id). */
export function putRecord(db: DB, spec: Spec, doc: Doc) {
  const id = spec.id(doc);
  if (!spec.map) {
    const list = db[spec.collection] as unknown as Doc[];
    const i = list.findIndex((x) => spec.id(x) === id);
    if (i >= 0) list[i] = doc;
    else list.push(doc);
  } else if (spec.collection === "drafts") (db.drafts as Record<string, unknown>)[id] = doc.draft;
  else if (spec.collection === "profileShares") (db.profileShares as Record<string, number>)[id] = Number(doc.count);
  else ((db.customerNotes as Record<string, Record<string, string>>)[String(doc.mechanicId)] ??= {})[String(doc.customerId)] = String(doc.note ?? "");
}

/** Remove one record from a DB. */
export function removeRecord(db: DB, spec: Spec, id: string) {
  if (!spec.map) {
    const list = db[spec.collection] as unknown as Doc[];
    const i = list.findIndex((x) => spec.id(x) === id);
    if (i >= 0) list.splice(i, 1);
  } else if (spec.collection === "drafts") delete (db.drafts as Record<string, unknown>)[id];
  else if (spec.collection === "profileShares") delete (db.profileShares as Record<string, number>)[id];
  else {
    const [m, c] = id.split(":");
    delete db.customerNotes[m]?.[c];
  }
}
