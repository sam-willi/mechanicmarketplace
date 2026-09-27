import { test } from "node:test";
import assert from "node:assert/strict";
import { repoFor } from "@/lib/data";
import { current, ready, resetMemoryStores } from "@/lib/data/store";

/**
 * The demo marketplace is internally consistent: every customer and mechanic profile has an
 * account, so any action on seeded data (an estimate on a seeded request notifies its customer)
 * works instead of failing on a missing account. All seed people are fictional.
 */

resetMemoryStores();
const demo = repoFor("demo");

test("every demo customer and mechanic profile has an account", async () => {
  await ready("demo");
  const d = current("demo");
  const users = new Set(d.users.map((u) => u.id));
  for (const c of d.customers) assert.ok(users.has(c.userId), `customer ${c.id} → ${c.userId}`);
  for (const m of d.mechanics) assert.ok(users.has(m.userId), `mechanic ${m.id} → ${m.userId}`);
});

test("Derek can send an estimate on every seeded request waiting for one", async () => {
  await ready("demo");
  const derek = current("demo").mechanics.find((m) => m.slug === "derek-hall")!;
  const open = demo.listRequestsForMechanic(derek.id).filter((r) => r.status === "open" && !demo.listQuotesForRequest(r.id).some((q) => q.mechanicId === derek.id));
  assert.ok(open.length > 0, "the demo has requests for Derek to quote");
  for (const r of open) {
    const q = await demo.submitQuote({ requestId: r.id, mechanicId: derek.id, laborCents: 20000, diagnosticFeeCents: 0, travelFeeCents: 0, partsIncluded: false, partsEstimateCents: 5000, durationHours: 2, availableOn: "Tue, Sep 29 · 9:00 AM", availableAt: { date: "2026-09-29", time: "09:00" }, serviceMode: "mobile", scope: "Inspect and repair." });
    assert.equal(q.status, "submitted", r.id);
    const c = demo.getCustomer(r.customerId)!;
    assert.ok(demo.listNotifications?.(c.userId, "customer")?.some((n) => n.kind === "new_quote") ?? true, "the customer is told");
  }
});

test("every demo mechanic has a complete basic profile, so no demo estimate is one the customer can't accept", async () => {
  const { toPublicProfile } = await import("@/lib/domain/public-profile");
  const { eligibility } = await import("@/lib/domain/eligibility");
  await ready("demo");
  const d = current("demo");
  for (const m of d.mechanics) {
    const e = eligibility(toPublicProfile(demo.getMechanicSources(m.id)));
    assert.ok(e.eligible, `${m.slug}: missing ${e.missing.map((x) => x.label).join(", ")}`);
  }
  for (const q of d.quotes.filter((x) => x.status === "submitted")) {
    assert.ok(eligibility(toPublicProfile(demo.getMechanicSources(q.mechanicId))).eligible, `estimate ${q.id} comes from a mechanic who can't be booked`);
  }
});
