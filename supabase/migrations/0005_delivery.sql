-- Outbound alert delivery (email now, SMS later), independent of how marketplace records
-- are stored. In-app notifications are the source of truth; this queue only carries optional
-- alerts about them, written in the same transaction as the notification, so an alert can
-- never exist for something that didn't commit. Nothing here changes marketplace state.
--
-- Privacy: no email addresses, phone numbers, names or repair details are stored. An event
-- holds its type, the recipient's account id, and a path inside Clutch; the recipient's
-- contact is looked up only at send time. Attempt records keep a redacted preview.
--
-- Idempotent; the app applies it on boot and the delivery worker before running.

create table if not exists delivery_outbox (
  id bigserial primary key,
  -- Only the real marketplace ever gets alerts; demo events can't be queued.
  scope text not null default 'live' check (scope = 'live'),
  event_key text not null unique,
  event_type text not null,
  channel text not null check (channel in ('email', 'sms')),
  user_id text not null,
  audience text not null check (audience in ('customer', 'mechanic')),
  link_path text not null check (link_path ~ '^/[A-Za-z0-9/_.#?=&-]*$'),
  source_notification_id text not null,
  state text not null default 'pending'
    check (state in ('pending', 'processing', 'sent', 'retry', 'failed', 'suppressed', 'no_provider')),
  suppressed_reason text,
  -- Provider sends attempted (no-provider and suppression checks don't count).
  send_attempts int not null default 0 check (send_attempts >= 0),
  max_attempts int not null default 6 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_until timestamptz,
  -- The last send's outcome was unknown (e.g. a timeout after the provider may have accepted it).
  uncertain boolean not null default false,
  provider text,
  provider_message_id text,
  sent_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- "sent" means a provider accepted it and gave an id; nothing else may claim delivery.
  check ((state = 'sent') = (provider_message_id is not null and sent_at is not null)),
  check (state <> 'processing' or (lease_owner is not null and lease_until is not null)),
  check (state <> 'suppressed' or suppressed_reason is not null)
);
create unique index if not exists delivery_outbox_provider_msg on delivery_outbox (provider, provider_message_id) where provider_message_id is not null;
create index if not exists delivery_outbox_due on delivery_outbox (state, next_attempt_at);
-- Only undelivered events, in claim order: the worker's due query reads this, and sent,
-- suppressed and failed events drop out of it however long the history grows.
create index if not exists delivery_outbox_open on delivery_outbox (next_attempt_at, id) where state in ('pending', 'retry', 'processing', 'no_provider');

create table if not exists delivery_attempts (
  id bigserial primary key,
  outbox_id bigint not null references delivery_outbox (id),
  seq int not null,
  worker text not null,
  adapter text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text not null check (outcome in ('sent', 'retry', 'failed', 'suppressed', 'no_provider', 'lease_lost', 'recovered_sent')),
  provider_message_id text,
  error_code text,
  -- Redacted: never an address, number, name or message body.
  error_summary text,
  recipient_hint text,
  preview jsonb,
  unique (outbox_id, seq)
);

create or replace function delivery_attempts_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'delivery_attempts rows can''t be changed or deleted' using errcode = 'check_violation';
end $$;
drop trigger if exists delivery_attempts_append_only on delivery_attempts;
create trigger delivery_attempts_append_only before update or delete on delivery_attempts for each row execute function delivery_attempts_append_only();

-- Once sent, an event never goes back to a sendable state.
create or replace function delivery_sent_is_final() returns trigger language plpgsql as $$
begin
  if old.state = 'sent' and (new.state <> 'sent' or new.provider_message_id is distinct from old.provider_message_id) then
    raise exception 'delivery event % was already sent', old.id using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists delivery_sent_final on delivery_outbox;
create trigger delivery_sent_final before update on delivery_outbox for each row execute function delivery_sent_is_final();

alter table delivery_outbox enable row level security;
alter table delivery_attempts enable row level security;
