import { test } from "node:test";
import assert from "node:assert/strict";
import { repoFor } from "@/lib/data";
import { current, ready, resetMemoryStores } from "@/lib/data/store";
import { provisionUser } from "@/lib/auth/provision";
import { toPublicProfile } from "@/lib/domain/public-profile";
import { screeningItems } from "@/lib/domain/eligibility";
import { canonStatus, effective, transition, TransitionError, type CheckStatus } from "@/lib/verification/model";
import { planVerificationMigration } from "@/lib/verification/migrate";
import { sign, verifySignature } from "@/lib/verification/identity/signature";
import { mapStripe, sameName, StripeIdentityProvider } from "@/lib/verification/identity/stripe";
import { identityConfig, testIdentityProvider } from "@/lib/verification/identity/config";
import { testIdentitySecret } from "@/lib/verification/identity/test-provider";
import { WebhookRejected } from "@/lib/verification/identity/types";
import { checkDocToken, docLink } from "@/lib/verification/doc-links";
import { screeningProblems, screeningOpen } from "@/lib/verification/providers/registry";
import { buildSeed } from "@/lib/data/mock/seed";
import { POST as webhook } from "@/app/api/verification/webhook/[provider]/route";

/**
 * The canonical verification system (docs/verification.md): explicit statuses, append-only
 * history, least-privilege review, signed idempotent provider webhooks, private evidence,
 * honest public statements, expiry, and the backfill. Fictional example.test fixtures only.
 */

resetMemoryStores();
const live = repoFor("live");
const demo = repoFor("demo");
let n = 0;

async function mechanic(name = "Robin Reyes") {
  await ready("live");
  const id = `vs-mech-${++n}`;
  const u = await provisionUser({ id, email: `${id}@example.test`, meta: { name, role: "mechanic" } });
  return live.upsertMechanicProfile({ userId: u!.id, displayName: name, city: "Los Angeles", neighborhood: "mid-city", serviceRadiusMi: 10, bio: "", workModel: "mobile", declaredRepairCategories: ["brakes"], declaredMakes: ["BMW"], hourlyRateCents: 9000, diagnosticFeeCents: 5000, availabilityNote: "Weekdays" });
}
async function staff(id = "vs-staff") {
  return (await provisionUser({ id, email: "staff@example.test", meta: { name: "Sky Staff", role: "customer" } }))!.id;
}
const pub = (mid: string) => screeningItems(toPublicProfile(live.getMechanicSources(mid), new Date()));
const item = (mid: string, key: string) => pub(mid).find((i) => i.key === key)!;

// ------------------------------------------------------------------ the record
test("statuses are explicit; moves are checked; history is appended, never overwritten", () => {
  const r = { status: "not_started" as CheckStatus, events: [] as never[] };
  transition(r, "submitted", { actor: { kind: "mechanic", id: "u" }, action: "submitted" });
  transition(r, "under_review", { actor: { kind: "staff", id: "s" }, action: "provider_update" });
  transition(r, "verified", { actor: { kind: "staff", id: "s" }, action: "approved", reasonCodes: ["evidence_matches"], expiresAt: "2030-01-01" });
  assert.throws(() => transition(r, "submitted", { actor: { kind: "mechanic", id: "u" }, action: "submitted" }), TransitionError, "a verified record never goes back");
  assert.deepEqual(
    r.events.map((e: { from?: string; to: string }) => `${e.from}>${e.to}`),
    ["not_started>submitted", "submitted>under_review", "under_review>verified"],
  );
  transition(r, "revoked", { actor: { kind: "staff", id: "s2" }, action: "revoked", reasonCodes: ["issued_in_error"] });
  assert.equal(r.events.length, 4, "the approval is still in the history after the revocation");
  for (const to of ["verified", "submitted", "in_progress"] as CheckStatus[]) assert.throws(() => transition(r, to, { actor: { kind: "staff", id: "s" }, action: "approved" }), TransitionError);
});

