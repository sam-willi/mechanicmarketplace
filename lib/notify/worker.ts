import type postgres from "postgres";
import { DELIVERY_EVENTS, isTestAddress, recipientHint, renderAlert, type DeliveryEventType } from "./events";
import { ProviderError, type EmailProvider } from "./providers";

/**
 * Delivery worker: claims due alerts with a lease, decides whether each may be sent, sends
 * through the provider (if one is configured), and records every attempt.
 *
 * Safe with any number of workers and schedules:
 *  - claiming uses `FOR UPDATE SKIP LOCKED` and a lease; a crashed worker's lease expires and
 *    the event is picked up again;
 *  - every send carries the event's idempotency key; after a timeout the next attempt first
 *    asks the provider whether it already accepted the message (`lookup`), so it's never sent
 *    twice; once an event is "sent" (with a provider message id) the database won't let it be
 *    claimed or sent again;
 *  - no provider configured → "no_provider": nothing sent, a redacted preview recorded, and the
 *    event is picked up automatically once a provider is configured.
 * It never changes marketplace records and never logs an address, number, name or message.
 */

export interface Recipient {
  exists: boolean;
  demo: boolean;
  email?: string;
  emailVerified: boolean;
  wantsEmail: boolean;
}

export interface WorkerOptions {
  sql: postgres.Sql;
  provider: EmailProvider | null;
  workerId: string;
  /** Public origin for links, e.g. https://clutch.example. */
  origin: string;
  loadRecipient: (userId: string) => Promise<Recipient>;
  batch?: number;
  leaseMs?: number;
  sendTimeoutMs?: number;
  /** Test hook: runs after an event is claimed and before it's processed (simulate a crash by throwing). */
  afterClaim?: (id: number) => Promise<void>;
}

export interface RunSummary {
  claimed: number;
  sent: number;
  retry: number;
  failed: number;
  suppressed: number;
  noProvider: number;
  leaseLost: number;
}

interface Row {
  id: string;
  event_key: string;
  event_type: string;
  channel: "email" | "sms";
  user_id: string;
  link_path: string;
  send_attempts: number;
  max_attempts: number;
  uncertain: boolean;
  provider_message_id: string | null;
}

/** Exponential backoff with jitter: 30s, 1m, 2m… capped at 6h. */
export function backoffMs(attempt: number, rand = Math.random()) {
  const base = Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 6 * 3600_000);
  return Math.round(base * (0.8 + 0.4 * rand));
}

