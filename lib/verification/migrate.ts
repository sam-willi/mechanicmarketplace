import type { MechanicProfile, ScreeningCheck, User, VerificationRecord } from "@/lib/domain/types";
import { canonStatus, reconstructedHistory, type Actor } from "./model";

/**
 * Backfill for records stored before the canonical model (docs/verification.md, "Migration").
 * Pure: takes the scope's records and returns what to change. Nothing is deleted; every change is
 * labelled on the record itself, so what is and isn't known stays visible.
 *
 *  - statuses → canonical words; a history is reconstructed from the record's own dates;
 *  - a "verified" document review with no stored document is marked `legacy.unbacked` (it stops
 *    counting publicly until resubmitted; the approval stays in its history);
 *  - a check "verified" by the demo stand-in provider in the real marketplace is revoked
 *    (`legacy_unverified_provider`): nothing real ever checked it;
 *  - screenings get canonical statuses;
 *  - every real mechanic gets an email check from their confirmed sign-in.
 */
export interface MigrationPlan {
  updates: { collection: "verifications" | "screenings"; id: string; after: Record<string, unknown>; summary: string }[];
  creates: VerificationRecord[];
}

const OLD = new Set(["not_submitted", "pending", "rejected", "needs_info", "reverification_required"]);
const ACTOR: Actor = { kind: "system", id: "migration-2026-09-27" };

export function planVerificationMigration(
  db: { verifications: VerificationRecord[]; screenings: ScreeningCheck[]; mechanics: MechanicProfile[]; users: User[] },
  scope: "live" | "demo",
  now = new Date().toISOString(),
): MigrationPlan {
  const updates: MigrationPlan["updates"] = [];
  for (const v0 of db.verifications) {
    const v = structuredClone(v0);
    const notes: string[] = [];
    const raw = v.status as string;
    if (OLD.has(raw)) {
      v.status = canonStatus(raw, { method: v.method });
      notes.push(`status ${raw} → ${v.status}`);
    }
    if (!v.events?.length) {
      v.events = reconstructedHistory(v, { actor: ACTOR, note: "Recorded before verification history was kept; rebuilt from the record's dates." });
      notes.push("history rebuilt from dates");
    }
    const docReviewed = v.method === "document_review" && (v.category === "insurance" || v.category === "credential" || v.category === "past_repair");
    if (v.status === "verified" && docReviewed && !v.documentIds?.length && !v.legacy?.unbacked) {
      v.legacy = { note: "Approved from a file name only; the document itself was never kept. Counts again once a document is resubmitted and reviewed.", unbacked: true };
      notes.push("approved without a stored document: marked unbacked");
    } else if (!v.legacy && notes.length) {
      v.legacy = { note: "Recorded before 2026-09-27; migrated to the canonical record." };
    }
    if (scope === "live" && v.provider === "mock" && v.status === "verified") {
      v.events.push({ at: now, actor: ACTOR, action: "revoked", from: "verified", to: "revoked", reasonCodes: ["legacy_unverified_provider"], note: "Marked verified by the demo stand-in provider; no real provider checked it." });
      v.status = "revoked";
      v.reasonCodes = ["legacy_unverified_provider"];
      v.decidedBy = ACTOR;
      notes.push("stand-in provider approval revoked");
    }
    if (notes.length) updates.push({ collection: "verifications", id: v.id, after: v as unknown as Record<string, unknown>, summary: notes.join("; ") });
  }
  for (const s0 of db.screenings) {
    const raw = s0.status as string;
    if (!OLD.has(raw)) continue;
    const s = { ...s0, status: canonStatus(raw, { method: "vendor_screening" }) };
    updates.push({ collection: "screenings", id: s.id, after: s as unknown as Record<string, unknown>, summary: `status ${raw} → ${s.status}` });
  }
  const creates: VerificationRecord[] = [];
  const hasEmail = new Set(db.verifications.filter((v) => v.category === "email").map((v) => v.mechanicId));
  for (const m of db.mechanics) {
    if (hasEmail.has(m.id) || !db.users.some((u) => u.id === m.userId)) continue;
    creates.push({
      id: `ver-email-${m.id}`,
      mechanicId: m.id,
      accountId: m.userId,
      subjectType: "account",
      subjectId: m.userId,
      category: "email",
      method: "email_link",
      provider: "sign_in",
      status: "verified",
      verifiedAt: now.slice(0, 10),
      reviewedAt: now.slice(0, 10),
      decidedBy: ACTOR,
      legacy: { note: "Backfilled: accounts can only be created after the sign-in provider confirms the email address." },
      events: [{ at: now, actor: ACTOR, action: "migrated", to: "verified", note: "Email confirmed at sign-in (backfilled)." }],
      evidenceSummary: "Email confirmed when the account was created",
    });
  }
  return { updates, creates };
}