test("idempotency: the same key applies once", () => {
  const r = { status: "in_progress" as CheckStatus, events: [] as never[] };
  assert.equal(transition(r, "verified", { actor: { kind: "provider", id: "p" }, action: "provider_update", idempotencyKey: "evt_1" }), true);
  assert.equal(transition(r, "verified", { actor: { kind: "provider", id: "p" }, action: "provider_update", idempotencyKey: "evt_1" }), false);
  assert.equal(r.events.length, 1);
});

test("older words are read canonically; expiry and renewal are derived at every read", () => {
  assert.equal(canonStatus("pending", { method: "document_review" }), "under_review");
  assert.equal(canonStatus("pending", { method: "vendor_screening" }), "in_progress");
  assert.equal(canonStatus("rejected"), "failed");
  assert.equal(canonStatus("needs_info"), "needs_more_info");
  assert.equal(canonStatus("not_submitted"), "not_started");
  assert.equal(canonStatus("reverification_required"), "verified");
  const now = new Date("2026-09-27T12:00:00Z");
  assert.equal(effective("verified", "2026-09-26", now), "expired");
  assert.equal(effective("verified", "2026-10-10", now), "renewal_due");
  assert.equal(effective("verified", "2027-09-27", now), "verified");
  assert.equal(effective("under_review", "2020-01-01", now), "under_review", "only a verified record expires");
});

// ------------------------------------------------------------------ staff review
test("review is least-privilege: staff only, never your own, a reason always, and providers' checks aren't decided by hand", async () => {
  const m = await mechanic();
  const sid = await staff();
  await live.submitInsurance(m.id, { carrier: "Test Mutual", policyType: "general_liability", namedInsured: "Robin Reyes", effectiveOn: "2026-01-01", expiresOn: "2027-06-30", documentIds: ["doc-a"] });
  const v = live.currentCheck(m.id, "insurance")!;
  assert.equal(v.status, "submitted");
  assert.equal(item(m.id, "insurance").state, "pending", "submitted is not verified");
  await assert.rejects(live.decideVerification(v.id, "approve", m.userId, { reasonCode: "evidence_matches" }), /staff/, "not staff");
  await assert.rejects(live.decideVerification(v.id, "approve", sid, { reasonCode: "" }), /reason/i, "no reason");
  await assert.rejects(live.decideVerification(v.id, "reject", sid, { reasonCode: "coverage_not_suitable" }), /note/i, "rejection without a note");
  await assert.rejects(live.decideVerification(v.id, "approve", sid, { reasonCode: "coverage_not_suitable" }), /reason/i, "a reason that doesn't fit the action");
  await live.decideVerification(v.id, "approve", sid, { reasonCode: "evidence_matches" });
  const after = live.getVerification(v.id)!;
  assert.equal(after.status, "verified");
  assert.deepEqual(after.decidedBy, { kind: "staff", id: sid });
  assert.deepEqual(after.events!.map((e) => e.action), ["created", "submitted", "provider_update", "approved"]);
  assert.equal(after.expiresAt, "2027-06-30", "insurance uses the policy's own expiry");
  assert.match(item(m.id, "insurance").statement, /^Insurance verified by Clutch staff on .+, valid until Jun 2027$/);
  // Self-review: a staff member who is also a mechanic can't decide their own record.
  const selfStaff = await provisionUser({ id: "vs-self", email: "staff@example.test", meta: { name: "Sky Staff", role: "mechanic" } });
  const sm = await live.upsertMechanicProfile({ userId: selfStaff!.id, displayName: "Sky Staff", city: "Los Angeles", neighborhood: "mid-city", serviceRadiusMi: 10, bio: "", workModel: "mobile", declaredRepairCategories: ["brakes"], declaredMakes: ["BMW"], hourlyRateCents: 9000, diagnosticFeeCents: 5000, availabilityNote: "Weekdays" });
  await live.submitInsurance(sm.id, { carrier: "X", expiresOn: "2027-01-01", documentIds: ["doc-self"] });
  await assert.rejects(live.decideVerification(live.currentCheck(sm.id, "insurance")!.id, "approve", selfStaff!.id, { reasonCode: "evidence_matches" }), /own/);
});

