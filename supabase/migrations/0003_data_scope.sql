-- Data scopes: the real marketplace ("live") and the fictional demo ("demo")
-- are stored side by side but never mix. Every row carries its scope; the
-- server loads and writes exactly one scope per request (lib/data/scope.ts).
--
-- The server applies this same DDL automatically on first boot after upgrading
-- (lib/data/store.ts, `migrate`), inside one transaction with an advisory lock,
-- and then splits any pre-scope data (lib/data/classify.ts). Running this file
-- by hand first is optional and safe; it is idempotent.
--
-- Nothing is deleted. Before the split, every existing row is copied to
-- app_scope_backup. Rows that linked both worlds (e.g. a demo mechanic's
-- estimate on a real request) are moved to scope 'quarantine', which the app
-- never loads.

alter table app_records add column if not exists scope text not null default 'live';
alter table app_records drop constraint if exists app_records_pkey;
alter table app_records add primary key (scope, collection, id);
create index if not exists app_records_scope on app_records (scope);

alter table app_events add column if not exists scope text not null default 'live';
create index if not exists app_events_scope_mechanic on app_events (scope, mechanic_id, name);

alter table app_media add column if not exists scope text not null default 'live';

create table if not exists app_scope_backup (
  collection text not null,
  id text not null,
  scope text not null,
  data jsonb not null,
  backed_up_at timestamptz not null default now(),
  migration text
);
alter table app_scope_backup add column if not exists migration text;
alter table app_scope_backup enable row level security;

-- After the split, a second step ('scope_v2') checks that every link a record
-- holds resolves in its own scope (a notification, request, estimate, job,
-- review…) and quarantines what doesn't, again backing rows up first.
--
-- Each scope has its own version counter in app_meta: 'main' (live, kept from
-- before scopes) and 'demo'. 'scope_v1' marks the one-time split as done.
