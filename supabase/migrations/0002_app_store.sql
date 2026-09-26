-- MVP record store.
--
-- The app's domain logic runs against a snapshot of these records (see
-- lib/data/store.ts). Every change is committed in one transaction that bumps
-- app_meta.version, so concurrent server instances detect races and retry.
-- 0001_init.sql remains the normalized target schema to migrate to as the
-- product grows.
--
-- Only the server touches these tables (direct Postgres connection). RLS is on
-- with no policies, so the public anon/authenticated API roles can't read them.

create table if not exists app_meta (
  key text primary key,
  version bigint not null default 0
);

create table if not exists app_records (
  collection text not null,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

create table if not exists app_events (
  id text primary key,
  name text not null,
  mechanic_id text,
  actor_id text,
  variant text,
  props jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists app_events_mechanic on app_events (mechanic_id, name);

create table if not exists app_media (
  id text primary key,
  owner_id text not null,
  meta jsonb not null,
  bytes bytea not null,
  created_at timestamptz not null default now()
);

alter table app_meta enable row level security;
alter table app_records enable row level security;
alter table app_events enable row level security;
alter table app_media enable row level security;
