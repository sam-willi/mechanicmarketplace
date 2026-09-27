"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getRepo, readyRepo } from "@/lib/data";
import { SCOPE_COOKIE } from "@/lib/data/scope";
import { TEST_USER_COOKIE } from "@/lib/auth/test-login";
import { getAccount, getAuthUser, MODE_COOKIE, PERSONA_COOKIE, USER_COOKIE } from "@/lib/session";
import { sign } from "@/lib/auth/signing";
import { homeFor, provisionUser } from "@/lib/auth/provision";
import { authErrorCode, EMAIL } from "@/lib/auth/errors";
import { authConfigured, demoLoginsEnabled } from "@/lib/supabase/config";
import { createSupabase, siteOrigin } from "@/lib/supabase/server";
import { VEHICLE_MAKES, type AppMode, type VehicleMake } from "@/lib/domain/types";

const YEAR = 60 * 60 * 24 * 365;
const SCOPE_OPTS = { path: "/", sameSite: "lax" as const, maxAge: 60 * 60 * 24 * 30, httpOnly: true, secure: process.env.NODE_ENV === "production" };

/** Leave the demo marketplace: drop the demo account and the demo scope, so this browser is back on real data. */
function leaveDemo(jar: Awaited<ReturnType<typeof cookies>>) {
  jar.delete(TEST_USER_COOKIE);
  jar.delete(USER_COOKIE);
  jar.delete(PERSONA_COOKIE);
  jar.delete(SCOPE_COOKIE);
}

function safeNext(next: string | null | undefined, fallback: string) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (path: string, params: Record<string, string | undefined>) =>
  `${path}?${new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][])}`;

/** Create the Clutch account for a signed-in Supabase user; undefined if we still need a role, "failed" if the database step failed. */
async function provisionSafely(auth: Parameters<typeof provisionUser>[0], role?: "customer" | "mechanic") {
  try {
    return await provisionUser(auth, role);
  } catch (e) {
    console.error("[auth] account setup failed:", (e as Error).message);
    return "failed" as const;
  }
}

async function requireAuth() {
  if (!authConfigured()) redirect("/login?error=auth_unconfigured");
  return createSupabase();
}

// ------------------------------------------------------------ real accounts

/** Email + password sign-up. Supabase sends a verification email; the account is created on first sign-in. */
export async function signUpWithPassword(formData: FormData) {
  const role = str(formData, "role") === "mechanic" ? "mechanic" : "customer";
  const name = str(formData, "name");
  const email = str(formData, "email").toLowerCase();
  const password = String(formData.get("password") ?? "");
  const phone = str(formData, "phone") || undefined;
  const next = safeNext(str(formData, "next"), "");
  const err = (error: string) => redirect(back("/signup", { role, error, next, email, name }));
  if (!name || !email) err("missing");
  if (!EMAIL.test(email)) err("bad_email");
  if (password.length < 8) err("weak_password");
  if (role === "mechanic" && !phone) err("missing_phone");

  const supabase = await requireAuth();
  const make = str(formData, "make");
  const car = VEHICLE_MAKES.includes(make as VehicleMake) && str(formData, "model")
    ? { year: Number(str(formData, "year")) || undefined, make, model: str(formData, "model"), mileage: Number(str(formData, "mileage").replace(/[^0-9]/g, "")) || undefined }
    : undefined;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${await siteOrigin()}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`,
      data: { name, role, phone, car },
    },
  });
  if (error) {
    console.error("[auth] sign-up failed:", error.message);
    err(authErrorCode(error, "signup_failed"));
  }
  // When confirmation is off, Supabase signs them straight in.
  if (data.session && data.user) {
    const user = await provisionSafely({ id: data.user.id, email, meta: data.user.user_metadata ?? {}, emailVerified: Boolean(data.user.email_confirmed_at) }, role);
    if (!user || user === "failed") redirect(back("/welcome", { error: "setup_failed", next }));
    const jar = await cookies();
    leaveDemo(jar);
    jar.set(MODE_COOKIE, role, { path: "/", sameSite: "lax", maxAge: YEAR });
    redirect(role === "mechanic" ? "/mechanic/onboarding" : homeFor(user, next || "/customer?welcome=1"));
  }
  // An email that's already registered comes back looking like a fresh sign-up (Supabase doesn't reveal
  // which emails have accounts). The next page covers both cases in plain words.
  redirect(back("/signup/check-email", { email, role }));
}

export async function signInWithPassword(formData: FormData) {
  const email = str(formData, "email").toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = str(formData, "next");
  const supabase = await requireAuth();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    const code = authErrorCode(error, "invalid");
    redirect(back("/login", { email, error: code === "weak_password" || code === "exists" ? "invalid" : code, next }));
  }
  const jar = await cookies();
  // A real sign-in always lands in the real marketplace.
  leaveDemo(jar);
  const user = await provisionSafely({ id: data.user.id, email, meta: data.user.user_metadata ?? {}, emailVerified: Boolean(data.user.email_confirmed_at) });
  if (user === "failed") redirect(back("/welcome", { error: "setup_failed", next }));
  if (!user) redirect(back("/welcome", { next }));
  jar.set(MODE_COOKIE, user.roles.includes("customer") ? "customer" : "mechanic", { path: "/", sameSite: "lax", maxAge: YEAR });
  redirect(homeFor(user, next));
}

/** Continue with Google. `role` is set when coming from a sign-up form. */
export async function signInWithGoogle(formData: FormData) {
  const supabase = await requireAuth();
  const params = new URLSearchParams();
  const role = str(formData, "role");
  if (role === "customer" || role === "mechanic") params.set("role", role);
  const next = safeNext(str(formData, "next"), "");
  if (next) params.set("next", next);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await siteOrigin()}/auth/callback${params.size ? `?${params}` : ""}`, queryParams: { prompt: "select_account" } },
  });
  if (error || !data.url) {
    console.error("[auth] Google sign-in failed to start:", error?.message);
    redirect("/login?error=google_failed");
  }
  redirect(data.url);
}

