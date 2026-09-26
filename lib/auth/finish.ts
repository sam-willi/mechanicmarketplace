import "server-only";
import { NextResponse } from "next/server";
import { homeFor, provisionUser } from "./provision";
import { MODE_COOKIE, USER_COOKIE } from "@/lib/session";

/** After Supabase establishes a session: create the Clutch account if needed and redirect. */
export async function finishSignIn(origin: string, auth: { id: string; email: string; meta: Record<string, unknown> }, role: string | null, next: string | null) {
  if (next === "/reset-password") return NextResponse.redirect(new URL("/reset-password", origin));
  const user = await provisionUser(auth, role === "customer" || role === "mechanic" ? role : undefined);
  const res = NextResponse.redirect(
    new URL(user ? (user.roles.length === 1 && user.roles[0] === "mechanic" && role === "mechanic" ? "/mechanic/onboarding" : homeFor(user, next)) : `/welcome${next ? `?next=${encodeURIComponent(next)}` : ""}`, origin),
  );
  res.cookies.delete(USER_COOKIE);
  if (user && (user.roles.includes("customer") || user.roles.includes("mechanic"))) res.cookies.set(MODE_COOKIE, user.roles.includes("customer") && role !== "mechanic" ? "customer" : "mechanic", { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  return res;
}
