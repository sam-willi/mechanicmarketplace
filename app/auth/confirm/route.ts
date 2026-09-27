import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabase } from "@/lib/supabase/server";
import { finishSignIn } from "@/lib/auth/finish";

/**
 * Email links that carry a token hash (Supabase email templates using
 * `{{ .TokenHash }}`), e.g. /auth/confirm?token_hash=…&type=signup|recovery.
 * Works even when the link is opened in a different browser than sign-up.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  if (!token_hash || !type) return NextResponse.redirect(new URL("/login?error=link_expired", url.origin));
  const supabase = await createSupabase();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash, type });
  if (error || !data.user) return NextResponse.redirect(new URL("/login?error=link_expired", url.origin));
  const next = type === "recovery" ? "/reset-password" : url.searchParams.get("next");
  return finishSignIn(url.origin, { id: data.user.id, email: data.user.email ?? "", meta: data.user.user_metadata ?? {}, emailVerified: Boolean(data.user.email_confirmed_at) }, null, next);
}