export async function resendConfirmation(formData: FormData) {
  const email = str(formData, "email").toLowerCase();
  const supabase = await requireAuth();
  const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${await siteOrigin()}/auth/callback` } });
  if (error) {
    console.error("[auth] resend failed:", error.message);
    redirect(back("/signup/check-email", { email, error: authErrorCode(error, "resend_failed") }));
  }
  redirect(back("/signup/check-email", { email, resent: "1" }));
}

/** Always says the same thing, whether or not the email has an account. */
export async function requestPasswordReset(formData: FormData) {
  const email = str(formData, "email").toLowerCase();
  const supabase = await requireAuth();
  if (!EMAIL.test(email)) redirect(back("/forgot-password", { error: "bad_email", email }));
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${await siteOrigin()}/auth/callback?next=/reset-password` });
  if (error) {
    console.error("[auth] reset email failed:", error.message);
    // Only say something when it's a problem on our side; never whether the email has an account.
    const code = authErrorCode(error, "");
    if (code === "unavailable" || code === "too_many") redirect(back("/forgot-password", { error: code, email }));
  }
  redirect(back("/forgot-password", { sent: "1", email }));
}

export async function updatePassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) redirect("/reset-password?error=weak_password");
  if (password !== String(formData.get("confirm") ?? "")) redirect("/reset-password?error=mismatch");
  const supabase = await requireAuth();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error("[auth] password update failed:", error.message);
    redirect(`/reset-password?error=${/different from the old|same_password/i.test(error.message) || error.code === "same_password" ? "same" : /session|jwt|auth/i.test(error.message) ? "expired" : authErrorCode(error, "failed") === "unavailable" ? "unavailable" : "failed"}`);
  }
  const acct = await getAccount();
  redirect(acct ? `${homeFor(acct.user)}` : "/welcome");
}

/** First sign-in with Google (or any auth user without a Clutch account yet): pick a role. */
export async function completeSignup(role: "customer" | "mechanic", next: string) {
  const auth = await getAuthUser();
  if (!auth) redirect("/login");
  const user = await provisionSafely(auth, role);
  if (!user || user === "failed") redirect(back("/welcome", { error: "setup_failed", next }));
  const jar = await cookies();
  leaveDemo(jar);
  jar.set(MODE_COOKIE, role, { path: "/", sameSite: "lax", maxAge: YEAR });
  redirect(role === "mechanic" ? "/mechanic/onboarding" : homeFor(user, safeNext(next, "/customer?welcome=1")));
}

// ------------------------------------------------------------ demo accounts

/** One-click sign-in for the seeded demo accounts only. Real accounts always go through Supabase. */
export async function demoSignIn(formData: FormData) {
  if (!demoLoginsEnabled()) redirect("/login");
  // Demo accounts exist only in the demo store.
  const repo = await readyRepo("demo");
  const userId = str(formData, "userId");
  const mode = str(formData, "mode") as AppMode | "admin";
  const next = str(formData, "next");
  const user = repo.getUser(userId);
  if (!user?.demo) redirect("/login?error=unknown");
  if (authConfigured()) await (await createSupabase()).auth.signOut();
  const jar = await cookies();
  jar.set(USER_COOKIE, sign(user.id), { path: "/", sameSite: "lax", maxAge: YEAR, httpOnly: true, secure: process.env.NODE_ENV === "production" });
  jar.set(SCOPE_COOKIE, sign("demo"), SCOPE_OPTS);
  jar.delete(PERSONA_COOKIE);
  if (mode && mode !== "admin") jar.set(MODE_COOKIE, mode, { path: "/", sameSite: "lax", maxAge: YEAR });
  const home = mode === "admin" || !(user.roles.includes("customer") || user.roles.includes("mechanic")) ? "/admin" : mode === "mechanic" ? "/mechanic" : "/customer";
  redirect(safeNext(next, home));
}

