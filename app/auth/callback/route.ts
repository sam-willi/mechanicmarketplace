import { NextResponse, type NextRequest } from "next/server";
import { ready } from "@/lib/data";
import { createSupabase } from "@/lib/supabase/server";
import { finishSignIn } from "@/lib/auth/finish";

/**
 * Where Supabase sends people back: after Google, after clicking the email
 * verification link, and after a password-reset link. Exchanges the one-time
 * code for a session, creates the Clutch account on first sign-in, and routes
 * them on (or to /welcome to pick a role if we don't know it yet).
 */
export async function GET(request: NextRequest) {
  await ready();
  const url = request.nextUrl;
  const origin = url.origin;
  const next = url.searchParams.get("next");
  const role = url.searchParams.get("role");
  const code = url.searchParams.get("code");
  const fail = (e: string) => NextResponse.redirect(new URL(`/login?error=${e}`, origin));

  if (url.searchParams.get("error")) {
    const desc = url.searchParams.get("error_description") ?? "";
    return fail(/expired|invalid/i.test(desc) ? "link_expired" : "auth_cancelled");
  }
  if (!code) return fail("link_expired");

  const supabase = await createSupabase();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    console.error("[auth] code exchange failed:", error?.message);
    return fail("link_expired");
  }
  return finishSignIn(origin, { id: data.user.id, email: data.user.email ?? "", meta: data.user.user_metadata ?? {} }, role, next);
}
