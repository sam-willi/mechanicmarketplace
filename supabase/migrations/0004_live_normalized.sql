-- Normalized, transactional storage for the REAL (live) marketplace.
--
-- One table per entity, typed columns for every relationship, status and amount,
-- child tables for lists (invitations, questions, estimate versions, extra work,
-- payment reports, lifecycle history, review edits, support messages), and the
-- rules the app enforces repeated here as constraints and triggers so that no
-- write path, instance or race can break them:
--   * one accepted estimate and one active job per request; one job per estimate;
--     one review per job, only for a completed job;
--   * estimates only from invited mechanics; jobs only from that estimate's
--     mechanic and the request's own customer; requests only for the customer's
--     own car (composite foreign keys, so cross-owner links are impossible);
--   * valid status transitions only; an accepted estimate's version and price
--     never change; history, estimate versions, review edits and support
--     messages are append-only;
--   * idempotency keys are unique per customer; outbox events are unique per key;
--   * every row has a version for compare-and-swap updates across instances.
-- Descriptive fields that no rule depends on stay in each row's `data` jsonb.
--
-- Demo (fictional) records never enter these tables: users carry demo = false by
-- constraint, and the app only writes here for the live scope.
--
-- Idempotent: safe to run more than once. The app applies it on boot when
-- CLUTCH_LIVE_STORE=normalized; scripts/migrate-live.ts applies it before copying.

create sequence if not exists lv_change_seq;

