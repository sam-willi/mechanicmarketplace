import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { repoFor, repoOver } from "@/lib/data";
import { NormalizedLiveStore } from "@/lib/data/normalized/store";
import { LifecycleError } from "@/lib/domain/transitions";
import { deliverySchemaSql, enqueueAlerts } from "@/lib/notify/outbox";
import { ProviderError, type EmailProvider, type OutboundEmail } from "@/lib/notify/providers";
import { deliveryHealth, recipientLoader, runDeliveryOnce, type WorkerOptions } from "@/lib/notify/worker";

/**
 * Alert delivery against a disposable Postgres, with scripted fake providers (made-up addresses;
 * nothing leaves the process). Proves: queued only with a committed notification, never sent
 * twice (concurrent workers, crashes, timeouts), honest states, redaction, and that nothing is
 * sent without a provider.
 */

const url = process.env.DATABASE_URL!;
assert.match(url, /127\.0\.0\.1:\d+\/clutch_test$/);
const sql = postgres(url, { prepare: false, max: 8, onnotice: () => undefined });
void repoFor;
after(() => sql.end({ timeout: 5 }));
before(async () => {
  await sql.unsafe(deliverySchemaSql());
});

let n = 0;
const uid = (p: string) => `${p}-${process.pid}-${++n}`;
/** A live account the worker can read (snapshot rows; the loader is told which store to read). */
async function account(o: { email?: string; verified?: boolean; wantsEmail?: boolean; demo?: boolean } = {}) {
  const id = uid("u");
  const data = {
    id,
    roles: ["customer"],
    name: "Fixture",
    email: o.email ?? `${id}@fake-provider-inbox.dev`,
    notificationPrefs: { email: o.wantsEmail ?? true, sms: false, push: false },
    ...(o.verified === false ? {} : { emailVerifiedAt: "2026-09-26T00:00:00Z" }),
    ...(o.demo ? { demo: true } : {}),
  };
  await sql`insert into app_records (scope, collection, id, data) values ('live', 'users', ${id}, ${sql.json(data)})`;
  return id;
}
async function event(userId: string, type = "estimate.received") {
  const id = uid("ntf");
  await sql.begin((tx) => enqueueAlerts(tx, [{ id, userId, mode: "customer", kind: "new_quote", event: type, title: "private title 123 Main St", href: `/customer/quotes/${id}`, createdAt: "", read: false }]));
  const [row] = await sql<{ id: string }[]>`select id::text from delivery_outbox where event_key = ${`notification:${id}:email`}`;
  return Number(row.id);
}
const state = async (id: number) => (await sql<{ state: string; send_attempts: number; suppressed_reason: string | null; uncertain: boolean; provider_message_id: string | null }[]>`select state, send_attempts, suppressed_reason, uncertain, provider_message_id from delivery_outbox where id = ${id}`)[0];
const due = (id: number) => sql`update delivery_outbox set next_attempt_at = now() where id = ${id}`;

/** A scripted provider. `script(call)` decides each send; accepted messages are remembered by idempotency key. */
class Fake implements EmailProvider {
  key = "fake";
  calls = 0;
  accepted = new Map<string, string>();
  constructor(
    private script: (m: OutboundEmail, call: number) => "ok" | "retry" | "permanent" | "accepted-then-timeout" = () => "ok",
    private withLookup = true,
  ) {}
  async send(m: OutboundEmail) {
    this.calls++;
    const how = this.script(m, this.calls);
    if (how === "retry") throw new ProviderError("421 try later for rcpt someone@fake-provider-inbox.dev", "retryable", "rate_limited");
    if (how === "permanent") throw new ProviderError("550 no such mailbox", "permanent", "rejected");
    // The provider dedupes on the idempotency key: same key, same message.
    const id = this.accepted.get(m.idempotencyKey) ?? `msg-${this.accepted.size + 1}-${m.idempotencyKey}`;
    this.accepted.set(m.idempotencyKey, id);
    if (how === "accepted-then-timeout") throw new ProviderError("no answer", "timeout", "timeout");
    return { messageId: id };
  }
  get lookup() {
    return this.withLookup ? async (k: string) => (this.accepted.has(k) ? { messageId: this.accepted.get(k)! } : null) : undefined;
  }
}

const opts = (over: Partial<WorkerOptions> = {}): WorkerOptions => ({
  sql,
  provider: null,
  workerId: uid("w"),
  origin: "https://clutch.example",
  loadRecipient: recipientLoader(sql, false),
  batch: 100,
  ...over,
});
/** Drain only the given events (isolate tests that share the database). */
async function only<T>(ids: number[], fn: () => Promise<T>) {
  await sql`update delivery_outbox set next_attempt_at = now() + interval '10 years' where id <> all(${ids}) and state in ('pending', 'retry')`;
  await sql`update delivery_outbox set state = 'suppressed', suppressed_reason = 'test_isolation' where id <> all(${ids}) and state = 'no_provider'`;
  return fn();
}

