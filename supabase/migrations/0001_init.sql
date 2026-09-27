-- REFERENCE ONLY. The app never applies this file. It is the original relational design,
-- written for Supabase (it references auth.users), and it was superseded by
-- 0004_live_normalized.sql. See the README "Migrations" note.
--
-- Clutch — initial schema. Mirrors lib/domain/types.ts (snake_case here).
-- Money is integer cents. Reputation counts are DERIVED (see views at the end),
-- never stored, so completed work compounds automatically.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- enums
create type user_role as enum ('customer', 'mechanic', 'admin');
create type work_model as enum ('mobile', 'shop', 'both');
create type repair_category as enum ('brakes','suspension','cooling','starters','alternators','diagnostics','electrical','engine','ac','maintenance');
create type verification_status as enum ('not_submitted','pending','verified','rejected','needs_info','expired','reverification_required');
create type verification_category as enum ('identity','background','driving_record','insurance','credential','employment','past_repair');
create type verification_method as enum ('vendor_screening','document_review','institution_check','employer_check','customer_confirmation','platform_job');
create type subject_type as enum ('screening_check','insurance_record','credential','employment','past_repair');
create type screening_kind as enum ('identity','background','driving_record');
create type past_repair_source as enum ('self','customer_confirmed','document','platform');
create type review_kind as enum ('verified_job','customer_confirmed','testimonial');
create type request_status as enum ('open','quoted','booked','completed','cancelled');
create type quote_status as enum ('draft','submitted','accepted','declined','withdrawn','expired');
create type job_status as enum ('scheduled','in_progress','awaiting_customer','completed','cancelled');

-- ---------------------------------------------------------------- people
-- Shared account: identity + contact only. Role-specific and sensitive professional
-- data lives on customer_profiles / mechanic_profiles, never here.
create table users (
  id uuid primary key references auth.users (id) on delete cascade,
  roles user_role[] not null check (cardinality(roles) > 0),   -- one login can be customer AND mechanic
  email text not null,
  phone text,
  name text not null,
  notification_prefs jsonb not null default '{"email":true,"sms":true,"push":true}',
  avatar_url text,                                              -- from Google sign-in (auth.identities holds the Google id)
  created_at timestamptz not null default now()
);

-- Role-aware notifications: mode decides which app shows them.
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  mode text not null check (mode in ('customer','mechanic')),
  kind text not null,
  title text not null,
  body text,
  href text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_inbox on notifications (user_id, mode, created_at desc);

create table mechanic_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users (id) on delete cascade,
  slug text not null unique,
  display_name text not null,
  photo_url text,
  city text not null,
  neighborhood text,
  lat double precision,
  lng double precision,
  service_radius_mi int not null default 10,
  bio text not null default '',
  work_model work_model not null,
  shop_name text,
  hourly_rate_cents int not null check (hourly_rate_cents >= 0),
  diagnostic_fee_cents int not null check (diagnostic_fee_cents >= 0),
  travel_fee_cents int check (travel_fee_cents >= 0),
  availability_note text,
  self_reported_claims text[] not null default '{}',
  years_experience_claim int,
  joined_at date not null default current_date
);

create table fixed_prices (
  id uuid primary key default gen_random_uuid(),
  mechanic_id uuid not null references mechanic_profiles (id) on delete cascade,
  repair_category repair_category not null,
  label text not null,
  labor_cents int not null check (labor_cents > 0)
);

create table customer_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users (id) on delete cascade,
  display_name text not null,
  city text
);

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customer_profiles (id) on delete cascade,
  -- Manually entered values. Always win over decoded ones for display.
  year int not null,
  make text not null,
  model text not null,
  trim text,
  engine text,
  transmission text check (transmission in ('automatic','manual','cvt','dual_clutch','unsure')),
  mileage int,
  vin text check (vin is null or vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  -- Populated by a future VIN decoder: {year, make, model, trim, engine, decodedAt, source}.
  vin_decoded jsonb
);

-- Declared (self-reported) focus. Never used as verified evidence.
create table mechanic_repair_specialties (
  mechanic_id uuid references mechanic_profiles (id) on delete cascade,
  repair_category repair_category not null,
  primary key (mechanic_id, repair_category)
);
create table mechanic_vehicle_specialties (
  mechanic_id uuid references mechanic_profiles (id) on delete cascade,
  make text not null,
  primary key (mechanic_id, make)
);

