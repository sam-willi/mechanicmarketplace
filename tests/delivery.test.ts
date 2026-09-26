import { test } from "node:test";
import assert from "node:assert/strict";
import { repoFor } from "@/lib/data";
import { current, ready, resetMemoryStores } from "@/lib/data/store";
import { provisionUser } from "@/lib/auth/provision";
import { DELIVERY_EVENTS, DELIVERY_EVENT_TYPES, eventFor, isTestAddress, renderAlert, safePath } from "@/lib/notify/events";
import { deliveryConfig, emailAlertsOn } from "@/lib/notify/config";
import { providerFromConfig } from "@/lib/notify/providers";
import { backoffMs, redact } from "@/lib/notify/worker";
import type { AppNotification, Quote } from "@/lib/domain/types";

/** Alerts: what fires, what they say (nothing private), and when they can go out at all (not yet). */

resetMemoryStores();
const live = repoFor("live");

test("every alert template is generic: no placeholders, names, cars, amounts or addresses", () => {
  for (const type of DELIVERY_EVENT_TYPES) {
    const a = renderAlert(type, "/customer/jobs/job-1", "https://clutch.example");
    assert.ok(a.subject.length > 5 && a.text.includes("https://clutch.example/customer/jobs/job-1"), type);
    assert.ok(!/\$\{|\{\{|undefined|null|\$\d/.test(a.subject + a.text), `${type}: no leftovers or amounts`);
    assert.ok(!/@/.test(a.text), `${type}: no addresses`);
  }
});

test("links stay inside Clutch", () => {
  assert.equal(safePath("/customer/jobs/job-1#payment"), "/customer/jobs/job-1#payment");
  for (const bad of ["//evil.example", "https://evil.example", "javascript:alert(1)", "/a b", "/<script>"]) assert.equal(safePath(bad), "/", bad);
});

test("test and placeholder addresses are recognized and never real recipients", () => {
  for (const t of ["a@example.test", "a@example.com", "maya@clutch.demo", "x@foo.test", "x@localhost", "x@thing.invalid", "nobody"]) assert.ok(isTestAddress(t), t);
  for (const r of ["person@fixture-mailhost.net", "shop@fixture-garage.co"]) assert.ok(!isTestAddress(r), r);
});

test("alerts are off unless fully configured; the validator never prints secrets", () => {
  assert.equal(emailAlertsOn({}), false);
  assert.equal(providerFromConfig(deliveryConfig({})), null);
  const env = { CLUTCH_OUTBOUND_ALERTS: "on", CLUTCH_EMAIL_PROVIDER: "smtp", SMTP_HOST: "smtp.secret-host.example", SMTP_PORT: "587", SMTP_USER: "user-secret", SMTP_PASSWORD: "pa55-secret-value", EMAIL_FROM: "alerts@clutch.app", APP_URL: "https://clutch.app" };
  const cfg = deliveryConfig(env);
  assert.equal(cfg.active, false, "no SMTP adapter is implemented, so nothing can send");
  assert.equal(cfg.checks.find((c) => c.key === "adapter")?.ok, false);
  assert.equal(providerFromConfig(cfg), null);
  const printed = JSON.stringify(cfg);
  for (const secret of ["pa55-secret-value", "user-secret", "smtp.secret-host.example"]) assert.ok(!printed.includes(secret), `${secret} not printed`);
  assert.equal(deliveryConfig({ ...env, EMAIL_FROM: "alerts@example.test" }).checks.find((c) => c.key === "from")?.ok, false);
  assert.equal(deliveryConfig({ ...env, APP_URL: "http://localhost:3000" }).checks.find((c) => c.key === "app_url")?.ok, false);
});

test("provider errors are redacted before they're stored", () => {
  const r = redact("550 mailbox person.fixture@fixture-mailhost.net unavailable; call +1 (213) 555-0118");
  assert.ok(!r.includes("fixture-mailhost") && !r.includes("person.fixture") && !r.includes("555-0118"), r);
  assert.ok(r.includes("[address]") && r.includes("[number]"));
});

test("backoff grows and is capped", () => {
  const a = [1, 2, 3, 4, 20].map((n) => backoffMs(n, 0.5));
  assert.ok(a[0] < a[1] && a[1] < a[2] && a[2] < a[3]);
  assert.ok(a[4] <= 6 * 3600_000 * 1.2);
});

test("only material events alert, with the right type; in-app-only ones stay in-app", () => {
  const n = (kind: AppNotification["kind"], event?: string) => eventFor({ kind, event });
  assert.equal(n("new_quote"), "estimate.received");
  assert.equal(n("quote_viewed"), null);
  assert.equal(n("mechanic_checked_in"), null);
  assert.equal(n("diagnosis_shared"), null);
  assert.equal(n("quote_updated", "estimate.declined"), "estimate.declined");
  assert.equal(n("new_opportunity", "none"), null);
  assert.equal(n("support_update"), "support.update");
});

const quoteBody = (requestId: string, mechanicId: string): Omit<Quote, "id" | "status" | "createdAt" | "customerQuestions"> => ({
  requestId,
  mechanicId,
  laborCents: 30000,
  diagnosticFeeCents: 5000,
  travelFeeCents: 0,
  partsIncluded: true,
  partsEstimateCents: 12000,
  durationHours: 2,
  availableOn: "Tue, Sep 29 · 9:00 AM",
  serviceMode: "mobile",
  scope: "Replace front pads and rotors.",
});

test("a booking lifecycle raises exactly the expected alerts, each generic, for the right side", async () => {
  await ready("live");
  const cu = await provisionUser({ id: "dl-cust", email: "dl-cust@example.test", meta: { name: "Casey Private", role: "customer" }, emailVerified: true });
  const mu = await provisionUser({ id: "dl-mech", email: "dl-mech@example.test", meta: { name: "Morgan Private", role: "mechanic" }, emailVerified: true });
  assert.ok(live.getUser(cu!.id)?.emailVerifiedAt, "verified at sign-in");
  const c = live.getCustomerByUser(cu!.id)!;
  const m = await live.upsertMechanicProfile({ userId: mu!.id, displayName: "Morgan Private", city: "Los Angeles", neighborhood: "mid-city", serviceRadiusMi: 15, bio: "", workModel: "mobile", declaredRepairCategories: ["brakes"], declaredMakes: ["BMW"], hourlyRateCents: 9000, diagnosticFeeCents: 5000, availabilityNote: "Weekdays" });
  for (const kind of ["identity", "background", "driving_record"] as const) current("live").screenings.push({ id: `dl-scr-${kind}`, mechanicId: m.id, kind, provider: "provider-under-test", providerRef: kind, status: "verified", result: "clear", completedAt: "2026-09-20", expiresAt: "2027-09-20" });
  await live.submitInsurance(m.id, { carrier: "T", expiresOn: "2027-12-31", documentName: "coi.pdf" });
  const staff = await provisionUser({ id: "dl-staff", email: "staff@example.test", meta: { name: "S", role: "customer" } });
  const ins = live.listVerifications({ mechanicId: m.id, statuses: ["pending"] })[0];
  await live.decideVerification(ins.id, "verified", staff!.id, "ok", "2027-12-31");
  const before = current("live").notifications.length;
  const r = await live.createRequest({ customerId: c.id, vehicleId: "", vehicle: { year: 2016, make: "BMW", model: "328i" }, repairCategory: "brakes", categorySource: "customer", symptomDescription: "Grinding at 4 Private Lane.", occurrence: { conditions: [] }, onset: {}, warningLights: [], diagnosticCodes: [], smells: [], recentRepairs: [], customerParts: [], location: { serviceMode: "mobile", area: "mid-city", address: "4 Private Lane" }, media: [] });
  if (!r.matchedMechanicIds.includes(m.id)) await live.forwardRequest(r.id, [m.id], "broaden");
  const q = await live.submitQuote(quoteBody(r.id, m.id));
  const job = await live.acceptQuote(q.id, c.id);
  await live.startJob(job.id, m.id);
  await live.markJobDone(job.id, m.id, 35000, undefined, undefined, { status: "not_paid" });
  await live.completeJob(job.id, c.id, { status: "paid", amountCents: 35000 });
  const fresh = current("live").notifications.slice(before);
  const alerts = fresh.map((n) => ({ to: n.userId, type: eventFor(n) })).filter((x) => x.type);
  const byType = (t: string) => alerts.filter((a) => a.type === t);
  assert.equal(byType("request.invited")[0]?.to, mu!.id);
  assert.equal(byType("estimate.received")[0]?.to, cu!.id);
  assert.equal(byType("estimate.accepted")[0]?.to, mu!.id);
  assert.equal(byType("booking.created")[0]?.to, cu!.id);
  assert.equal(byType("job.marked_complete")[0]?.to, cu!.id);
  assert.equal(byType("job.confirmed")[0]?.to, mu!.id);
  assert.deepEqual(byType("payment.mismatch").map((a) => a.to).sort(), [cu!.id, mu!.id].sort(), "both told, once");
  await live.reportPayment(job.id, { role: "mechanic", mechanicId: m.id }, { status: "paid", amountCents: 1 });
  assert.equal(current("live").notifications.filter((n) => n.kind === "payment_mismatch").length, 2, "not repeated");
  assert.equal(fresh.filter((n) => n.kind === "mechanic_checked_in").every((n) => eventFor(n) === null), true, "arrival stays in-app");
  // What an alert would say for each: nothing private.
  for (const n of fresh) {
    const t = eventFor(n);
    if (!t) continue;
    const a = renderAlert(t, n.href, "https://clutch.example");
    for (const secret of ["Casey", "Morgan", "Private", "BMW", "328i", "4 Private Lane", "$", "350"]) assert.ok(!(a.subject + a.text).includes(secret), `${t} leaks ${secret}`);
    assert.ok(t in DELIVERY_EVENTS);
  }
});