test("revoking takes it out of every positive claim at once, and history keeps both decisions", async () => {
  const m = await mechanic();
  const sid = await staff();
  await live.submitInsurance(m.id, { carrier: "Test Mutual", expiresOn: "2028-01-01", documentIds: ["doc-b"] });
  const v = live.currentCheck(m.id, "insurance")!;
  await live.decideVerification(v.id, "approve", sid, { reasonCode: "evidence_matches" });
  assert.equal(item(m.id, "insurance").verified, true);
  await assert.rejects(live.decideVerification(v.id, "revoke", sid, { reasonCode: "policy_cancelled" }), /note/i, "revoking needs a note");
  await live.decideVerification(v.id, "revoke", sid, { reasonCode: "policy_cancelled", note: "Carrier says the policy was cancelled on Sep 20." });
  assert.equal(item(m.id, "insurance").verified, false);
  assert.equal(item(m.id, "insurance").statement, "Insurance not verified by Clutch");
  assert.deepEqual(live.getVerification(v.id)!.events!.map((e) => e.to), ["not_started", "submitted", "under_review", "verified", "revoked"]);
  const note = live.listNotifications(m.userId, "mechanic").find((x) => /withdrawn/.test(x.title))!;
  assert.match(note.body ?? "", /cancelled or lapsed/, "the mechanic is told why, in plain words");
});

test("a document review needs a stored document; a file name alone can't be approved", async () => {
  const m = await mechanic();
  const sid = await staff();
  await assert.rejects(live.submitInsurance(m.id, { carrier: "X", expiresOn: "2027-01-01", documentIds: [] }), /certificate/);
  await live.submitCredential(m.id, { issuer: "Other", name: "Hybrid systems", documentIds: [] } as never);
  const c = live.listVerifications({ mechanicId: m.id }).find((x) => x.category === "credential")!;
  await assert.rejects(live.decideVerification(c.id, "approve", sid, { reasonCode: "evidence_matches" }), /no stored document/);
  await live.decideVerification(c.id, "request_info", sid, { reasonCode: "document_missing_fields", note: "Please upload the certificate." });
  assert.equal(live.getVerification(c.id)!.status, "needs_more_info");
  await live.resubmit(c.id, "Uploaded it", ["doc-c"]);
  assert.equal(live.getVerification(c.id)!.status, "submitted", "the same record, answered");
  await live.decideVerification(c.id, "approve", sid, { reasonCode: "evidence_matches" });
  assert.equal(live.getVerification(c.id)!.status, "verified");
});

test("insurance renewal: the old policy counts until the new one is approved; expiry takes it off at once; reminders go out once", async () => {
  const m = await mechanic();
  const sid = await staff();
  const soon = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  await live.submitInsurance(m.id, { carrier: "Old Mutual", expiresOn: soon, documentIds: ["doc-old"] });
  const old = live.currentCheck(m.id, "insurance")!;
  await live.decideVerification(old.id, "approve", sid, { reasonCode: "evidence_matches" });
  assert.equal(item(m.id, "insurance").state, "expiring", "renewal due, still verified");
  const before = live.listNotifications(m.userId, "mechanic").length;
  assert.equal(await live.remindRenewals(new Date().toISOString(), m.id), 1);
  assert.equal(await live.remindRenewals(new Date().toISOString(), m.id), 0, "the 30-day reminder goes out once");
  assert.equal(live.listNotifications(m.userId, "mechanic").length, before + 1);
  await live.submitInsurance(m.id, { carrier: "New Mutual", expiresOn: "2028-01-01", documentIds: ["doc-new"] });
  assert.equal(item(m.id, "insurance").verified, true, "the pending renewal doesn't hide the valid policy");
  const renewal = live.listVerifications({ mechanicId: m.id }).find((x) => x.category === "insurance" && x.id !== old.id)!;
  assert.equal(renewal.supersedes, old.id);
  await live.decideVerification(renewal.id, "approve", sid, { reasonCode: "evidence_matches" });
  assert.equal(live.getVerification(old.id)!.supersededBy, renewal.id);
  assert.match(item(m.id, "insurance").statement, /valid until Jan 2028/);
  // Expiry: past the date it reads expired immediately, whatever the sweep did.
  const later = new Date(Date.now() + 900 * 86_400_000);
  assert.equal(screeningItems(toPublicProfile(live.getMechanicSources(m.id), later)).find((i) => i.key === "insurance")!.state, "expired");
  assert.equal(await live.remindRenewals(later.toISOString(), m.id), 1, "the expiry is recorded once");
  assert.equal(await live.remindRenewals(later.toISOString(), m.id), 0);
  assert.equal(live.getVerification(renewal.id)!.status, "expired");
});