-- ---------------------------------------------------------------- safety (PRIVATE)
-- Vendor identity lives here only; the mechanic model never references a vendor.
create table screening_checks (
  id uuid primary key default gen_random_uuid(),
  mechanic_id uuid not null references mechanic_profiles (id) on delete cascade,
  kind screening_kind not null,
  provider text not null,              -- 'persona' | 'stripe_identity' | 'jumio' | 'checkr' | 'mock' ...
  provider_ref text not null,
  status verification_status not null default 'pending',
  result text check (result in ('clear','consider','failed')),
  consent_at timestamptz,              -- FCRA disclosure consent (background / MVR)
  completed_at timestamptz,
  expires_at timestamptz,
  unique (provider, provider_ref)
);

create table insurance_records (
  id uuid primary key default gen_random_uuid(),
  mechanic_id uuid not null references mechanic_profiles (id) on delete cascade,
  carrier text not null,
  policy_last4 text,
  coverage_cents bigint,
  document_path text,                  -- storage path in a private bucket
  effective_on date,
  expires_on date not null
);

-- ---------------------------------------------------------------- skill evidence
create table credentials (
  id uuid primary key default gen_random_uuid(),
  mechanic_id uuid not null references mechanic_profiles (id) on delete cascade,
  issuer text not null,
  name text not null,
  code text,
  credential_number_last4 text,
  issued_on date,
  expires_on date,
  document_path text
);

create table employment_history (
  id uuid primary key default gen_random_uuid(),
  mechanic_id uuid not null references mechanic_profiles (id) on delete cascade,
  employer text not null,
  position text not null,
  started_on date not null,
  ended_on date,
  employer_contact text,               -- private
  document_path text
);

create table past_repairs (
  id uuid primary key default gen_random_uuid(),
  mechanic_id uuid not null references mechanic_profiles (id) on delete cascade,
  source past_repair_source not null default 'self',
  job_id uuid,                         -- set when source = 'platform'
  customer_id uuid references customer_profiles (id),
  year int not null,
  make text not null,
  model text not null,
  repair_category repair_category not null,
  title text not null,
  description text,
  performed_on date not null,
  value_cents int                            -- platform jobs: approved estimate / final amount
);
create index past_repairs_mech_cat_make on past_repairs (mechanic_id, repair_category, make) where source <> 'self';

create table repair_evidence (
  id uuid primary key default gen_random_uuid(),
  past_repair_id uuid not null references past_repairs (id) on delete cascade,
  kind text not null check (kind in ('photo','invoice','document')),
  path text not null
);

create table customer_confirmations (
  id uuid primary key default gen_random_uuid(),
  past_repair_id uuid not null references past_repairs (id) on delete cascade,
  mechanic_id uuid not null references mechanic_profiles (id) on delete cascade,
  token text not null unique,
  contact text not null,               -- private
  contact_name text,
  sent_at timestamptz not null default now(),
  responded_at timestamptz,
  response text check (response in ('confirmed','denied'))
);

-- Unified verification ledger — one row per decision-bearing subject.
create table verification_records (
  id uuid primary key default gen_random_uuid(),
  mechanic_id uuid not null references mechanic_profiles (id) on delete cascade,
  subject_type subject_type not null,
  subject_id uuid not null,
  category verification_category not null,
  verification_method verification_method not null,
  provider text,
  status verification_status not null default 'pending',
  submitted_at timestamptz,
  verified_at timestamptz,
  expires_at timestamptz,
  reviewer_id uuid references users (id),
  notes text,
  evidence_summary text
);
create index verification_queue on verification_records (status, submitted_at);
create index verification_subject on verification_records (subject_type, subject_id);

-- ---------------------------------------------------------------- marketplace
create type request_urgency as enum ('stranded','today','one_two_days','this_week','flexible');