export async function signOut() {
  if (authConfigured()) await (await createSupabase()).auth.signOut();
  const jar = await cookies();
  leaveDemo(jar);
  jar.delete(MODE_COOKIE);
  redirect("/");
}

/**
 * Browse the fictional demo marketplace without signing in. Sets the demo
 * scope (signed, HttpOnly); a real session stays signed in with Supabase but
 * is a guest inside the demo and can't act on demo records.
 */
export async function enterDemo(formData: FormData) {
  if (!demoLoginsEnabled()) redirect("/");
  const jar = await cookies();
  jar.set(SCOPE_COOKIE, sign("demo"), SCOPE_OPTS);
  redirect(safeNext(str(formData, "next"), "/demo"));
}

/** Back to the real marketplace (and out of any demo account). */
export async function exitDemo() {
  const jar = await cookies();
  leaveDemo(jar);
  jar.delete(MODE_COOKIE);
  redirect("/");
}

/** Leave the demo on the way to creating a real account: real sign-up never happens inside the demo. */
export async function exitDemoToSignup(formData: FormData) {
  const jar = await cookies();
  leaveDemo(jar);
  jar.delete(MODE_COOKIE);
  const role = str(formData, "role");
  const next = safeNext(str(formData, "next"), "");
  redirect(back("/signup", { role: role === "mechanic" || role === "customer" ? role : undefined, next: next || undefined }));
}

/** Switch modes on a dual-role account. Same login; lands on that side's home. */
/** The same place in the other app, where there is one. */
const EQUIVALENT: [string, string][] = [
  ["/customer/notifications", "/mechanic/notifications"],
  ["/customer/help", "/mechanic/help"],
  ["/customer/profile", "/mechanic/settings"],
];

export async function switchMode(mode: AppMode, fromPath?: string) {
  const repo = await getRepo();
  const acct = await getAccount();
  if (!acct) redirect("/login");
  const jar = await cookies();
  jar.set(MODE_COOKIE, mode, { path: "/", sameSite: "lax", maxAge: YEAR });
  if (mode === "mechanic" && !acct.mechanic) redirect("/mechanic/onboarding");
  if (mode === "customer" && !acct.customer) await repo.addCustomerProfile(acct.user.id);
  const pair = EQUIVALENT.find(([c, m]) => fromPath?.startsWith(mode === "mechanic" ? c : m));
  const dest = pair ? (mode === "mechanic" ? pair[1] : pair[0]) : mode === "mechanic" ? "/mechanic" : "/customer";
  redirect(`${dest}?switched=${mode}`);
}

/** Mechanic who also wants to hire mechanics (or vice versa): add the role to the same account. */
export async function addCustomerRole() {
  const repo = await getRepo();
  const acct = await getAccount();
  if (!acct) redirect("/login");
  await repo.addCustomerProfile(acct.user.id);
  const jar = await cookies();
  jar.set(MODE_COOKIE, "customer", { path: "/", sameSite: "lax", maxAge: YEAR });
  redirect("/customer?welcome=1");
}

export async function updateAccount(formData: FormData) {
  const repo = await getRepo();
  const acct = await getAccount();
  if (!acct) redirect("/login");
  const str = (k: string) => String(formData.get(k) ?? "").trim();
  // Sign-in email is managed by Supabase Auth (verified), so it isn't editable here.
  await repo.updateUser(acct.user.id, {
    name: str("name") || acct.user.name,
    phone: str("phone") || undefined,
    // The email-alert choice is only on the form when alerts can actually be sent.
    ...(str("prefs") === "1" ? { notificationPrefs: { ...acct.user.notificationPrefs, email: formData.get("notifyEmail") === "on" } } : {}),
  });
  revalidatePath("/", "layout");
  redirect(`${str("back") || "/customer/profile"}?saved=1`);
}

export async function markNotificationsRead(mode: AppMode) {
  const repo = await getRepo();
  const acct = await getAccount();
  if (!acct) return;
  await repo.markNotificationsRead(acct.user.id, mode);
  revalidatePath(`/${mode}`, "layout");
}