test("alerts are queued in the same transaction as the notification: rolled back → none; retried → one", async () => {
  const store = NormalizedLiveStore.connect(url, { cacheMs: 0, reads: "snapshot" });
  const repo = repoOver("live", store);
  try {
    await store.ready("force");
    const u = await repo.createUser({ id: uid("lv"), name: "Fixture", email: `${uid("e")}@fake-provider-inbox.dev`, role: "customer" });
    const before = Number((await sql`select count(*)::text as n from delivery_outbox`)[0].n);
    await assert.rejects(
      store.transact(() => {
        store.current().notifications.push({ id: uid("ntf"), userId: u.id, mode: "customer", kind: "new_quote", title: "x", href: "/customer", createdAt: "", read: false });
        throw new LifecycleError("refused after notifying");
      }),
    );
    assert.equal(Number((await sql`select count(*)::text as n from delivery_outbox`)[0].n), before, "nothing queued for a rolled-back change");
    await repo.notify(u.id, "customer", "new_quote", "x", "/customer/quotes/q1");
    const rows = await sql`select event_type, state, link_path from delivery_outbox where user_id = ${u.id}`;
    assert.deepEqual(rows.map((r) => [r.event_type, r.state, r.link_path]), [["estimate.received", "pending", "/customer/quotes/q1"]]);
    const nid = store.current().notifications.find((x) => x.userId === u.id)!;
    await sql.begin((tx) => enqueueAlerts(tx, [nid]));
    assert.equal((await sql`select count(*)::int as n from delivery_outbox where user_id = ${u.id}`)[0].n, 1, "duplicate event, one row");
    // In-app-only events queue nothing.
    await repo.notify(u.id, "customer", "quote_viewed", "x", "/customer");
    assert.equal((await sql`select count(*)::int as n from delivery_outbox where user_id = ${u.id}`)[0].n, 1);
    await assert.rejects(sql`insert into delivery_outbox (scope, event_key, event_type, channel, user_id, audience, link_path, source_notification_id) values ('demo', ${uid("k")}, 'estimate.received', 'email', 'u', 'customer', '/', 'n')`, /check/, "demo events can't be queued");
  } finally {
    await store.end();
  }
});

test("no provider: nothing is sent, a redacted preview is kept, and it goes out once a provider exists", async () => {
  const id = await event(await account());
  await only([id], () => runDeliveryOnce(opts()));
  let s = await state(id);
  assert.deepEqual([s.state, s.send_attempts, s.provider_message_id], ["no_provider", 0, null]);
  const [a] = await sql`select outcome, adapter, recipient_hint, preview from delivery_attempts where outbox_id = ${id}`;
  assert.equal(a.outcome, "no_provider");
  assert.equal(a.adapter, "none");
  assert.ok(!JSON.stringify(a).includes("@") && !JSON.stringify(a).includes("123 Main"), "no address or notification text");
  // Without a provider it isn't picked up again (no attempt spam).
  await only([id], () => runDeliveryOnce(opts()));
  assert.equal((await sql`select count(*)::int as n from delivery_attempts where outbox_id = ${id}`)[0].n, 1);
  const fake = new Fake();
  await only([id], () => runDeliveryOnce(opts({ provider: fake })));
  s = await state(id);
  assert.equal(s.state, "sent");
  assert.equal(fake.calls, 1);
  assert.ok(s.provider_message_id);
});

test("two workers at once never double-send", async () => {
  const ids = await Promise.all(Array.from({ length: 30 }, async () => event(await account())));
  const fake = new Fake();
  await only(ids, async () => {
    for (let round = 0; round < 5; round++) await Promise.all([runDeliveryOnce(opts({ provider: fake, batch: 7 })), runDeliveryOnce(opts({ provider: fake, batch: 7 }))]);
  });
  const rows = await sql<{ state: string }[]>`select state from delivery_outbox where id = any(${ids})`;
  assert.ok(rows.every((r) => r.state === "sent"));
  assert.equal(fake.calls, 30, "one send per event");
  assert.equal(new Set(fake.accepted.values()).size, 30);
});

test("a crashed worker's lease expires and another worker finishes; a worker whose lease lapsed doesn't send", async () => {
  const id = await event(await account());
  const fake = new Fake();
  await only([id], () => assert.rejects(runDeliveryOnce(opts({ provider: fake, leaseMs: 200, afterClaim: async () => { throw new Error("worker crashed"); } }))));
  assert.equal((await state(id)).state, "processing", "left mid-flight");
  await new Promise((r) => setTimeout(r, 300));
  await only([id], () => runDeliveryOnce(opts({ provider: fake })));
  assert.equal((await state(id)).state, "sent");
  assert.equal(fake.calls, 1);

  // A slow worker: its lease lapses while it's paused; another worker sends; the slow one must not.
  const id2 = await event(await account());
  const fake2 = new Fake();
  await only([id2], () =>
    runDeliveryOnce(
      opts({
        provider: fake2,
        leaseMs: 150,
        afterClaim: async () => {
          await new Promise((r) => setTimeout(r, 250));
          await runDeliveryOnce(opts({ provider: fake2 }));
        },
      }),
    ),
  );
  assert.equal(fake2.calls, 1, "sent once, by the worker that held the lease");
  const outcomes = (await sql<{ outcome: string }[]>`select outcome from delivery_attempts where outbox_id = ${id2} order by seq`).map((r) => r.outcome);
  assert.deepEqual(outcomes.sort(), ["lease_lost", "sent"]);
});