-- The customer describes evidence; Clutch structures it; the mechanic diagnoses.
-- Option lists are small and evolve, so multi-selects are text[] and grouped
-- follow-ups are jsonb rather than a table per option.
create table repair_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customer_profiles (id),
  vehicle_id uuid not null references vehicles (id),
  status text not null default 'open' check (status in ('draft','open','quoted','booked','completed','cancelled')),
  -- Routing only: customer's optional known service, or inferred. Never shown as a diagnosis.
  repair_category repair_category not null,
  category_source text not null check (category_source in ('customer','inferred')),

  symptom_description text not null,
  suspected_issue text,                               -- "Customer's suspected issue"
  onset text check (onset in ('today','few_days','few_weeks','over_month','unsure')),
  onset_first_noticed text,
  occurrence_conditions text[] not null default '{}',
  occurrence_notes text,
  starts_status text check (starts_status in ('normal','difficult','cranks_no_start','clicks_no_crank','no_response','unsure')),
  driveability text check (driveability in ('normal','short_distance','unsafe','no')),
  safe_to_drive text check (safe_to_drive in ('yes','no','unsure')),
  warning_lights text[] not null default '{}',
  diagnostic_codes text[] not null default '{}',     -- customer-provided; never a confirmed diagnosis
  smells text[] not null default '{}',
  sounds jsonb,                                       -- {present, kinds[], description}
  leaks jsonb,                                        -- {present, location, color, amount}
  recent_repairs jsonb not null default '[]',         -- [{what, when, shop, notes}]
  modifications jsonb,                                -- {kinds[], notes}
  prior_diagnosis jsonb,                              -- {said, quotedRepair, quotedPriceCents}; another shop's opinion
  customer_supplied_parts jsonb not null default '[]',-- [{description, brand, partNumber}]
  urgency request_urgency,
  preferred_times text,

  rebook_of uuid references mechanic_profiles (id),
  direct_to uuid references mechanic_profiles (id),
  created_at timestamptz not null default now()
);

create table repair_locations (
  request_id uuid primary key references repair_requests (id) on delete cascade,
  service_mode text not null check (service_mode in ('mobile','shop')),
  area text,                                           -- public to matched mechanics
  address text,                                        -- PRIVATE until booked
  parking_type text check (parking_type in ('driveway','private_garage','apartment_garage','parking_lot','street','parking_structure','other')),
  flat_ground text check (flat_ground in ('yes','no','unsure')),
  work_space text check (work_space in ('yes','limited','unsure')),
  repairs_allowed text check (repairs_allowed in ('yes','no','unsure')),
  notes text,
  access_available boolean,
  access_instructions text                             -- PRIVATE until booked
);

create table repair_media (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references repair_requests (id) on delete cascade,
  question_id uuid,                                    -- set when attached to a question reply
  uploaded_by uuid not null references users (id),
  type text not null check (type in ('photo','video','audio','document')),
  tag text not null,                                   -- dashboard, leak, sound, vin, prior_estimate, customer_part, answer, ...
  file_path text not null,                             -- private storage bucket; served via signed URL
  content_type text not null,
  size_bytes bigint not null,
  description text,
  uploaded_at timestamptz not null default now()
);
create index repair_media_request on repair_media (request_id);

-- Autosaved, incomplete intake (one per customer). Media is uploaded as it's chosen.
create table intake_drafts (
  customer_id uuid primary key references customer_profiles (id) on delete cascade,
  draft jsonb not null,
  updated_at timestamptz not null default now()
);

create table request_matches (
  request_id uuid references repair_requests (id) on delete cascade,
  mechanic_id uuid references mechanic_profiles (id) on delete cascade,
  declined_at timestamptz,
  primary key (request_id, mechanic_id)
);

create table repair_request_questions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references repair_requests (id) on delete cascade,
  mechanic_id uuid not null references mechanic_profiles (id),
  customer_id uuid not null references customer_profiles (id),
  question text not null,
  response text,
  asked_at timestamptz not null default now(),
  responded_at timestamptz
  -- attachments: repair_media rows with question_id = this id
);
alter table repair_media add constraint repair_media_question_fk foreign key (question_id) references repair_request_questions (id) on delete cascade;

create table request_interest (
  request_id uuid references repair_requests (id) on delete cascade,
  mechanic_id uuid references mechanic_profiles (id),
  note text,
  created_at timestamptz not null default now(),
  primary key (request_id, mechanic_id)
);

