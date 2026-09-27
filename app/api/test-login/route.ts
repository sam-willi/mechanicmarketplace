import { NextResponse, type NextRequest } from "next/server";
import { needsIn, readyRepo } from "@/lib/data";
import { SCOPE_COOKIE } from "@/lib/data/scope";
import { sign } from "@/lib/auth/signing";
import { TEST_USER_COOKIE, testLoginsEnabled } from "@/lib/auth/test-login";
import { MODE_COOKIE, PERSONA_COOKIE, USER_COOKIE } from "@/lib/session";

/**
 * GET /api/test-login?as=customer|mechanic|staff[&key=2][&car=1][&next=/path]
 * `car=1` gives a test customer one sample car (skips the vehicle picker in browser tests).
 * Signs this browser in to a live test account (see lib/auth/test-login.ts). 404 otherwise.
 */
export async function GET(request: NextRequest) {
  if (!testLoginsEnabled()) return new NextResponse("Not found", { status: 404 });
  const url = request.nextUrl;
  const as = url.searchParams.get("as");
  if (as !== "customer" && as !== "mechanic" && as !== "staff") return new NextResponse("as=customer|mechanic|staff", { status: 400 });
  const key = (url.searchParams.get("key") ?? "1").replace(/[^a-z0-9]/gi, "").slice(0, 12) || "1";
  const repo = await readyRepo("live");
  const id = `test-${as}-${key}`;
  await (await needsIn("live", { userId: id, staff: false })).account(id);
  const names = { customer: "Casey Tester", mechanic: "Morgan Tester", staff: "Riley Staff" };
  const user = repo.getUser(id) ?? (await repo.createUser({ id, name: `${names[as]} ${key}`, email: `${as}${key}@example.test`, role: as === "mechanic" ? "mechanic" : "customer" }));
  if (as === "staff") await repo.grantAdmin(user.id);
  // `bookable=1`: a fictional mechanic profile with screening as a connected provider would record it
  // (provider "provider-under-test") and insurance verified, so a full booking can be exercised locally.
  if (as === "mechanic" && url.searchParams.get("bookable") === "1" && !repo.getMechanicByUser(user.id)) {
    const m = await repo.upsertMechanicProfile({ userId: user.id, displayName: `${names.mechanic} ${key}`, city: "Los Angeles", neighborhood: "mid-city", serviceRadiusMi: 15, bio: "Test fixture.", workModel: "mobile", declaredRepairCategories: ["brakes"], declaredMakes: ["BMW"], hourlyRateCents: 9500, diagnosticFeeCents: 6000, availabilityNote: "Weekdays" });
    await repo.addTestScreening(m.id);
  }
  const cust = repo.getCustomerByUser(user.id);
  if (cust) await (await needsIn("live", { userId: user.id, customerId: cust.id, staff: false })).customerVehicleList();
  if (as === "customer" && cust && url.searchParams.get("car") === "1" && !repo.listVehicles(cust.id).length) {
    await repo.addVehicle(cust.id, { year: 2016, make: "BMW", model: "328i", mileage: 71000, transmission: "automatic" });
  }
  const next = url.searchParams.get("next");
  const home = as === "staff" ? "/admin" : as === "mechanic" ? (repo.getMechanicByUser(user.id) ? "/mechanic" : "/mechanic/onboarding") : "/customer";
  const res = NextResponse.redirect(new URL(next && next.startsWith("/") && !next.startsWith("//") ? next : home, url.origin));
  for (const c of [USER_COOKIE, PERSONA_COOKIE, SCOPE_COOKIE]) res.cookies.delete(c);
  res.cookies.set(TEST_USER_COOKIE, sign(user.id), { path: "/", sameSite: "lax", httpOnly: true });
  res.cookies.set(MODE_COOKIE, as === "mechanic" ? "mechanic" : "customer", { path: "/", sameSite: "lax" });
  return res;
}