// ------------------------------------------------------------------ identity provider
test("webhook signatures: valid, tampered, stale and malformed are told apart", () => {
  const body = '{"id":"evt_1"}';
  const secret = "whsec_test";
  verifySignature(body, sign(body, secret), secret);
  assert.throws(() => verifySignature(body + " ", sign(body, secret), secret), WebhookRejected, "tampered body");
  assert.throws(() => verifySignature(body, sign(body, "other"), secret), WebhookRejected, "wrong secret");
  assert.throws(() => verifySignature(body, sign(body, secret, Date.now() - 10 * 60_000), secret), /stale/, "replayed later");
  assert.throws(() => verifySignature(body, "v1=abc", secret), WebhookRejected);
  assert.throws(() => verifySignature(body, null, secret), /missing/);
});

test("Stripe Identity results map to canonical statuses and reasons; the verified name is compared and discarded", () => {
  const base = { id: "vs_1", metadata: { clutch_record: "ver-1", clutch_account: "u-1", clutch_scope: "live" } };
  assert.equal(mapStripe({ ...base, status: "verified", verified_outputs: { first_name: "Robin", last_name: "Reyes" } }, "Robin Reyes").status, "verified");
  const mismatch = mapStripe({ ...base, status: "verified", verified_outputs: { first_name: "Someone", last_name: "Else" } }, "Robin Reyes");
  assert.deepEqual([mismatch.status, mismatch.reasonCodes, mismatch.nameMatches], ["needs_more_info", ["name_mismatch"], false]);
  assert.equal(JSON.stringify(mismatch).includes("Someone"), false, "the ID's name is never kept");
  assert.deepEqual(mapStripe({ ...base, status: "requires_input", last_error: { code: "selfie_face_mismatch" } }, "x").reasonCodes, ["selfie_retake"]);
  assert.equal(mapStripe({ ...base, status: "requires_input", last_error: { code: "selfie_manipulated" } }, "x").status, "failed");
  assert.equal(mapStripe({ ...base, status: "requires_input", last_error: { code: "document_expired" } }, "x").status, "needs_more_info");
  assert.equal(mapStripe({ ...base, status: "requires_input" }, "x").status, "in_progress");
  assert.equal(mapStripe({ ...base, status: "processing" }, "x").status, "under_review");
  assert.equal(mapStripe({ ...base, status: "canceled" }, "x").status, "not_started");
  assert.ok(sameName("Robin  Reyes", "robin reyes") && sameName("José Núñez", "Jose Nunez Garcia") && !sameName("Rob Reyes", "Robin Reyes"));
});

test("Stripe adapter: server-side session with live capture and a matching selfie, idempotency key, no secrets in errors; outages are distinguishable", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: "vs_abc", status: "requires_input", url: "https://verify.stripe.com/start/abc" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const p = new StripeIdentityProvider("rk_test_123", "whsec_x", fake);
  const s = await p.createSession({ recordId: "ver-9", accountId: "u-9", scope: "live", returnUrl: "https://clutch.example/r", idempotencyKey: "identity:ver-9:0" });
  assert.equal(s.url, "https://verify.stripe.com/start/abc");
  const body = new URLSearchParams(String(calls[0].init.body));
  assert.equal(body.get("options[document][require_live_capture]"), "true");
  assert.equal(body.get("options[document][require_matching_selfie]"), "true");
  assert.equal(body.get("metadata[clutch_record]"), "ver-9");
  assert.equal((calls[0].init.headers as Record<string, string>)["Idempotency-Key"], "identity:ver-9:0");
  const down = new StripeIdentityProvider("rk_test_123", "whsec_x", (async () => new Response("", { status: 503 })) as typeof fetch);
  await assert.rejects(down.fetchResult("vs_abc", "x"), /unavailable/);
  await assert.rejects(p.fetchResult("../../etc", "x"), WebhookRejected, "only well-formed session ids are fetched");
});