-- ------------------------------------------------------------------ accounts
create table if not exists lv_users (
  id text primary key,
  email text not null,
  name text not null,
  demo boolean not null default false check (demo = false),
  data jsonb not null,
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists lv_users_email on lv_users (lower(email));

create table if not exists lv_user_roles (
  user_id text not null references lv_users (id) deferrable initially deferred,
  role text not null check (role in ('customer', 'mechanic', 'admin')),
  primary key (user_id, role)
);

create table if not exists lv_customers (
  id text primary key,
  user_id text not null unique references lv_users (id) deferrable initially deferred,
  data jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lv_vehicles (
  id text primary key,
  customer_id text not null references lv_customers (id) deferrable initially deferred,
  year int not null check (year between 1950 and 2100),
  make text not null,
  model text not null,
  data jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, customer_id)
);

-- ------------------------------------------------------------------ mechanics
create table if not exists lv_mechanics (
  id text primary key,
  user_id text not null unique references lv_users (id) deferrable initially deferred,
  slug text not null unique,
  work_model text not null check (work_model in ('mobile', 'shop', 'both')),
  neighborhood text,
  service_radius_mi int not null check (service_radius_mi between 0 and 200),
  hourly_rate_cents int not null check (hourly_rate_cents >= 0),
  diagnostic_fee_cents int not null check (diagnostic_fee_cents >= 0),
  data jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists lv_mechanic_categories (
  mechanic_id text not null references lv_mechanics (id) deferrable initially deferred,
  category text not null,
  primary key (mechanic_id, category)
);
create table if not exists lv_mechanic_makes (
  mechanic_id text not null references lv_mechanics (id) deferrable initially deferred,
  make text not null,
  primary key (mechanic_id, make)
);
create table if not exists lv_mechanic_openings (
  mechanic_id text not null references lv_mechanics (id) deferrable initially deferred,
  on_date text not null,
  at_time text not null,
  primary key (mechanic_id, on_date, at_time)
);

create table if not exists lv_screenings (
  id text primary key,
  mechanic_id text not null references lv_mechanics (id) deferrable initially deferred,
  kind text not null check (kind in ('identity', 'background', 'driving_record')),
  provider text not null,
  status text not null check (status in ('not_submitted', 'pending', 'verified', 'rejected', 'needs_info', 'expired', 'reverification_required')),
  data jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists lv_insurance (
  id text primary key,
  mechanic_id text not null references lv_mechanics (id) deferrable initially deferred,
  expires_on text not null,
  data jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists lv_credentials (
  id text primary key,
  mechanic_id text not null references lv_mechanics (id) deferrable initially deferred,
  data jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists lv_employment (
  id text primary key,
  mechanic_id text not null references lv_mechanics (id) deferrable initially deferred,
  data jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists lv_verifications (
  id text primary key,
  mechanic_id text not null references lv_mechanics (id) deferrable initially deferred,
  subject_type text not null,
  subject_id text not null,
  category text not null,
  status text not null check (status in ('not_submitted', 'pending', 'verified', 'rejected', 'needs_info', 'expired', 'reverification_required')),
  reviewer_id text references lv_users (id) deferrable initially deferred,
  data jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ requests
create table if not exists lv_requests (
  id text primary key,
  customer_id text not null references lv_customers (id) deferrable initially deferred,
  vehicle_id text not null,
  status text not null check (status in ('draft', 'open', 'quoted', 'booked', 'completed', 'cancelled')),
  idempotency_key text,
  data jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, customer_id),
  -- The car must be this customer's own.
  foreign key (vehicle_id, customer_id) references lv_vehicles (id, customer_id) deferrable initially deferred
);
create unique index if not exists lv_requests_idempotency on lv_requests (customer_id, idempotency_key) where idempotency_key is not null;

-- Who a request was sent to, and what they did with it.
create table if not exists lv_request_invitations (
  request_id text not null references lv_requests (id) deferrable initially deferred,
  mechanic_id text not null references lv_mechanics (id) deferrable initially deferred,
  declined boolean not null default false,
  interested boolean not null default false,
  primary key (request_id, mechanic_id)
);

create table if not exists lv_request_questions (
  request_id text not null references lv_requests (id) deferrable initially deferred,
  seq int not null check (seq >= 0),
  mechanic_id text not null,
  question text not null,
  response text,
  responded boolean not null default false,
  primary key (request_id, seq),
  foreign key (request_id, mechanic_id) references lv_request_invitations (request_id, mechanic_id) deferrable initially deferred
);

-- ------------------------------------------------------------------ estimates
create table if not exists lv_quotes (
  id text primary key,
  request_id text not null,
  mechanic_id text not null,
  status text not null check (status in ('draft', 'submitted', 'accepted', 'declined', 'withdrawn', 'expired')),
  version int check (version >= 1),
  total_cents bigint not null check (total_cents >= 0),
  accepted_version int,
  accepted_total_cents bigint,
  data jsonb not null,
  row_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, mechanic_id),
  unique (id, request_id, mechanic_id),
  -- Only a mechanic the request was sent to can have an estimate on it.
  foreign key (request_id, mechanic_id) references lv_request_invitations (request_id, mechanic_id) deferrable initially deferred,
  check ((status = 'accepted') = (accepted_version is not null) or status = 'withdrawn')
);
-- One accepted estimate per request.
create unique index if not exists lv_quotes_one_accepted on lv_quotes (request_id) where status = 'accepted';

-- Every version of an estimate that was sent. Immutable.
create table if not exists lv_quote_versions (
  quote_id text not null references lv_quotes (id) deferrable initially deferred,
  version int not null check (version >= 1),
  total_cents bigint not null check (total_cents >= 0),
  data jsonb not null,
  recorded_at timestamptz not null default now(),
  primary key (quote_id, version)
);

create table if not exists lv_quote_questions (
  quote_id text not null references lv_quotes (id) deferrable initially deferred,
  seq int not null,
  question text not null,
  answer text,
  primary key (quote_id, seq)
);

-- ------------------------------------------------------------------ jobs
create table if not exists lv_jobs (
  id text primary key,
  quote_id text not null unique,
  request_id text not null,
  mechanic_id text not null,
  customer_id text not null,
  status text not null check (status in ('scheduled', 'in_progress', 'awaiting_customer', 'completed', 'cancelled')),
  final_amount_cents bigint check (final_amount_cents >= 0),
  data jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, mechanic_id),
  -- The job's mechanic is the estimate's mechanic; its customer is the request's customer.
  foreign key (quote_id, request_id, mechanic_id) references lv_quotes (id, request_id, mechanic_id) deferrable initially deferred,
  foreign key (request_id, customer_id) references lv_requests (id, customer_id) deferrable initially deferred
);
-- One active booking per request.
create unique index if not exists lv_jobs_one_active on lv_jobs (request_id) where status <> 'cancelled';

create table if not exists lv_job_extras (
  job_id text not null references lv_jobs (id) deferrable initially deferred,
  seq int not null,
  description text not null,
  extra_cents bigint not null check (extra_cents > 0),
  status text not null check (status in ('pending', 'approved', 'declined')),
  requested_at text not null,
  responded_at text,
  primary key (job_id, seq)
);
create table if not exists lv_job_reschedules (
  job_id text primary key references lv_jobs (id) deferrable initially deferred,
  proposed_by text not null check (proposed_by in ('customer', 'mechanic')),
  when_text text not null,
  status text not null check (status in ('pending', 'accepted', 'declined')),
  proposed_at text not null,
  responded_at text
);
-- What each side says about payment. Self-reported: nothing here is a processed payment.
create table if not exists lv_job_payment_reports (
  job_id text not null references lv_jobs (id) deferrable initially deferred,
  side text not null check (side in ('customer', 'mechanic')),
  status text not null check (status in ('paid', 'not_paid')),
  amount_cents bigint check (amount_cents >= 0),
  reported_at text not null,
  primary key (job_id, side)
);

-- ------------------------------------------------------------------ history
-- Lifecycle history for requests, estimates, jobs and support cases: role and action, never names. Append-only.
create table if not exists lv_history (
  entity_type text not null check (entity_type in ('request', 'quote', 'job', 'support_case')),
  entity_id text not null,
  seq int not null check (seq >= 0),
  at text not null,
  actor text not null check (actor in ('customer', 'mechanic', 'staff', 'system')),
  action text not null,
  detail text,
  primary key (entity_type, entity_id, seq)
);

-- ------------------------------------------------------------------ reviews
create table if not exists lv_reviews (
  id text primary key,
  job_id text not null unique,
  mechanic_id text not null,
  overall int not null check (overall between 1 and 5),
  data jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (job_id, mechanic_id) references lv_jobs (id, mechanic_id) deferrable initially deferred
);
create table if not exists lv_review_edits (
  review_id text not null references lv_reviews (id) deferrable initially deferred,
  seq int not null,
  overall int not null check (overall between 1 and 5),
  comment text not null,
  at text not null,
  primary key (review_id, seq)
);

-- ------------------------------------------------------------------ records, support, the rest
create table if not exists lv_past_repairs (
  id text primary key,
  mechanic_id text not null references lv_mechanics (id) deferrable initially deferred,
  customer_id text references lv_customers (id) deferrable initially deferred,
  job_id text references lv_jobs (id) deferrable initially deferred,
  data jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One verified record per Clutch job.
create unique index if not exists lv_past_repairs_one_per_job on lv_past_repairs (job_id) where job_id is not null;

create table if not exists lv_confirmations (
  id text primary key,
  past_repair_id text not null references lv_past_repairs (id) deferrable initially deferred,
  token text not null unique,
  data jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lv_saved (
  id text primary key,
  customer_id text not null references lv_customers (id) deferrable initially deferred,
  mechanic_id text not null references lv_mechanics (id) deferrable initially deferred,
  data jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, mechanic_id)
);

create table if not exists lv_notifications (
  id text primary key,
  user_id text not null references lv_users (id) deferrable initially deferred,
  mode text not null check (mode in ('customer', 'mechanic')),
  kind text not null,
  read boolean not null default false,
  data jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Future email/SMS delivery. Written in the same transaction as the notification it
-- describes; unique per event key so retries never duplicate. No provider reads it yet,
-- so nothing here is ever marked delivered (the status check doesn't allow it).
create table if not exists lv_outbox (
  id bigserial primary key,
  event_key text not null unique,
  notification_id text references lv_notifications (id) deferrable initially deferred,
  user_id text not null references lv_users (id) deferrable initially deferred,
  channel text not null check (channel in ('email', 'sms')),
  kind text not null,
  subject text not null,
  body text,
  status text not null default 'pending' check (status in ('pending', 'suppressed')),
  created_at timestamptz not null default now()
);

create table if not exists lv_support_cases (
  id text primary key,
  user_id text not null references lv_users (id) deferrable initially deferred,
  job_id text references lv_jobs (id) deferrable initially deferred,
  request_id text references lv_requests (id) deferrable initially deferred,
  status text not null check (status in ('open', 'in_review', 'resolved')),
  reporter_role text check (reporter_role in ('customer', 'mechanic')),
  data jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists lv_support_messages (
  case_id text not null references lv_support_cases (id) deferrable initially deferred,
  seq int not null,
  sender text not null check (sender in ('reporter', 'staff')),
  body text not null,
  at text not null,
  primary key (case_id, seq)
);

create table if not exists lv_drafts (
  id text primary key references lv_customers (id) deferrable initially deferred,
  data jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists lv_customer_notes (
  id text primary key,
  mechanic_id text not null references lv_mechanics (id) deferrable initially deferred,
  customer_id text not null references lv_customers (id) deferrable initially deferred,
  data jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists lv_profile_shares (
  id text primary key references lv_mechanics (id) deferrable initially deferred,
  data jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Upload ownership for the live scope: the file (bytes in app_media) belongs to a live account.
create table if not exists lv_uploads (
  media_id text primary key,
  owner_user_id text not null references lv_users (id) deferrable initially deferred,
  created_at timestamptz not null default now()
);

-- Rows from the snapshot that failed a rule during migration. Kept, never loaded.
create table if not exists lv_quarantine (
  collection text not null,
  id text not null,
  data jsonb not null,
  reason text not null,
  run_id bigint,
  quarantined_at timestamptz not null default now(),
  primary key (collection, id)
);
create table if not exists lv_migration_runs (
  id bigserial primary key,
  mode text not null check (mode in ('dry_run', 'apply', 'export_snapshot')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  report jsonb
);

-- ------------------------------------------------------------------ rules as triggers
create or replace function lv_allowed(kind text, from_s text, to_s text) returns boolean language sql immutable as $$
  select from_s = to_s or case kind
    when 'request' then (from_s, to_s) in (('draft','open'),('open','quoted'),('open','booked'),('open','cancelled'),('quoted','open'),('quoted','booked'),('quoted','cancelled'),('booked','open'),('booked','quoted'),('booked','completed'),('booked','cancelled'))
    when 'quote' then (from_s, to_s) in (('draft','submitted'),('draft','withdrawn'),('draft','declined'),('submitted','accepted'),('submitted','declined'),('submitted','withdrawn'),('submitted','expired'),('accepted','withdrawn'),('declined','submitted'))
    when 'job' then (from_s, to_s) in (('scheduled','in_progress'),('scheduled','cancelled'),('in_progress','awaiting_customer'),('awaiting_customer','completed'),('awaiting_customer','in_progress'))
    else false end
$$;

create or replace function lv_check_transition() returns trigger language plpgsql as $$
declare k text := tg_argv[0];
begin
  if not lv_allowed(k, old.status, new.status) then
    raise exception 'lv_invalid_transition: % % → %', k, old.status, new.status using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists lv_requests_transition on lv_requests;
create trigger lv_requests_transition before update of status on lv_requests for each row execute function lv_check_transition('request');
drop trigger if exists lv_quotes_transition on lv_quotes;
create trigger lv_quotes_transition before update of status on lv_quotes for each row execute function lv_check_transition('quote');
drop trigger if exists lv_jobs_transition on lv_jobs;
create trigger lv_jobs_transition before update of status on lv_jobs for each row execute function lv_check_transition('job');

-- An accepted estimate's version and price are frozen.
create or replace function lv_freeze_accepted_quote() returns trigger language plpgsql as $$
begin
  if old.status = 'accepted' and (new.version is distinct from old.version or new.total_cents <> old.total_cents
      or new.accepted_version is distinct from old.accepted_version or new.accepted_total_cents is distinct from old.accepted_total_cents) then
    raise exception 'lv_frozen_estimate: estimate % was accepted and can''t change', old.id using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists lv_quotes_freeze on lv_quotes;
create trigger lv_quotes_freeze before update on lv_quotes for each row execute function lv_freeze_accepted_quote();

-- The accepted version must be one that was actually sent (checked at commit).
create or replace function lv_accepted_version_exists() returns trigger language plpgsql as $$
begin
  if new.accepted_version is not null and not exists (select 1 from lv_quote_versions v where v.quote_id = new.id and v.version = new.accepted_version) then
    raise exception 'lv_accepted_version_missing: estimate % accepted version % was never sent', new.id, new.accepted_version using errcode = 'foreign_key_violation';
  end if;
  return null;
end $$;
drop trigger if exists lv_quotes_accepted_version on lv_quotes;
create constraint trigger lv_quotes_accepted_version after insert or update on lv_quotes deferrable initially deferred for each row execute function lv_accepted_version_exists();

-- A review only for a completed job.
create or replace function lv_review_needs_completed_job() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from lv_jobs j where j.id = new.job_id and j.status = 'completed') then
    raise exception 'lv_review_before_completion: job % isn''t completed', new.job_id using errcode = 'check_violation';
  end if;
  return null;
end $$;
drop trigger if exists lv_reviews_completed on lv_reviews;
create constraint trigger lv_reviews_completed after insert on lv_reviews deferrable initially deferred for each row execute function lv_review_needs_completed_job();

-- Append-only tables: rows can be added, never changed or removed.
create or replace function lv_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'lv_append_only: % rows can''t be changed or deleted', tg_table_name using errcode = 'check_violation';
end $$;
do $$ declare t text; begin
  foreach t in array array['lv_history', 'lv_quote_versions', 'lv_review_edits', 'lv_support_messages'] loop
    execute format('drop trigger if exists %I on %I', t || '_append_only', t);
    execute format('create trigger %I before update or delete on %I for each row execute function lv_append_only()', t || '_append_only', t);
  end loop;
end $$;

-- An answered extra-work request can't be re-answered or changed.
create or replace function lv_extras_answered_final() returns trigger language plpgsql as $$
begin
  if old.status <> 'pending' and (new.status <> old.status or new.extra_cents <> old.extra_cents or new.description <> old.description) then
    raise exception 'lv_extra_answered: extra work % on job % was already answered', old.seq, old.job_id using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists lv_job_extras_final on lv_job_extras;
create trigger lv_job_extras_final before update on lv_job_extras for each row execute function lv_extras_answered_final();

-- Only the server touches these tables (direct Postgres connection); the public API roles can't.
do $$ declare t text; begin
  foreach t in array array['lv_users','lv_user_roles','lv_customers','lv_vehicles','lv_mechanics','lv_mechanic_categories','lv_mechanic_makes','lv_mechanic_openings','lv_screenings','lv_insurance','lv_credentials','lv_employment','lv_verifications','lv_requests','lv_request_invitations','lv_request_questions','lv_quotes','lv_quote_versions','lv_quote_questions','lv_jobs','lv_job_extras','lv_job_reschedules','lv_job_payment_reports','lv_history','lv_reviews','lv_review_edits','lv_past_repairs','lv_confirmations','lv_saved','lv_notifications','lv_outbox','lv_support_cases','lv_support_messages','lv_drafts','lv_customer_notes','lv_profile_shares','lv_uploads','lv_quarantine','lv_migration_runs'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
