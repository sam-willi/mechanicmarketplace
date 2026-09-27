-- Canonical verification statuses (docs/verification.md, lib/verification/model.ts).
-- Idempotent: safe to apply again. Rewrites the older words in place; nothing is deleted, and
-- each rewritten record keeps its data (the app appends a "migrated" history event when the
-- snapshot-store backfill runs; scripts/migrate-verifications.ts).

alter table lv_verifications drop constraint if exists lv_verifications_status_check;
alter table lv_screenings drop constraint if exists lv_screenings_status_check;

update lv_verifications set status = case status
    when 'not_submitted' then 'not_started'
    when 'pending' then case when coalesce(data->>'method', '') in ('vendor_screening', 'hosted_identity') then 'in_progress' else 'under_review' end
    when 'rejected' then 'failed'
    when 'needs_info' then 'needs_more_info'
    when 'reverification_required' then 'verified'
    else status end,
  data = jsonb_set(data, '{status}', to_jsonb(case status
    when 'not_submitted' then 'not_started'
    when 'pending' then case when coalesce(data->>'method', '') in ('vendor_screening', 'hosted_identity') then 'in_progress' else 'under_review' end
    when 'rejected' then 'failed'
    when 'needs_info' then 'needs_more_info'
    when 'reverification_required' then 'verified'
    else status end))
  where status in ('not_submitted', 'pending', 'rejected', 'needs_info', 'reverification_required');

update lv_screenings set status = case status
    when 'not_submitted' then 'not_started'
    when 'pending' then 'in_progress'
    when 'rejected' then 'failed'
    when 'needs_info' then 'needs_more_info'
    when 'reverification_required' then 'verified'
    else status end,
  data = jsonb_set(data, '{status}', to_jsonb(case status
    when 'not_submitted' then 'not_started'
    when 'pending' then 'in_progress'
    when 'rejected' then 'failed'
    when 'needs_info' then 'needs_more_info'
    when 'reverification_required' then 'verified'
    else status end))
  where status in ('not_submitted', 'pending', 'rejected', 'needs_info', 'reverification_required');

alter table lv_verifications add constraint lv_verifications_status_check
  check (status in ('not_started', 'in_progress', 'submitted', 'needs_more_info', 'under_review', 'verified', 'failed', 'expired', 'revoked'));
alter table lv_screenings add constraint lv_screenings_status_check
  check (status in ('not_started', 'in_progress', 'submitted', 'needs_more_info', 'under_review', 'verified', 'failed', 'expired', 'revoked'));

-- A stored status as it stands at `at`: a verified item with an expiry is expired on or after it,
-- and "renewal due" in the 30 days before (still verified). Mirrors lib/verification/model.ts.
create or replace function lv_effective_status(stored text, expires text, at timestamptz) returns text language sql immutable as $$
  select case
    when stored <> 'verified' or expires is null or expires = '' then stored
    when (case when expires ~ '^\d{4}-\d{2}-\d{2}$' then (expires || 'T00:00:00Z')::timestamptz else expires::timestamptz end) <= at then 'expired'
    when (case when expires ~ '^\d{4}-\d{2}-\d{2}$' then (expires || 'T00:00:00Z')::timestamptz else expires::timestamptz end) - at <= interval '30 days' then 'renewal_due'
    else stored end
$$;
create index if not exists lv_verifications_provider_ref on lv_verifications ((data->>'providerRef')) where data ? 'providerRef';
