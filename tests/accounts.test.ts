import { test } from "node:test";
import assert from "node:assert/strict";
import { repoFor } from "@/lib/data";
import { current as currentOf, ready as readyOf } from "@/lib/data/store";
import { homeFor, provisionUser } from "@/lib/auth/provision";
import { authErrorCode, EMAIL } from "@/lib/auth/errors";

// Test identities only: example.test is reserved and never delivers mail.
// Real accounts always live in the live store.
const repo = repoFor("live");
const ready = () => readyOf("live");
const current = () => currentOf("live");

const auth = (id: string, email: string, meta: Record<string, unknown> = {}) => ({ id, email, meta });

test("never runs against a real database", () => {
  assert.equal(process.env.DATABASE_URL, undefined);
});

test("customer sign-up creates exactly one account and one customer profile, even when retried", async () => {
  await ready();
  const a = auth("test-cust-1", "customer1@example.test", { name: "Casey Test", role: "customer" });
  const first = await provisionUser(a);
  const again = await provisionUser(a); // the callback retried, or a double click
  const direct = await repo.createUser({ id: a.id, name: "Casey Test", email: a.email, role: "customer" }); // a replayed transaction
  assert.ok(first);
  assert.equal(again?.id, first.id);
  assert.equal(direct.id, first.id);
  assert.equal(current().users.filter((u) => u.id === a.id).length, 1, "one account");
  assert.equal(current().customers.filter((c) => c.userId === a.id).length, 1, "one customer profile");
  assert.deepEqual(first.roles, ["customer"]);
  assert.equal(homeFor(first), "/customer");
});

test("mechanic sign-up gets the mechanic role and lands on onboarding until the profile exists", async () => {
  await ready();
  const a = auth("test-mech-1", "mechanic1@example.test", { name: "Morgan Test", role: "mechanic", phone: "555-0100" });
  const user = await provisionUser(a);
  assert.ok(user);
  assert.deepEqual(user.roles, ["mechanic"]);
  assert.equal(repo.getCustomerByUser(a.id), undefined, "no customer profile for a mechanic-only account");
  assert.equal(repo.getMechanicByUser(a.id), undefined, "no mechanic profile until onboarding is submitted");
  assert.equal(homeFor(user), "/mechanic"); // the mechanic layout sends them on to onboarding
});

test("re-submitting onboarding updates the one mechanic profile instead of creating another", async () => {
  await ready();
  const a = auth("test-mech-2", "mechanic2@example.test", { name: "Riley Test", role: "mechanic" });
  await provisionUser(a);
  const input = {
    userId: a.id,
    displayName: "Riley Test",
    city: "Los Angeles",
    serviceRadiusMi: 10,
    bio: "",
    workModel: "mobile" as const,
    declaredRepairCategories: ["brakes" as const],
    declaredMakes: [],
    hourlyRateCents: 9000,
    diagnosticFeeCents: 5000,
  };
  const m1 = await repo.upsertMechanicProfile(input);
  const m2 = await repo.upsertMechanicProfile({ ...input, hourlyRateCents: 9500 });
  assert.equal(m2.id, m1.id);
  assert.equal(current().mechanics.filter((m) => m.userId === a.id).length, 1, "one mechanic profile");
  assert.equal(repo.getMechanicByUser(a.id)?.hourlyRateCents, 9500);
  assert.equal(repo.getUser(a.id)?.roles.filter((r) => r === "mechanic").length, 1);
});

test("an account with no role yet is sent to choose one", async () => {
  await ready();
  const user = await provisionUser(auth("test-google-1", "google1@example.test", { full_name: "Gale Test" }));
  assert.equal(user, undefined);
  assert.equal(repo.getUser("test-google-1"), undefined);
  // Choosing a role completes it, and choosing again doesn't duplicate.
  const u = await provisionUser(auth("test-google-1", "google1@example.test", { full_name: "Gale Test" }), "customer");
  const u2 = await provisionUser(auth("test-google-1", "google1@example.test", { full_name: "Gale Test" }), "customer");
  assert.equal(u?.id, u2?.id);
  assert.equal(u?.name, "Gale Test");
});

test("adding the other role keeps one login with both profiles (enables the mode switch)", async () => {
  await ready();
  const a = auth("test-dual-1", "dual1@example.test", { name: "Dana Test", role: "customer" });
  await provisionUser(a);
  await repo.upsertMechanicProfile({ userId: a.id, displayName: "Dana Test", city: "Los Angeles", serviceRadiusMi: 10, bio: "", workModel: "mobile", declaredRepairCategories: [], declaredMakes: [], hourlyRateCents: 8000, diagnosticFeeCents: 4000 });
  const u = repo.getUser(a.id)!;
  assert.deepEqual([...u.roles].sort(), ["customer", "mechanic"]);
  assert.ok(repo.getCustomerByUser(a.id) && repo.getMechanicByUser(a.id));
});

test("staff get the reviewer permission on top of their own app, not instead of it", async () => {
  await ready();
  const u = await provisionUser(auth("test-staff-1", "staff@example.test", { name: "Sky Staff", role: "customer" }));
  assert.ok(u?.roles.includes("admin") && u.roles.includes("customer"));
  assert.equal(homeFor(u!), "/customer");
});

test("real accounts are never demo accounts", async () => {
  await ready();
  const u = repo.getUser("test-cust-1");
  assert.ok(u && !u.demo);
});

test("only safe local 'next' paths are honoured", async () => {
  await ready();
  const u = repo.getUser("test-cust-1")!;
  assert.equal(homeFor(u, "/customer/mechanics?repair=brakes"), "/customer/mechanics?repair=brakes");
  assert.equal(homeFor(u, "//evil.example"), "/customer");
  assert.equal(homeFor(u, "https://evil.example"), "/customer");
});

test("auth errors map to plain-language states", () => {
  assert.equal(authErrorCode({ name: "AuthRetryableFetchError", message: "fetch failed" }, "x"), "unavailable");
  assert.equal(authErrorCode({ status: 429, message: "email rate limit exceeded" }, "x"), "too_many");
  assert.equal(authErrorCode({ code: "email_not_confirmed", message: "Email not confirmed" }, "x"), "unconfirmed");
  assert.equal(authErrorCode({ message: "User already registered" }, "x"), "exists");
  assert.equal(authErrorCode({ message: "Password should be at least 8 characters." }, "x"), "weak_password");
  assert.equal(authErrorCode({ code: "signup_disabled", message: "Signups not allowed" }, "x"), "signup_closed");
  assert.equal(authErrorCode({ message: "Invalid login credentials" }, "invalid"), "invalid");
  assert.ok(EMAIL.test("someone@example.test") && !EMAIL.test("not-an-email") && !EMAIL.test("a@b"));
});
