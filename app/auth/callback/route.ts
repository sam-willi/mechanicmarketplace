import { NextResponse, type NextRequest } from "next/server";
import { createSupabase } from "@/lib/supabase/server";
import { finishSignIn } from "@/lib/auth/finish";

/**
 * Where Supabase sends people back: after Google, after clicking the email
 * verification link, and after a password-reset link. Exchanges the one-time
 * code for a session, creates the Clutch account on first sign-in, and routes
 * them on (or to /welcome to pick a role if we don't know it yet).
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const origin = url.origin;
  const next = url.searchParams.get("next");
  const role = url.searchParams.get("role");
  const code = url.searchParams.get("code");
  const fail = (e: string) => NextResponse.redirect(new URL(`/login?error=${e}`, origin));

  if (url.searchParams.get("error")) {
    const desc = url.searchParams.get("error_description") ?? "";
    const code = url.searchParams.get("error_code") ?? "";
    return fail(/expired|invalid/i.test(desc) || code === "otp_expired" ? "link_expired" : "auth_cancelled");
  }
  if (!code) return fail("link_expired");

  const supabase = await createSupabase();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    console.error("[auth] code exchange failed:", error?.message);
    const msg = error?.message ?? "";
    // Opened in a different browser or app than sign-up: Supabase already confirmed the
    // address before redirecting here, so the fix is simply to log in.
    if (/code verifier|code_verifier|code challenge|flow state/i.test(msg)) return fail("confirmed_login");
    if (error?.name === "AuthRetryableFetchError" || (error?.status ?? 0) >= 500) return fail("unavailable");
    return fail("link_expired");
  }
  return finishSignIn(origin, { id: data.user.id, email: data.user.email ?? "", meta: data.user.user_metadata ?? {}, emailVerified: Boolean(data.user.email_confirmed_at) }, role, next);
}
