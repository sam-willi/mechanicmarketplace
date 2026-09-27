import "server-only";
import { cookies } from "next/headers";
import { unsign } from "@/lib/auth/signing";
import { demoLoginsEnabled } from "@/lib/supabase/config";

/**
 * Data scopes. Every record lives in exactly one:
 *  - "live": the real marketplace. Real accounts (Supabase Auth), their
 *    requests, quotes, jobs, reviews and verifications. Never seeded with fiction.
 *  - "demo": the fictional showcase marketplace (seeded demo accounts and
 *    everything they do). Only demo sessions read or write it.
 * Records that linked both before scopes existed are moved to "quarantine"
 * by the migration and are never loaded.
 *
 * A request's scope is decided here, on the server, once: it is "demo" only
 * with a validly signed scope cookie (set by demo sign-in or "Explore the demo"),
 * and only while demo access is enabled. Everyone else, including signed-out
 * visitors and every real account, is "live".
 */
export type Scope = "live" | "demo";
export const SCOPES: Scope[] = ["live", "demo"];

/** Signed "demo" marker. HttpOnly, so client code can't set or forge it. */
export const SCOPE_COOKIE = "clutch_scope";
/** The demo account cookie (see lib/session.ts). A valid one also implies demo scope. */
const DEMO_USER_COOKIE = "clutch_user";

/** Pure decision from raw cookie values, so it can be tested without a request. */
export function scopeFromCookies(scopeCookie: string | undefined, demoUserCookie: string | undefined, demoEnabled = demoLoginsEnabled()): Scope {
  if (!demoEnabled) return "live";
  if (unsign(scopeCookie) === "demo") return "demo";
  if (unsign(demoUserCookie)) return "demo";
  return "live";
}

/** This request's scope. */
export async function requestScope(): Promise<Scope> {
  let jar;
  try {
    jar = await cookies();
  } catch {
    // Outside a request (build-time prerender, scripts): the public, real marketplace.
    return "live";
  }
  return scopeFromCookies(jar.get(SCOPE_COOKIE)?.value, jar.get(DEMO_USER_COOKIE)?.value);
}
