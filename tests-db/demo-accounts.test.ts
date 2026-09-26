import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { repoFor } from "@/lib/data";
import { current, ready } from "@/lib/data/store";

/**
 * A demo snapshot saved before every seeded profile had an account (the fictional customers on
 * Derek's incoming requests had none) loads with those accounts filled in from the seed, so an
 * estimate on one of those requests notifies the customer instead of failing. Demo scope only.
 */

const url = process.env.DATABASE_URL!;
assert.match(url, /127\.0\.0\.1:\d+\/clutch_test$/, "only ever the disposable test database");
const db = postgres(url, { prepare: false, max: 1, onnotice: () => undefined });
after(() => db.end({ timeout: 5 }));

test("an older demo snapshot missing seed accounts is repaired on load, and estimates on its requests go through", async () => {
  await ready("demo");
  // As an older saved demo would be: the request's customer profile exists, its account doesn't.
  await db`delete from app_records where scope = 'demo' and collection = 'users' and id in ('user-cust-req-1', 'user-cust-req-2')`;
  await db`update app_meta set version = version + 1 where key = 'demo'`;
  await ready("demo", true);
  const d = current("demo");
  assert.ok(d.users.some((u) => u.id === "user-cust-req-1") && d.users.some((u) => u.id === "user-cust-req-2"), "filled in from the seed");
  assert.ok(d.users.every((u) => u.demo), "only fictional demo accounts");

  const derek = d.mechanics.find((m) => m.slug === "derek-hall")!;
  const req = d.requests.find((r) => r.customerId === "cust-req-1")!;
  const q = await repoFor("demo").submitQuote({ requestId: req.id, mechanicId: derek.id, laborCents: 18500, diagnosticFeeCents: 6000, travelFeeCents: 2500, partsIncluded: false, partsEstimateCents: 0, durationHours: 2, availableOn: "Tue, Sep 29 · 8:00 AM", availableAt: { date: "2026-09-29", time: "08:00" }, serviceMode: "mobile", scope: "Front pads and rotors." });
  assert.equal(q.status, "submitted");
  await ready("demo", true);
  assert.ok(current("demo").notifications.some((n) => n.userId === "user-cust-req-1" && n.kind === "new_quote"), "Jordan is told");
  // Nothing crossed into the real marketplace.
  const [{ n }] = await db<{ n: number }[]>`select count(*)::int as n from app_records where scope = 'live' and collection = 'users' and id like 'user-cust-req-%'`;
  assert.equal(n, 0);
});