test("configuration: live identity needs Stripe keys; the test provider is refused outside isolated runs; background stays closed without a provider and an approved policy", () => {
  const env = { ...process.env };
  try {
    delete process.env.CLUTCH_IDENTITY_PROVIDER;
    assert.equal(identityConfig("live").provider, undefined);
    assert.match(identityConfig("live").problems.join(" "), /No identity provider/);
    process.env.CLUTCH_IDENTITY_PROVIDER = "stripe_identity";
    process.env.STRIPE_IDENTITY_SECRET_KEY = "not-a-key";
    assert.match(identityConfig("live").problems.join(" "), /STRIPE_IDENTITY_SECRET_KEY/);
    process.env.CLUTCH_IDENTITY_PROVIDER = "test";
    delete process.env.CLUTCH_TEST_PROVIDERS;
    assert.equal(identityConfig("live").provider, undefined, "no fake passing check for real mechanics");
    process.env.CLUTCH_TEST_PROVIDERS = "on";
    process.env.VERCEL_ENV = "production";
    assert.equal(identityConfig("live").provider, undefined, "never on a production deployment");
    assert.equal(identityConfig("demo").provider?.key, "test", "the fictional demo uses the test provider");
    delete process.env.CLUTCH_BACKGROUND_PROVIDER;
    assert.equal(screeningOpen("background", "live"), false);
    assert.ok(screeningProblems().length >= 2);
    assert.equal(screeningOpen("identity", "live"), false, "identity is never a screening");
  } finally {
    process.env = env;
  }
});