create table quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references repair_requests (id) on delete cascade,
  mechanic_id uuid not null references mechanic_profiles (id),
  labor_cents int not null,
  diagnostic_fee_cents int not null default 0,
  travel_fee_cents int not null default 0,
  parts_included boolean not null default false,
  parts_estimate_cents int not null default 0,
  duration_hours numeric(4,1) not null,
  available_on text not null,
  service_mode text not null check (service_mode in ('mobile','shop')),
  scope text not null,
  notes text,
  status quote_status not null default 'submitted',
  created_at timestamptz not null default now(),
  unique (request_id, mechanic_id)
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null unique references quotes (id),
  request_id uuid not null references repair_requests (id),
  mechanic_id uuid not null references mechanic_profiles (id),
  customer_id uuid not null references customer_profiles (id),
  vehicle_id uuid not null references vehicles (id),
  repair_category repair_category not null,
  title text not null,
  status job_status not null default 'scheduled',
  scheduled_for text,
  started_at timestamptz,
  mechanic_completed_at timestamptz,        -- mechanic marked done
  completed_at timestamptz,                 -- customer confirmed → Platform Verified repair created
  cancelled_at timestamptz,
  final_amount_cents int,                   -- job value record, not a payment
  completion_notes text,
  mechanic_notes text                       -- private to the mechanic
);

-- Customer questions about an estimate, answered by that mechanic only.
create table quote_questions (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes (id) on delete cascade,
  question text not null,
  answer text,
  asked_at timestamptz not null default now(),
  answered_at timestamptz
);

-- A mechanic's private notes about their own customers.
create table mechanic_customer_notes (
  mechanic_id uuid references mechanic_profiles (id) on delete cascade,
  customer_id uuid references customer_profiles (id) on delete cascade,
  note text not null default '',
  primary key (mechanic_id, customer_id)
);
alter table past_repairs add constraint past_repairs_job_fk foreign key (job_id) references jobs (id);

create table reviews (
  id uuid primary key default gen_random_uuid(),
  mechanic_id uuid not null references mechanic_profiles (id) on delete cascade,
  kind review_kind not null,
  job_id uuid unique references jobs (id),
  past_repair_id uuid references past_repairs (id),
  overall int not null check (overall between 1 and 5),
  communication int check (communication between 1 and 5),
  timeliness int check (timeliness between 1 and 5),
  price_accuracy int check (price_accuracy between 1 and 5),
  workmanship int check (workmanship between 1 and 5),
  comment text not null default '',
  author_name text not null,
  created_at timestamptz not null default now(),
  -- A verified_job review must be tied to a completed job.
  check (kind <> 'verified_job' or job_id is not null)
);