test("retryable failures back off and dead-letter at the limit; permanent ones stop at once", async () => {
  const id = await event(await account());
  await sql`update delivery_outbox set max_attempts = 3 where id = ${id}`;
  const flaky = new Fake(() => "retry");
  for (let i = 0; i < 3; i++) {
    await only([id], () => runDeliveryOnce(opts({ provider: flaky })));
    const s = await state(id);
    if (i < 2) {
      assert.equal(s.state, "retry");
      const [{ later }] = await sql`select next_attempt_at > now() as later from delivery_outbox where id = ${id}`;
      assert.ok(later, "backed off");
      await due(id);
    }
  }
  const s = await state(id);
  assert.deepEqual([s.state, s.send_attempts], ["failed", 3]);
  const summaries = await sql<{ error_summary: string }[]>`select error_summary from delivery_attempts where outbox_id = ${id}`;
  assert.ok(summaries.every((x) => !x.error_summary.includes("@")), "provider errors redacted");

  const id2 = await event(await account());
  await only([id2], () => runDeliveryOnce(opts({ provider: new Fake(() => "permanent") })));
  assert.deepEqual([(await state(id2)).state, (await state(id2)).send_attempts], ["failed", 1]);
});

test("a timeout after the provider accepted: the retry finds it and doesn't send again", async () => {
  const id = await event(await account());
  const fake = new Fake((_, call) => (call === 1 ? "accepted-then-timeout" : "ok"));
  await only([id], () => runDeliveryOnce(opts({ provider: fake })));
  let s = await state(id);
  assert.deepEqual([s.state, s.uncertain], ["retry", true]);
  await due(id);
  await only([id], () => runDeliveryOnce(opts({ provider: fake })));
  s = await state(id);
  assert.equal(s.state, "sent");
  assert.equal(fake.calls, 1, "looked up, not resent");
  assert.equal((await sql`select outcome from delivery_attempts where outbox_id = ${id} order by seq desc limit 1`)[0].outcome, "recovered_sent");

  // Without lookup, the resend carries the same idempotency key, so the provider keeps one message.
  const id2 = await event(await account());
  const noLookup = new Fake((_, call) => (call === 1 ? "accepted-then-timeout" : "ok"), false);
  await only([id2], () => runDeliveryOnce(opts({ provider: noLookup })));
  await due(id2);
  await only([id2], () => runDeliveryOnce(opts({ provider: noLookup })));
  assert.equal((await state(id2)).state, "sent");
  assert.equal(noLookup.accepted.size, 1, "one message at the provider");
});

test("preferences, unverified contacts, test addresses, demo and missing accounts are never sent to", async () => {
  const cases: [string, Parameters<typeof account>[0] | null][] = [
    ["preference_off", { wantsEmail: false }],
    ["unverified_contact", { verified: false }],
    ["test_recipient", { email: "fixture@example.test" }],
    ["demo_account", { demo: true }],
    ["no_account", null],
  ];
  const fake = new Fake();
  for (const [reason, o] of cases) {
    const id = await event(o ? await account(o) : uid("missing-user"));
    await only([id], () => runDeliveryOnce(opts({ provider: fake })));
    const s = await state(id);
    assert.deepEqual([s.state, s.suppressed_reason], ["suppressed", reason]);
  }
  assert.equal(fake.calls, 0);
});

test("once sent, an event can't be sent or reset again", async () => {
  const id = await event(await account());
  const fake = new Fake();
  await only([id], () => runDeliveryOnce(opts({ provider: fake })));
  await assert.rejects(sql`update delivery_outbox set state = 'pending' where id = ${id}`, /already sent/);
  await assert.rejects(sql`update delivery_outbox set state = 'sent', provider_message_id = null where id = ${id}`, /check|already sent/);
  await only([id], () => runDeliveryOnce(opts({ provider: fake })));
  assert.equal(fake.calls, 1);
  await assert.rejects(sql`update delivery_attempts set outcome = 'sent' where outbox_id = ${id}`, /can't be changed/);
});

test("the health summary is counts and redacted details only", async () => {
  const h = await deliveryHealth(sql);
  assert.ok((h.byState.sent ?? 0) > 0);
  const json = JSON.stringify(h);
  assert.ok(!json.includes("@") && !json.includes("123 Main") && !json.includes("fake-provider-inbox"), "no addresses or message contents");
});