test("end to end (test provider): start → hosted page → signed webhook (twice) → verified on the profile; late and replayed events change nothing", async () => {
  const env = { ...process.env };
  process.env.CLUTCH_TEST_PROVIDERS = "on";
  process.env.CLUTCH_IDENTITY_PROVIDER = "test";
  delete process.env.VERCEL_ENV;
  try {
    const m = await mechanic("Dana Ortiz");
    assert.equal(item(m.id, "identity").statement, "Identity not verified by Clutch");
    const rec = await live.prepareIdentityCheck(m.id);
    const session = await testIdentityProvider.createSession({ recordId: rec.id, accountId: m.userId, scope: "live", returnUrl: "/r", idempotencyKey: "k" });
    await live.recordIdentityStart(m.id, { provider: "test", providerRef: session.providerRef, recordId: rec.id });
    assert.equal(live.getVerification(rec.id)!.status, "in_progress");
    assert.equal(item(m.id, "identity").state, "pending", "in progress is not verified");
    testIdentityProvider.complete(session.providerRef, "verified", "Dana Ortiz");
    const event = (id: string) => {
      const body = JSON.stringify({ id, type: "identity.verification_session.updated", data: { object: { id: session.providerRef, object: "identity.verification_session" } } });
      return new Request("http://localhost/api/verification/webhook/test", { method: "POST", body, headers: { "stripe-signature": sign(body, testIdentitySecret()) } });
    };
    const params = { params: Promise.resolve({ provider: "test" }) };
    const r1 = await webhook(event("evt_a") as never, params);
    assert.equal(r1.status, 200);
    assert.equal((await r1.json()).applied, true);
    const r2 = await webhook(event("evt_a") as never, params);
    assert.equal((await r2.json()).applied, false, "a duplicate delivery changes nothing");
    const bad = event("evt_b");
    const tampered = new Request(bad.url, { method: "POST", body: (await bad.text()).replace("evt_b", "evt_c"), headers: bad.headers });
    assert.equal((await webhook(tampered as never, params)).status, 400, "a tampered body is refused");
    const v = live.getVerification(rec.id)!;
    assert.equal(v.status, "verified");
    assert.equal(v.nameMatches, true);
    assert.equal(v.events!.filter((e) => e.to === "verified").length, 1);
    assert.match(item(m.id, "identity").statement, /^Identity verified by Clutch's test provider \(not a real check\) on /);
    assert.ok(live.listNotifications(m.userId, "mechanic").some((x) => x.title === "Identity: verified"));
    // A late "processing" is recorded, never applied.
    testIdentityProvider.complete(session.providerRef, "processing");
    await webhook(event("evt_late") as never, params);
    assert.equal(live.getVerification(rec.id)!.status, "verified");
    // Nothing identifying was stored: no document, selfie, number or date of birth fields exist.
    assert.deepEqual(Object.keys(v).filter((k) => /document(Url|Number)|selfie|birth|dob|idNumber|score/i.test(k)), []);
    await assert.rejects(live.prepareIdentityCheck(m.id), /already verified/);
  } finally {
    process.env = env;
  }
});

test("identity failure paths: cancel resumes the same record; retake asks for more; a hard fail needs a new record that supersedes it", async () => {
  const env = { ...process.env };
  process.env.CLUTCH_TEST_PROVIDERS = "on";
  try {
    const m = await mechanic("Lee Park");
    const run = async (outcome: Parameters<typeof testIdentityProvider.complete>[1], eventId: string) => {
      const rec = await live.prepareIdentityCheck(m.id);
      const s = await testIdentityProvider.createSession({ recordId: rec.id, accountId: m.userId, scope: "live", returnUrl: "/r", idempotencyKey: eventId });
      await live.recordIdentityStart(m.id, { provider: "test", providerRef: s.providerRef, recordId: rec.id });
      testIdentityProvider.complete(s.providerRef, outcome, "Lee Park");
      const r = await testIdentityProvider.fetchResult(s.providerRef, "Lee Park");
      await live.applyProviderResult({ providerRef: s.providerRef, recordId: rec.id, status: r.status, reasonCodes: r.reasonCodes, eventId, provider: "test" });
      return rec.id;
    };
    const a = await run("cancelled", "e1");
    assert.equal(live.getVerification(a)!.status, "not_started");
    const b = await run("selfie_mismatch", "e2");
    assert.equal(b, a, "cancelling and retaking continue the same record");
    assert.equal(live.getVerification(b)!.status, "needs_more_info");
    assert.match(live.listNotifications(m.userId, "mechanic").find((x) => x.title === "Identity: more information needed")!.body ?? "", /selfie/i, "told what to change");
    const c = await run("manipulated", "e3");
    assert.equal(live.getVerification(c)!.status, "failed");
    const d = await live.prepareIdentityCheck(m.id);
    assert.notEqual(d.id, c, "a new record after a failure");
    assert.equal(d.supersedes, c);
    assert.equal(live.getVerification(c)!.supersededBy, d.id);
    assert.equal(live.getVerification(c)!.status, "failed", "the failed record keeps its outcome and history");
  } finally {
    process.env = env;
  }
});

test("a result for a session bound to another record is refused", async () => {
  const m = await mechanic("Kim Lau");
  const rec = await live.prepareIdentityCheck(m.id);
  await live.recordIdentityStart(m.id, { provider: "test", providerRef: "test_vs_bound", recordId: rec.id });
  await assert.rejects(live.applyProviderResult({ providerRef: "test_vs_bound", recordId: "ver-someone-else", status: "verified", reasonCodes: [], eventId: "x", provider: "test" }), /doesn't belong/);
  await assert.rejects(live.applyProviderResult({ providerRef: "test_vs_unknown", status: "verified", reasonCodes: [], eventId: "y", provider: "test" }), /No check/);
});

// ------------------------------------------------------------------ documents
test("document links are bound to one file and one viewer, and expire", () => {
  const url = docLink("media-1", "staff-1");
  const token = new URL(url, "http://x").searchParams.get("vt");
  assert.ok(checkDocToken(token, "media-1", "staff-1"));
  assert.ok(!checkDocToken(token, "media-2", "staff-1"), "another file");
  assert.ok(!checkDocToken(token, "media-1", "staff-2"), "another viewer");
  assert.ok(!checkDocToken(token, "media-1", "staff-1", Date.now() + 10 * 60_000), "expired");
  assert.ok(!checkDocToken("123.abc", "media-1", "staff-1"));
});

// ------------------------------------------------------------------ demo and live
test("demo and live stay apart: the demo's records are fictional and never reach the real queue", async () => {
  await ready("demo");
  const demoIds = new Set(current("demo").verifications.map((v) => v.id));
  assert.ok(live.listVerifications().every((v) => !demoIds.has(v.id)));
  assert.ok(current("demo").verifications.every((v) => v.events?.length), "every demo record has a history");
  const derek = demo.getMechanicBySlug("derek-hall")!;
  const id = screeningItems(toPublicProfile(demo.getMechanicSources(derek.id))).find((i) => i.key === "identity")!;
  assert.match(id.statement, /a demo provider \(fictional\)/, "demo verifications say they're fictional");
});

// ------------------------------------------------------------------ migration
test("backfill: canonical statuses, rebuilt history, unbacked approvals marked, stand-in approvals revoked, email checks added; a rerun changes nothing", () => {
  const seed = buildSeed();
  const m = seed.mechanics[0];
  const legacy = [
    { id: "v1", mechanicId: m.id, subjectType: "insurance_record", subjectId: "i1", category: "insurance", method: "document_review", status: "verified", submittedAt: "2026-08-01", verifiedAt: "2026-08-02", reviewerId: "staff" },
    { id: "v2", mechanicId: m.id, subjectType: "screening_check", subjectId: "s1", category: "identity", method: "vendor_screening", provider: "mock", status: "verified", submittedAt: "2026-08-01", verifiedAt: "2026-08-01" },
    { id: "v3", mechanicId: m.id, subjectType: "credential", subjectId: "c1", category: "credential", method: "document_review", status: "needs_info", submittedAt: "2026-08-03", notes: "Blurry" },
    { id: "v4", mechanicId: m.id, subjectType: "employment", subjectId: "e1", category: "employment", method: "employer_check", status: "pending", submittedAt: "2026-08-03" },
  ] as never[];
  const db = { verifications: legacy, screenings: [{ id: "s1", mechanicId: m.id, kind: "identity", provider: "mock", providerRef: "r", status: "pending" }] as never[], mechanics: [m], users: seed.users };
  const plan = planVerificationMigration(db, "live", "2026-09-27T12:00:00.000Z");
  const after = Object.fromEntries(plan.updates.map((u) => [u.id, u.after as Record<string, unknown>]));
  assert.equal((after.v1 as { legacy: { unbacked: boolean } }).legacy.unbacked, true, "approved from a file name only");
  assert.equal(after.v2.status, "revoked", "the stand-in never checked a real person");
  assert.deepEqual(after.v2.reasonCodes, ["legacy_unverified_provider"]);
  assert.equal(after.v3.status, "needs_more_info");
  assert.equal(after.v4.status, "under_review");
  assert.equal(after.s1.status, "in_progress");
  assert.ok((after.v1.events as { action: string }[])[0].action === "migrated");
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0].category, "email");
  // Apply and rerun: nothing more to do.
  const applied = { ...db, verifications: [...legacy.map((v: { id: string }) => (after[v.id] ?? v) as never), ...plan.creates], screenings: [after.s1 as never] };
  const again = planVerificationMigration(applied, "live");
  assert.deepEqual(again.updates, []);
  assert.deepEqual(again.creates, []);
  // The unbacked approval no longer counts publicly.
  const p = toPublicProfile({ mechanic: m, screenings: [], insurance: [{ id: "i1", mechanicId: m.id, carrier: "X", policyLast4: "", coverageCents: 0, documentName: "coi.pdf", effectiveOn: "2026-01-01", expiresOn: "2028-01-01" }], credentials: [], employment: [], pastRepairs: [], reviews: [], verifications: [after.v1 as never], scope: "live" });
  assert.equal(screeningItems(p).find((i) => i.key === "insurance")!.verified, false);
});
