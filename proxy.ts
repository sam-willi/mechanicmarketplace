import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_KEY, SUPABASE_URL, authConfigured } from "@/lib/supabase/config";

/**
 * - Tags each request with the app area (/customer or /mechanic) so one login
 *   with two roles gets the right role-profile, and remembers it as the mode.
 * - Assigns an anonymous session id (for analytics).
 * - When the trust experiment is on, assigns a sticky evidence variant.
 * - Keeps the Supabase Auth session fresh (refreshes expired access tokens).
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const refreshed: { name: string; value: string; options: Record<string, unknown> }[] = [];
  if (authConfigured()) {
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          refreshed.push(...list);
        },
      },
    });
    await supabase.auth.getClaims();
  }
  const area = path.startsWith("/customer") ? "customer" : path.startsWith("/mechanic/") || path === "/mechanic" ? "mechanic" : "";
  const headers = new Headers(request.headers);
  headers.set("x-clutch-area", area);
  // Where to return after logging in, with the query (e.g. a search's car, repair and area).
  headers.set("x-clutch-path", path + request.nextUrl.search);
  headers.set("x-clutch-switched", request.nextUrl.searchParams.get("switched") ?? "");
  const res = NextResponse.next({ request: { headers } });
  refreshed.forEach(({ name, value, options }) => res.cookies.set(name, value, options));

  if (area && request.cookies.get("clutch_mode")?.value !== area) {
    res.cookies.set("clutch_mode", area, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
  if (!request.cookies.get("clutch_sid")) {
    res.cookies.set("clutch_sid", crypto.randomUUID(), { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
  if (process.env.CLUTCH_EXPERIMENT === "on" && !request.cookies.get("clutch_evidence_variant")) {
    res.cookies.set("clutch_evidence_variant", Math.random() < 0.5 ? "low" : "high", {
      path: "/",
      maxAge: 60 * 60 * 24 * 90,
      sameSite: "lax",
    });
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico|icon.svg|.*\\.(?:png|jpg|svg|webp|ico)$).*)"],
};
