-- One row of evidence numbers per mechanic, kept current by triggers, so search and matching rank
-- every bookable mechanic from one small row each instead of reading their repairs and reviews.
-- (Since 2026-09-26 any mechanic with a complete profile is bookable, so candidates are many.)
--
--   verified_total   verified repairs (source <> 'self')
--   pairs            {"<repairCategory>|<make>": n} over verified repairs
--   models           {"<make>|<model>": n} over verified repairs (model as recorded)
--   rating_sum/_n    over verified-job reviews
--   repeat_customers customers with two or more completed Clutch jobs with this mechanic
--
-- The app treats these as the same numbers it would count from the documents; the database
-- tests check both give identical rankings. Idempotent; applied with 0004-0007.

create table if not exists lv_mechanic_stats (
  mechanic_id text primary key references lv_mechanics (id) deferrable initially deferred,
  verified_total int not null default 0,
  pairs jsonb not null default '{}'::jsonb,
  models jsonb not null default '{}'::jsonb,
  rating_sum int not null default 0,
  rating_n int not null default 0,
  repeat_customers int not null default 0
);
alter table lv_mechanic_stats enable row level security;

create or replace function lv_refresh_mechanic_stats(mid text) returns void language plpgsql as $$
begin
  if mid is null or not exists (select 1 from lv_mechanics where id = mid) then return; end if;
  insert into lv_mechanic_stats (mechanic_id, verified_total, pairs, models, rating_sum, rating_n, repeat_customers)
  select mid,
    (select count(*)::int from lv_past_repairs where mechanic_id = mid and coalesce(data->>'source', '') <> 'self'),
    coalesce((select jsonb_object_agg(k, n) from (
      select coalesce(data->>'repairCategory', '') || '|' || coalesce(data->>'make', '') as k, count(*)::int as n
      from lv_past_repairs where mechanic_id = mid and coalesce(data->>'source', '') <> 'self' group by 1) p), '{}'::jsonb),
    coalesce((select jsonb_object_agg(k, n) from (
      select coalesce(data->>'make', '') || '|' || coalesce(data->>'model', '') as k, count(*)::int as n
      from lv_past_repairs where mechanic_id = mid and coalesce(data->>'source', '') <> 'self' group by 1) p), '{}'::jsonb),
    (select coalesce(sum(overall), 0)::int from lv_reviews where mechanic_id = mid and data->>'kind' = 'verified_job'),
    (select count(*)::int from lv_reviews where mechanic_id = mid and data->>'kind' = 'verified_job'),
    (select count(*)::int from (select customer_id from lv_past_repairs
      where mechanic_id = mid and data->>'source' = 'platform' and customer_id is not null group by 1 having count(*) >= 2) g)
  on conflict (mechanic_id) do update set verified_total = excluded.verified_total, pairs = excluded.pairs, models = excluded.models,
    rating_sum = excluded.rating_sum, rating_n = excluded.rating_n, repeat_customers = excluded.repeat_customers;
end $$;

create or replace function lv_mechanic_stats_trigger() returns trigger language plpgsql as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform lv_refresh_mechanic_stats(old.mechanic_id); end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.mechanic_id is distinct from old.mechanic_id or new.data is distinct from old.data) then
    perform lv_refresh_mechanic_stats(new.mechanic_id);
  end if;
  return null;
end $$;
drop trigger if exists lv_past_repairs_stats on lv_past_repairs;
create trigger lv_past_repairs_stats after insert or update or delete on lv_past_repairs for each row execute function lv_mechanic_stats_trigger();
drop trigger if exists lv_reviews_stats on lv_reviews;
create trigger lv_reviews_stats after insert or update or delete on lv_reviews for each row execute function lv_mechanic_stats_trigger();

-- A new mechanic gets an empty row; existing data is (re)counted once, whenever this file changes.
create or replace function lv_mechanic_stats_new() returns trigger language plpgsql as $$
begin
  insert into lv_mechanic_stats (mechanic_id) values (new.id) on conflict do nothing;
  return null;
end $$;
drop trigger if exists lv_mechanics_stats on lv_mechanics;
create trigger lv_mechanics_stats after insert on lv_mechanics for each row execute function lv_mechanic_stats_new();

create or replace function lv_rebuild_mechanic_stats() returns void language plpgsql as $$
declare mid text;
begin
  for mid in select id from lv_mechanics loop perform lv_refresh_mechanic_stats(mid); end loop;
end $$;
select lv_rebuild_mechanic_stats();