/** Strip anything that looks like an address or phone number from a provider error. */
export function redact(text: string) {
  return text
    .replace(/[^\s@<>"']+@[^\s@<>"']+/g, "[address]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[number]")
    .slice(0, 200);
}

export async function runDeliveryOnce(o: WorkerOptions): Promise<RunSummary> {
  const { sql, provider } = o;
  const leaseMs = o.leaseMs ?? 60_000;
  const summary: RunSummary = { claimed: 0, sent: 0, retry: 0, failed: 0, suppressed: 0, noProvider: 0, leaseLost: 0 };
  const claimed = await sql<Row[]>`
    with due as (
      select id from delivery_outbox
      where scope = 'live' and (
        (state in ('pending', 'retry') and next_attempt_at <= now())
        or (state = 'processing' and lease_until < now())
        or (state = 'no_provider' and ${provider !== null})
      )
      order by next_attempt_at, id
      limit ${o.batch ?? 20}
      for update skip locked
    )
    update delivery_outbox d
    set state = 'processing', lease_owner = ${o.workerId}, lease_until = now() + (${leaseMs}::int * interval '1 millisecond'), updated_at = now()
    -- By id (primary key) rather than a join, so a large outbox is never scanned to update one batch.
    where d.id = any(array(select id from due))
    returning d.id::text, d.event_key, d.event_type, d.channel, d.user_id, d.link_path, d.send_attempts, d.max_attempts, d.uncertain, d.provider_message_id`;
  summary.claimed = claimed.length;

  for (const e of claimed) {
    if (o.afterClaim) await o.afterClaim(Number(e.id));
    const outcome = await processOne(o, e, provider);
    summary[outcome]++;
  }
  return summary;
}

type Outcome = "sent" | "retry" | "failed" | "suppressed" | "noProvider" | "leaseLost";

async function processOne(o: WorkerOptions, e: Row, provider: EmailProvider | null): Promise<Outcome> {
  const { sql } = o;
  const type = e.event_type as DeliveryEventType;
  const known = type in DELIVERY_EVENTS;
  const who = await o.loadRecipient(e.user_id);
  const hint = recipientHint(e.channel, who.emailVerified);
  const alert = known ? renderAlert(type, e.link_path, o.origin) : null;
  // A preview that shows what would be sent, with no contact details (the link is a path inside Clutch).
  const preview = alert ? { subject: alert.subject, text: alert.text.replace(o.origin.replace(/\/$/, ""), "{APP_URL}") } : null;
  const attempt = async (outcome: string, extra: { messageId?: string; code?: string; summary?: string } = {}) => {
    await sql`insert into delivery_attempts (outbox_id, seq, worker, adapter, outcome, provider_message_id, error_code, error_summary, recipient_hint, preview, finished_at)
      values (${e.id}, (select coalesce(max(seq), 0) + 1 from delivery_attempts where outbox_id = ${e.id}), ${o.workerId}, ${provider?.key ?? "none"}, ${outcome},
        ${extra.messageId ?? null}, ${extra.code ?? null}, ${extra.summary ? redact(extra.summary) : null}, ${hint}, ${preview ? sql.json(preview) : null}, now())`;
  };
  /** Finish only if this worker still holds the lease; otherwise another worker has it now. */
  const finish = async (fields: Record<string, postgres.ParameterOrJSON<never>>) => {
    const res = await sql`update delivery_outbox set ${sql(fields)}, lease_owner = null, lease_until = null, updated_at = now()
      where id = ${e.id} and state = 'processing' and lease_owner = ${o.workerId}`;
    return res.count === 1;
  };

  // Who may get this at all. Suppression is final and says why (never revealing the contact).
  const reason = !known
    ? "unknown_event"
    : !who.exists
      ? "no_account"
      : who.demo
        ? "demo_account"
        : !who.email
          ? "no_contact"
          : isTestAddress(who.email)
            ? "test_recipient"
            : !who.wantsEmail
              ? "preference_off"
              : !who.emailVerified
                ? "unverified_contact"
                : null;
  if (reason) {
    if (!(await finish({ state: "suppressed", suppressed_reason: reason }))) return lost();
    await attempt("suppressed", { code: reason });
    return "suppressed";
  }

  if (!provider) {
    // Nothing is sent. Waits, retryable, until a provider is configured (then picked up at once).
    if (!(await finish({ state: "no_provider", next_attempt_at: new Date(Date.now() + 3600_000) }))) return lost();
    await attempt("no_provider", { code: "no_provider" });
    return "noProvider";
  }

  // After an uncertain send, ask the provider before trying again.
  if (e.uncertain && provider.lookup) {
    const found = await provider.lookup(e.event_key).catch(() => null);
    if (found) {
      await markSent(found.messageId, "recovered_sent");
      return "sent";
    }
  }

  // Still ours? (A slow worker whose lease expired must not send.)
  const renewed = await sql`update delivery_outbox set lease_until = now() + (${o.leaseMs ?? 60_000}::int * interval '1 millisecond')
    where id = ${e.id} and state = 'processing' and lease_owner = ${o.workerId} returning 1`;
  if (!renewed.length) return lost();

  try {
    const res = await withTimeout(provider.send({ to: who.email!, subject: alert!.subject, text: alert!.text, idempotencyKey: e.event_key }, { timeoutMs: o.sendTimeoutMs ?? 10_000 }), o.sendTimeoutMs ?? 10_000);
    await markSent(res.messageId, "sent");
    return "sent";
  } catch (err) {
    const pe = err instanceof ProviderError ? err : new ProviderError((err as Error).message ?? "error", "retryable", "unexpected");
    const attempts = e.send_attempts + 1;
    if (pe.kind === "permanent" || attempts >= e.max_attempts) {
      if (!(await finish({ state: "failed", send_attempts: attempts, last_error_code: pe.kind === "permanent" ? pe.code : "max_attempts", uncertain: pe.kind === "timeout" }))) return lost();
      await attempt("failed", { code: pe.kind === "permanent" ? pe.code : "max_attempts", summary: pe.message });
      return "failed";
    }
    const ok = await finish({
      state: "retry",
      send_attempts: attempts,
      next_attempt_at: new Date(Date.now() + backoffMs(attempts)),
      last_error_code: pe.code,
      // A timeout may have been accepted: look it up before sending again.
      uncertain: pe.kind === "timeout" || e.uncertain,
    });
    if (!ok) return lost();
    await attempt("retry", { code: pe.code, summary: pe.message });
    return "retry";
  }

  /** Record a provider-accepted message. Never needs the lease: it's the truth either way. */
  async function markSent(messageId: string, outcome: "sent" | "recovered_sent") {
    await sql`update delivery_outbox set state = 'sent', provider = ${provider!.key}, provider_message_id = ${messageId}, sent_at = now(),
      send_attempts = send_attempts + ${outcome === "sent" ? 1 : 0}, uncertain = false, lease_owner = null, lease_until = null, updated_at = now()
      where id = ${e.id} and state <> 'sent'`;
    await attempt(outcome, { messageId });
  }
  async function lost(): Promise<Outcome> {
    await attempt("lease_lost", { code: "lease_lost" });
    return "leaseLost";
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new ProviderError("no answer from the provider in time", "timeout", "timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Contact and preferences for a live account. Reads the active live store first
 * (CLUTCH_LIVE_STORE), then the other one, so a worker started without the same setting as
 * the app still finds the account instead of suppressing every alert as "no account".
 */
export function recipientLoader(sql: postgres.Sql, normalized = process.env.CLUTCH_LIVE_STORE === "normalized") {
  let hasNormalized: Promise<boolean> | undefined;
  const fromNormalized = async (userId: string) => {
    hasNormalized ??= sql<{ t: string | null }[]>`select to_regclass('lv_users')::text as t`.then((r) => Boolean(r[0]?.t));
    if (!(await hasNormalized)) return undefined;
    return (await sql<{ data: Record<string, unknown> }[]>`select data from lv_users where id = ${userId}`)[0];
  };
  const fromSnapshot = async (userId: string) =>
    (await sql<{ data: Record<string, unknown> }[]>`select data from app_records where scope = 'live' and collection = 'users' and id = ${userId}`)[0];
  return async (userId: string): Promise<Recipient> => {
    const row = normalized ? ((await fromNormalized(userId)) ?? (await fromSnapshot(userId))) : ((await fromSnapshot(userId)) ?? (await fromNormalized(userId)));
    if (!row) return { exists: false, demo: false, emailVerified: false, wantsEmail: false };
    const d = row.data;
    const prefs = (d.notificationPrefs ?? {}) as { email?: boolean };
    return {
      exists: true,
      demo: d.demo === true,
      email: typeof d.email === "string" ? d.email : undefined,
      emailVerified: typeof d.emailVerifiedAt === "string",
      wantsEmail: prefs.email !== false,
    };
  };
}

/** Delivery health for staff: counts and ages only; attempt details are already redacted. */
export async function deliveryHealth(sql: postgres.Sql) {
  const byState = await sql<{ state: string; n: string }[]>`select state, count(*)::text as n from delivery_outbox group by state`;
  const byEvent = await sql<{ event_type: string; state: string; n: string }[]>`select event_type, state, count(*)::text as n from delivery_outbox group by event_type, state order by event_type, state`;
  const [oldest] = await sql<{ age: number | null }[]>`select extract(epoch from now() - min(created_at))::int as age from delivery_outbox where state in ('pending', 'retry', 'no_provider', 'processing')`;
  const recent = await sql<{ id: string; event_type: string; outcome: string; adapter: string; error_code: string | null; error_summary: string | null; recipient_hint: string | null; started_at: Date }[]>`
    select a.outbox_id::text as id, o.event_type, a.outcome, a.adapter, a.error_code, a.error_summary, a.recipient_hint, a.started_at
    from delivery_attempts a join delivery_outbox o on o.id = a.outbox_id order by a.id desc limit 20`;
  const failures = await sql<{ id: string; event_type: string; state: string; send_attempts: number; last_error_code: string | null; updated_at: Date }[]>`
    select id::text, event_type, state, send_attempts, last_error_code, updated_at from delivery_outbox where state in ('failed', 'retry') order by updated_at desc limit 20`;
  const suppressed = await sql<{ reason: string; n: string }[]>`select suppressed_reason as reason, count(*)::text as n from delivery_outbox where state = 'suppressed' group by suppressed_reason`;
  return {
    byState: Object.fromEntries(byState.map((r) => [r.state, Number(r.n)])) as Record<string, number>,
    byEvent: byEvent.map((r) => ({ event: r.event_type, state: r.state, n: Number(r.n) })),
    oldestWaitingSeconds: oldest?.age ?? null,
    recent,
    failures,
    suppressed: suppressed.map((r) => ({ reason: r.reason, n: Number(r.n) })),
  };
}
