"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ready, repo } from "@/lib/data";
import { getAccount, getAuthUser, MODE_COOKIE, PERSONA_COOKIE, USER_COOKIE } from "@/lib/session";
import { sign } from "@/lib/auth/signing";
import { homeFor, provisionUser } from "@/lib/auth/provision";
import { authConfigured, demoLoginsEnabled } from "@/lib/supabase/config";
import { createSupabase, siteOrigin } from "@/lib/supabase/server";
import { VEHICLE_MAKES, type AppMode, type VehicleMake } from "@/lib/domain/types";

const YEAR = 60 * 60 * 24 * 365;

function safeNext(next: string | null | undefined, fallback: string) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (path: string, params: Record<string, string | undefined>) =>
  `${path}?${new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][])}`;

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
    err(/already|registered|exists/i.test(error.message) ? "exists" : /password/i.test(error.message) ? "weak_password" : "signup_failed");
  }
  // Existing emails come back with no identities (Supabase hides whether an account exists); treat as "check your email".
  if (data.session && data.user) {
    await ready();
    const user = await provisionUser({ id: data.user.id, email, meta: data.user.user_metadata ?? {} });
    const jar = await cookies();
    jar.set(MODE_COOKIE, role, { path: "/", sameSite: "lax", maxAge: YEAR });
    redirect(role === "mechanic" ? "/mechanic/onboarding" : homeFor(user!, next || "/customer?welcome=1"));
  }
  redirect(back("/signup/check-email", { email }));
}

export async function signInWithPassword(formData: FormData) {
  const email = str(formData, "email").toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = str(formData, "next");
  const supabase = await requireAuth();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    const code =
      error?.name === "AuthRetryableFetchError" || (error?.status ?? 0) >= 500
        ? "unavailable"
        : error?.code === "email_not_confirmed" || /confirm/i.test(error?.message ?? "")
          ? "unconfirmed"
          : "invalid";
    redirect(back("/login", { email, error: code, next }));
  }
  await ready();
  const jar = await cookies();
  jar.delete(USER_COOKIE);
  const user = await provisionUser({ id: data.user.id, email, meta: data.user.user_metadata ?? {} });
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
  await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${await siteOrigin()}/auth/callback` } });
  redirect(back("/signup/check-email", { email, resent: "1" }));
}

/** Always says the same thing, whether or not the email has an account. */
export async function requestPasswordReset(formData: FormData) {
  const email = str(formData, "email").toLowerCase();
  const supabase = await requireAuth();
  if (email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${await siteOrigin()}/auth/callback?next=/reset-password` });
    if (error) console.error("[auth] reset email failed:", error.message);
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
    redirect(`/reset-password?error=${/session|jwt|auth/i.test(error.message) ? "expired" : "failed"}`);
  }
  await ready();
  const acct = await getAccount();
  redirect(acct ? `${homeFor(acct.user)}` : "/welcome");
}

/** First sign-in with Google (or any auth user without a Clutch account yet): pick a role. */
export async function completeSignup(role: "customer" | "mechanic", next: string) {
  await ready();
  const auth = await getAuthUser();
  if (!auth) redirect("/login");
  const user = await provisionUser(auth, role);
  const jar = await cookies();
  jar.set(MODE_COOKIE, role, { path: "/", sameSite: "lax", maxAge: YEAR });
  redirect(role === "mechanic" ? "/mechanic/onboarding" : homeFor(user!, safeNext(next, "/customer?welcome=1")));
}

// ------------------------------------------------------------ demo accounts

/** One-click sign-in for the seeded demo accounts only. Real accounts always go through Supabase. */
export async function demoSignIn(formData: FormData) {
  await ready();
  if (!demoLoginsEnabled()) redirect("/login");
  const userId = str(formData, "userId");
  const mode = str(formData, "mode") as AppMode | "admin";
  const next = str(formData, "next");
  const user = repo.getUser(userId);
  if (!user?.demo) redirect("/login?error=unknown");
  if (authConfigured()) await (await createSupabase()).auth.signOut();
  const jar = await cookies();
  jar.set(USER_COOKIE, sign(user.id), { path: "/", sameSite: "lax", maxAge: YEAR, httpOnly: true, secure: process.env.NODE_ENV === "production" });
  jar.delete(PERSONA_COOKIE);
  if (mode && mode !== "admin") jar.set(MODE_COOKIE, mode, { path: "/", sameSite: "lax", maxAge: YEAR });
  const home = mode === "admin" || !(user.roles.includes("customer") || user.roles.includes("mechanic")) ? "/admin" : mode === "mechanic" ? "/mechanic" : "/customer";
  redirect(safeNext(next, home));
}

export async function signOut() {
  if (authConfigured()) await (await createSupabase()).auth.signOut();
  const jar = await cookies();
  jar.delete(USER_COOKIE);
  jar.delete(PERSONA_COOKIE);
  jar.delete(MODE_COOKIE);
  redirect("/");
}

/** Switch modes on a dual-role account. Same login; lands on that side's home. */
/** The same place in the other app, where there is one. */
const EQUIVALENT: [string, string][] = [
  ["/customer/notifications", "/mechanic/notifications"],
  ["/customer/help", "/mechanic/help"],
  ["/customer/profile", "/mechanic/settings"],
];

export async function switchMode(mode: AppMode, fromPath?: string) {
  await ready();
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
  await ready();
  const acct = await getAccount();
  if (!acct) redirect("/login");
  await repo.addCustomerProfile(acct.user.id);
  const jar = await cookies();
  jar.set(MODE_COOKIE, "customer", { path: "/", sameSite: "lax", maxAge: YEAR });
  redirect("/customer?welcome=1");
}

export async function updateAccount(formData: FormData) {
  await ready();
  const acct = await getAccount();
  if (!acct) redirect("/login");
  const str = (k: string) => String(formData.get(k) ?? "").trim();
  // Sign-in email is managed by Supabase Auth (verified), so it isn't editable here.
  await repo.updateUser(acct.user.id, {
    name: str("name") || acct.user.name,
    phone: str("phone") || undefined,
    notificationPrefs: { email: formData.get("notifyEmail") === "on", sms: formData.get("notifySms") === "on", push: formData.get("notifyPush") === "on" },
  });
  revalidatePath("/", "layout");
  redirect(`${str("back") || "/customer/profile"}?saved=1`);
}

export async function markNotificationsRead(mode: AppMode) {
  await ready();
  const acct = await getAccount();
  if (!acct) return;
  await repo.markNotificationsRead(acct.user.id, mode);
  revalidatePath(`/${mode}`, "layout");
}
