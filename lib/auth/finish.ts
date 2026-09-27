import "server-only";
import { NextResponse } from "next/server";
import { homeFor, provisionUser } from "./provision";
import { MODE_COOKIE, PERSONA_COOKIE, USER_COOKIE } from "@/lib/session";
import { SCOPE_COOKIE } from "@/lib/data/scope";

/** After Supabase establishes a session: create the Clutch account if needed and redirect. */
export async function finishSignIn(origin: string, auth: { id: string; email: string; meta: Record<string, unknown>; emailVerified?: boolean }, role: string | null, next: string | null) {
  if (next === "/reset-password") return NextResponse.redirect(new URL("/reset-password", origin));
  let user;
  try {
    user = await provisionUser(auth, role === "customer" || role === "mechanic" ? role : undefined);
  } catch (e) {
    // The sign-in itself worked; only creating the Clutch account failed (e.g. the database blipped).
    // /welcome retries it with the same, idempotent step.
    console.error("[auth] account setup failed after sign-in:", (e as Error).message);
    return NextResponse.redirect(new URL(`/welcome?error=setup_failed${next ? `&next=${encodeURIComponent(next)}` : ""}`, origin));
  }
  const res = NextResponse.redirect(
    new URL(user ? (user.roles.length === 1 && user.roles[0] === "mechanic" && role === "mechanic" ? "/mechanic/onboarding" : homeFor(user, next)) : `/welcome${next ? `?next=${encodeURIComponent(next)}` : ""}`, origin),
  );
  // A real sign-in always lands in the real marketplace: out of any demo account or demo browsing.
  res.cookies.delete(USER_COOKIE);
  res.cookies.delete(PERSONA_COOKIE);
  res.cookies.delete(SCOPE_COOKIE);
  if (user && (user.roles.includes("customer") || user.roles.includes("mechanic"))) res.cookies.set(MODE_COOKIE, user.roles.includes("customer") && role !== "mechanic" ? "customer" : "mechanic", { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  return res;
}
