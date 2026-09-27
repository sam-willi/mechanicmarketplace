import "server-only";
import { cookies, headers } from "next/headers";
import { getRepo, needsFor, requestScope } from "@/lib/data";
import type { Repository } from "@/lib/data/repository";
import { unsign } from "@/lib/auth/signing";
import { TEST_USER_COOKIE, testLoginsEnabled } from "@/lib/auth/test-login";
import { authConfigured, demoLoginsEnabled } from "@/lib/supabase/config";
import { createSupabase } from "@/lib/supabase/server";
import type { AppMode, EvidenceVariant, Role } from "@/lib/domain/types";

/**
 * Sessions come from Supabase Auth (or a demo cookie, below). One login can
 * hold both roles; the app area being visited (/customer or /mechanic, set as
 * a request header by proxy.ts) decides which role-profile the session uses.
 */
export type Session =
  | { role: "guest" }
  | { role: "customer"; userId: string; customerId: string; name: string; roles: Role[] }
  | { role: "mechanic"; userId: string; mechanicId: string; slug: string; name: string; roles: Role[] }
  | { role: "admin"; userId: string; name: string; roles: Role[] };

export const USER_COOKIE = "clutch_user";
export const MODE_COOKIE = "clutch_mode";
/** Legacy demo cookie ("customer:cust-maya", "mechanic:mech-…", "admin"), still honoured. */
export const PERSONA_COOKIE = "clutch_persona";
export const VARIANT_COOKIE = "clutch_evidence_variant";
export const SESSION_COOKIE = "clutch_sid";
export const AREA_HEADER = "x-clutch-area";

/**
 * Who is signed in, resolved inside this request's data scope (lib/data/scope.ts):
 *  - Live scope: a Supabase Auth session (verified JWT claims); the app user's
 *    id is the Supabase auth user id, looked up in the live store only.
 *  - Demo scope: a signed cookie from one-click demo sign-in, looked up in the
 *    demo store only. A real account exploring the demo is a guest there, and
 *    a demo cookie never signs anyone in to the live marketplace.
 */
async function signedIn(): Promise<{ repo: Repository; userId?: string }> {
  const scope = await requestScope();
  const repo = await getRepo();
  if (scope === "demo") {
    if (!demoLoginsEnabled()) return { repo };
    const jar = await cookies();
    const raw = jar.get(USER_COOKIE)?.value;
    const id = unsign(raw) ?? legacyUserId(repo, jar.get(PERSONA_COOKIE)?.value);
    return { repo, userId: id && repo.getUser(id)?.demo ? id : undefined };
  }
  if (testLoginsEnabled()) {
    // Local in-memory test accounts (lib/auth/test-login.ts); never with a database or in production.
    const id = unsign((await cookies()).get(TEST_USER_COOKIE)?.value);
    if (id) await loadAccount(id);
    const u = id ? repo.getUser(id) : undefined;
    if (u && !u.demo && u.email.endsWith("@example.test")) return { repo, userId: u.id };
  }
  const auth = await getAuthUser();
  if (auth) await loadAccount(auth.id);
  const user = auth ? repo.getUser(auth.id) : undefined;
  return { repo, userId: user && !user.demo ? user.id : undefined };
}

/** Live targeted reads: this account and its role profiles, into the request's slice (a no-op elsewhere). */
async function loadAccount(userId: string) {
  await (await needsFor({ userId, staff: false })).account(userId);
}

/**
 * This request's loaders for the signed-in viewer (lib/data/normalized/needs.ts). Access is
 * decided by the session: the customer or mechanic profile of the area being used, and staff
 * rights only for accounts holding the admin role. A no-op for the demo and in-memory stores.
 */
export async function needs(s: Session) {
  return needsFor({
    userId: s.role === "guest" ? undefined : s.userId,
    customerId: s.role === "customer" ? s.customerId : undefined,
    mechanicId: s.role === "mechanic" ? s.mechanicId : undefined,
    staff: isStaff(s),
  });
}

/** The Supabase Auth user for this request (verified), whether or not they've finished sign-up. */
export async function getAuthUser(): Promise<{ id: string; email: string; meta: Record<string, unknown> } | null> {
  if (!authConfigured()) return null;
  const supabase = await createSupabase();
  const { data } = await supabase.auth.getClaims();
  const c = data?.claims;
  if (!c?.sub) return null;
  return { id: c.sub, email: String(c.email ?? ""), meta: (c.user_metadata as Record<string, unknown>) ?? {} };
}

function legacyUserId(repo: Repository, persona?: string) {
  if (!persona) return undefined;
  const [role, id] = persona.split(":");
  if (role === "admin") return "user-admin";
  if (role === "customer" && id) return repo.getCustomer(id)?.userId;
  if (role === "mechanic" && id) return repo.getMechanic(id)?.userId;
  return undefined;
}

export async function getSession(): Promise<Session> {
  const jar = await cookies();
  const { repo, userId } = await signedIn();
  const user = userId ? repo.getUser(userId) : undefined;
  if (!user) return { role: "guest" };
  const area = (await headers()).get(AREA_HEADER) as AppMode | "" | null;
  const cookieMode = jar.get(MODE_COOKIE)?.value as AppMode | undefined;
  const order: AppMode[] = [area || cookieMode || (user.roles[0] as AppMode), "customer", "mechanic"].filter(Boolean) as AppMode[];

  for (const mode of order) {
    if (mode === "customer" && user.roles.includes("customer")) {
      const c = repo.getCustomerByUser(user.id);
      if (c) return { role: "customer", userId: user.id, customerId: c.id, name: user.name, roles: user.roles };
    }
    if (mode === "mechanic" && user.roles.includes("mechanic")) {
      const m = repo.getMechanicByUser(user.id);
      if (m) return { role: "mechanic", userId: user.id, mechanicId: m.id, slug: m.slug, name: user.name, roles: user.roles };
    }
  }
  // Staff-only accounts (no customer or mechanic profile) get the reviewer session.
  if (user.roles.includes("admin")) return { role: "admin", userId: user.id, name: user.name, roles: user.roles };
  return { role: "guest" };
}

/**
 * Clutch staff. Admin is a permission on top of an account's customer or
 * mechanic mode, not a replacement for it; the review pages check this.
 */
export function isStaff(s: Session): s is Exclude<Session, { role: "guest" }> {
  return s.role !== "guest" && s.roles.includes("admin");
}

/** Which roles the signed-in account holds, regardless of the current area. */
export async function getAccount() {
  const { repo, userId } = await signedIn();
  const user = userId ? repo.getUser(userId) : undefined;
  if (!user) return null;
  return {
    user,
    customer: repo.getCustomerByUser(user.id),
    mechanic: repo.getMechanicByUser(user.id),
  };
}

/**
 * Evidence experiment arm. `?variant=` overrides for review; otherwise the
 * cookie set by proxy.ts (only when CLUTCH_EXPERIMENT=on). Default: high.
 */
export async function getVariant(override?: string): Promise<EvidenceVariant> {
  if (override === "low" || override === "high") return override;
  const jar = await cookies();
  const v = jar.get(VARIANT_COOKIE)?.value;
  return v === "low" ? "low" : "high";
}

export async function getSessionId() {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
}
