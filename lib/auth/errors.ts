/** Map a Supabase Auth error to one of our plain-language codes. */
export function authErrorCode(error: { name?: string; status?: number; code?: string; message?: string } | null | undefined, fallback: string) {
  if (!error) return fallback;
  const msg = error.message ?? "";
  if (error.name === "AuthRetryableFetchError" || (error.status ?? 0) >= 500 || /fetch failed|network/i.test(msg)) return "unavailable";
  if (error.status === 429 || /rate limit|too many/i.test(msg) || error.code === "over_email_send_rate_limit") return "too_many";
  if (error.code === "email_not_confirmed" || /not confirmed/i.test(msg)) return "unconfirmed";
  if (error.code === "user_already_exists" || /already (been )?registered|already exists/i.test(msg)) return "exists";
  if (error.code === "weak_password" || /password/i.test(msg)) return "weak_password";
  if (error.code === "email_address_invalid" || /invalid.*email|email.*invalid/i.test(msg)) return "bad_email";
  if (error.code === "signup_disabled") return "signup_closed";
  return fallback;
}

/** A deliberately loose email check; Supabase does the real validation. */
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
