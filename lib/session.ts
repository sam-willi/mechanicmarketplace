import "server-only";
import { cookies, headers } from "next/headers";
import { ready, repo } from "@/lib/data";
import { unsign } from "@/lib/auth/signing";
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
 * Who is signed in:
 *  - Real accounts: a Supabase Auth session (verified JWT claims); the app
 *    user's id is the Supabase auth user id.
 *  - Demo accounts (seeded, `demo: true`): a signed cookie from one-click demo
 *    sign-in, when demo logins are enabled.
 */
async function signedInUserId() {
  await ready();
  const jar = await cookies();
  if (demoLoginsEnabled()) {
    const raw = jar.get(USER_COOKIE)?.value;
    const id = unsign(raw) ?? raw ?? legacyUserId(jar.get(PERSONA_COOKIE)?.value);
    if (id && repo.getUser(id)?.demo) return id;
  }
  const auth = await getAuthUser();
  return auth && repo.getUser(auth.id) ? auth.id : undefined;
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

function legacyUserId(persona?: string) {
  if (!persona) return undefined;
  const [role, id] = persona.split(":");
  if (role === "admin") return "user-admin";
  if (role === "customer" && id) return repo.getCustomer(id)?.userId;
  if (role === "mechanic" && id) return repo.getMechanic(id)?.userId;
  return undefined;
}

export async function getSession(): Promise<Session> {
  const jar = await cookies();
  const userId = await signedInUserId();
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
  const userId = await signedInUserId();
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
