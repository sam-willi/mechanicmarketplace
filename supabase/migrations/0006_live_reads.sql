-- Targeted reads for the normalized live store (lib/data/normalized/reader.ts).
--
-- Every page, action and worker reads only the rows it needs, by owner, invitation or
-- staff predicate, with keyset pagination on growing lists. These indexes back each of
-- those lookups so none of them scans a whole table. Sort keys use the record's own
-- createdAt (the same field the app sorts by in memory) in the "C" collation, so the
-- database orders exactly as JavaScript string comparison does.
--
-- Idempotent. Applied with 0004/0005 when CLUTCH_LIVE_STORE=normalized. On a large
-- production table, create these with CREATE INDEX CONCURRENTLY outside a transaction instead.

-- accounts and profiles
create index if not exists lv_vehicles_customer on lv_vehicles (customer_id, created_at, id);
drop index if exists lv_mechanics_created;
create index if not exists lv_mechanics_created_c on lv_mechanics (created_at, id collate "C");
create index if not exists lv_mechanics_photo on lv_mechanics ((data->>'photoUrl')) where data->>'photoUrl' <> '';
create index if not exists lv_user_roles_role on lv_user_roles (role, user_id);

-- mechanic evidence, always read per mechanic
create index if not exists lv_screenings_mechanic on lv_screenings (mechanic_id);
-- bookable-candidate prefilter: verified checks of each kind
create index if not exists lv_screenings_verified on lv_screenings (kind, mechanic_id) where status = 'verified';
create index if not exists lv_insurance_mechanic on lv_insurance (mechanic_id, expires_on);
create index if not exists lv_credentials_mechanic on lv_credentials (mechanic_id);
create index if not exists lv_employment_mechanic on lv_employment (mechanic_id);
create index if not exists lv_verifications_mechanic on lv_verifications (mechanic_id);
create index if not exists lv_verifications_subject on lv_verifications (subject_id);
-- staff queue: by status, oldest submission first
drop index if exists lv_verifications_queue;
create index if not exists lv_verifications_queue_c on lv_verifications (status, coalesce(data->>'submittedAt', '') collate "C", id collate "C");
create index if not exists lv_verifications_insurance_ok on lv_verifications (subject_id) where category = 'insurance' and status = 'verified';
create index if not exists lv_past_repairs_mechanic on lv_past_repairs (mechanic_id, created_at, id);
create index if not exists lv_past_repairs_customer on lv_past_repairs (customer_id, (data->>'performedOn') collate "C" desc, id collate "C" desc) where customer_id is not null;
create index if not exists lv_reviews_mechanic on lv_reviews (mechanic_id);
create index if not exists lv_confirmations_repair on lv_confirmations (past_repair_id);
create index if not exists lv_confirmations_mechanic on lv_confirmations ((data->>'mechanicId'));

-- requests, invitations, estimates, jobs
create index if not exists lv_requests_customer on lv_requests (customer_id, (data->>'createdAt') collate "C" desc, id collate "C" desc);
create index if not exists lv_requests_active on lv_requests ((data->>'createdAt') collate "C", id collate "C") where status in ('open', 'quoted');
create index if not exists lv_requests_vehicle on lv_requests (vehicle_id);
create index if not exists lv_invitations_mechanic on lv_request_invitations (mechanic_id, request_id);
create index if not exists lv_quotes_mechanic on lv_quotes (mechanic_id, (data->>'createdAt') collate "C" desc, id collate "C" desc);
create index if not exists lv_quote_questions_open on lv_quote_questions (quote_id) where answer is null;
create index if not exists lv_jobs_customer on lv_jobs (customer_id, created_at desc, id desc);
create index if not exists lv_jobs_mechanic on lv_jobs (mechanic_id, created_at desc, id desc);
create index if not exists lv_jobs_request on lv_jobs (request_id);
create index if not exists lv_jobs_active_mechanic on lv_jobs (mechanic_id) where status in ('scheduled', 'in_progress', 'awaiting_customer');

-- notifications, support, notes
create index if not exists lv_notifications_user on lv_notifications (user_id, mode, (data->>'createdAt') collate "C" desc, id collate "C" desc);
create index if not exists lv_notifications_unread on lv_notifications (user_id, mode) where not read;
create index if not exists lv_support_user on lv_support_cases (user_id, (data->>'createdAt') collate "C" desc, id collate "C" desc);
create index if not exists lv_support_recent on lv_support_cases ((data->>'createdAt') collate "C" desc, id collate "C" desc);
create index if not exists lv_support_open on lv_support_cases (status) where status <> 'resolved';
create index if not exists lv_customer_notes_pair on lv_customer_notes (mechanic_id, customer_id);
create index if not exists lv_saved_customer on lv_saved (customer_id, created_at, id);

-- who may see an uploaded file: the record it's attached to
create index if not exists lv_past_repairs_photos on lv_past_repairs using gin ((data->'photos') jsonb_path_ops);
create index if not exists lv_jobs_photos on lv_jobs using gin ((data->'photos') jsonb_path_ops);
create index if not exists lv_requests_media on lv_requests using gin ((data->'media') jsonb_path_ops);
create index if not exists lv_requests_question_media on lv_requests using gin ((data->'questions') jsonb_path_ops);

-- A stored verification status as it stands at `at` (lib/verification/lifecycle.ts effectiveStatus):
-- a verified item with an expiry is expired on or after it, and needs reverifying in the 30 days before.
-- A date-only expiry means midnight UTC, as JavaScript's Date parses it.
create or replace function lv_effective_status(stored text, expires text, at timestamptz) returns text language sql immutable as $$
  select case
    when stored <> 'verified' or expires is null or expires = '' then stored
    when (case when expires ~ '^\d{4}-\d{2}-\d{2}$' then (expires || 'T00:00:00Z')::timestamptz else expires::timestamptz end) <= at then 'expired'
    when (case when expires ~ '^\d{4}-\d{2}-\d{2}$' then (expires || 'T00:00:00Z')::timestamptz else expires::timestamptz end) - at <= interval '30 days' then 'reverification_required'
    else stored end
$$;