create table saved_mechanics (
  customer_id uuid references customer_profiles (id) on delete cascade,
  mechanic_id uuid references mechanic_profiles (id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (customer_id, mechanic_id)
);

create table customer_mechanic_relationships (
  customer_id uuid references customer_profiles (id) on delete cascade,
  mechanic_id uuid references mechanic_profiles (id) on delete cascade,
  first_job_at timestamptz,
  last_job_at timestamptz,
  job_count int not null default 0,
  primary key (customer_id, mechanic_id)
);

create table analytics_events (
  id bigint generated always as identity primary key,
  name text not null,
  mechanic_id uuid,
  actor_id uuid,
  session_id text,
  variant text check (variant in ('high','low')),
  props jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index analytics_by_mechanic on analytics_events (mechanic_id, name, created_at);

-- ---------------------------------------------------------------- derived reputation
create view mechanic_repair_counts as
  select mechanic_id, repair_category, make,
         count(*) as verified_count,
         count(*) filter (where source = 'platform') as platform_count
  from past_repairs where source <> 'self'
  group by mechanic_id, repair_category, make;

create view mechanic_verified_rating as
  select mechanic_id, avg(overall)::numeric(3,2) as average, count(*) as review_count
  from reviews where kind = 'verified_job'
  group by mechanic_id;

create view mechanic_repeat_customers as
  select mechanic_id, count(*) filter (where job_count >= 2) as repeat_customers, count(*) as customers
  from customer_mechanic_relationships group by mechanic_id;

-- Public screening outcomes: status + dates only. No provider, ref, result or documents.
create view public_safety_status as
  select distinct on (mechanic_id, kind) mechanic_id, kind::text as category,
         case when status = 'verified' and expires_at < now() then 'expired'::verification_status else status end as status,
         completed_at as verified_at, expires_at
  from screening_checks order by mechanic_id, kind, completed_at desc nulls last;

-- ---------------------------------------------------------------- row level security
alter table screening_checks enable row level security;
alter table insurance_records enable row level security;
alter table customer_confirmations enable row level security;
alter table verification_records enable row level security;
alter table employment_history enable row level security;
alter table repair_locations enable row level security;
alter table repair_media enable row level security;
alter table intake_drafts enable row level security;

create function is_admin() returns boolean language sql stable as $$
  select exists (select 1 from users where id = auth.uid() and 'admin' = any(roles))
$$;
create function my_customer_id() returns uuid language sql stable as $$
  select id from customer_profiles where user_id = auth.uid()
$$;
create function my_mechanic_id() returns uuid language sql stable as $$
  select id from mechanic_profiles where user_id = auth.uid()
$$;
create function owns_mechanic(mid uuid) returns boolean language sql stable as $$
  select exists (select 1 from mechanic_profiles where id = mid and user_id = auth.uid())
$$;

create policy screening_owner_admin on screening_checks for select using (owns_mechanic(mechanic_id) or is_admin());
create policy insurance_owner_admin on insurance_records for select using (owns_mechanic(mechanic_id) or is_admin());
create policy confirmations_owner_admin on customer_confirmations for select using (owns_mechanic(mechanic_id) or is_admin());
create policy verifications_owner_admin on verification_records for select using (owns_mechanic(mechanic_id) or is_admin());
create policy verifications_admin_write on verification_records for update using (is_admin());
create policy employment_owner_admin on employment_history for select using (owns_mechanic(mechanic_id) or is_admin());
-- Public pages read only mechanic_profiles, credentials, past_repairs (verified), reviews,
-- and the views above via a service-role server projection (lib/domain/public-profile.ts).

-- Address/access are private: matched mechanics read locations only through a view
-- that nulls address and access_instructions unless their quote was accepted.
create view mechanic_repair_locations as
  select l.request_id, l.service_mode, l.area, l.parking_type, l.flat_ground, l.work_space, l.repairs_allowed, l.notes, l.access_available,
         case when q.status = 'accepted' then l.address end as address,
         case when q.status = 'accepted' then l.access_instructions end as access_instructions,
         m.mechanic_id
  from repair_locations l
  join request_matches m on m.request_id = l.request_id
  left join quotes q on q.request_id = l.request_id and q.mechanic_id = m.mechanic_id;

create policy drafts_owner on intake_drafts for all using (exists (select 1 from customer_profiles c where c.id = customer_id and c.user_id = auth.uid()));

-- ---------------------------------------------------------------- role permissions
alter table repair_requests enable row level security;
alter table quotes enable row level security;
alter table jobs enable row level security;
alter table vehicles enable row level security;
alter table saved_mechanics enable row level security;
alter table notifications enable row level security;
alter table quote_questions enable row level security;
alter table mechanic_customer_notes enable row level security;
alter table reviews enable row level security;

-- Customers: their own vehicles, requests, quotes on their requests, jobs, saved list.
create policy vehicles_owner on vehicles for all using (customer_id = my_customer_id() or is_admin());
create policy requests_customer on repair_requests for all using (customer_id = my_customer_id() or is_admin());
-- Mechanics: only requests Clutch sent them.
create policy requests_matched_mechanic on repair_requests for select using (
  exists (select 1 from request_matches m where m.request_id = id and m.mechanic_id = my_mechanic_id())
);
-- Quotes: the mechanic sees only their own; the customer sees non-draft quotes on their requests. Never other mechanics' prices.
create policy quotes_own_mechanic on quotes for all using (mechanic_id = my_mechanic_id() or is_admin());
create policy quotes_customer on quotes for select using (
  status <> 'draft' and exists (select 1 from repair_requests r where r.id = request_id and r.customer_id = my_customer_id())
);
create policy jobs_parties on jobs for select using (customer_id = my_customer_id() or mechanic_id = my_mechanic_id() or is_admin());
create policy saved_owner on saved_mechanics for all using (customer_id = my_customer_id());
create policy notifications_owner on notifications for all using (user_id = auth.uid());
create policy customer_notes_mechanic on mechanic_customer_notes for all using (mechanic_id = my_mechanic_id());
-- Reviews are public to read; only the hiring customer of a completed job can write one.
create policy reviews_read on reviews for select using (true);
create policy reviews_write on reviews for insert with check (
  kind = 'verified_job' and exists (select 1 from jobs j where j.id = job_id and j.customer_id = my_customer_id() and j.status = 'completed')
);
-- Customers can never read verification_records, screening_checks, insurance_records or admin notes (policies above allow owner mechanic + admin only).
