-- Booking a mechanic whose checks Clutch hasn't all verified (policy of 2026-09-26; needs legal
-- review before launch). The verification a customer saw and acknowledged is kept with the job
-- (lv_jobs.data->'verificationAtBooking', lib/domain/disclosure.ts). The database guarantees:
--   * once recorded, it never changes, whatever later happens to the mechanic's checks;
--   * a new job recorded as not fully verified must carry the customer's acknowledgement.
-- Jobs booked before this policy have no record and are left alone.
--
-- Idempotent. Applied with 0004-0006 when CLUTCH_LIVE_STORE=normalized.

create or replace function lv_job_booking_verification() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.data ? 'verificationAtBooking'
     and (new.data->'verificationAtBooking') is distinct from (old.data->'verificationAtBooking') then
    raise exception 'lv_booking_verification_frozen: job % keeps the verification recorded at booking', old.id using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' and new.data ? 'verificationAtBooking'
     and (new.data->'verificationAtBooking'->>'fullyVerified') = 'false'
     and not (new.data->'verificationAtBooking' ? 'acknowledgement') then
    raise exception 'lv_booking_unacknowledged: job % books unverified checks without the customer''s acknowledgement', new.id using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists lv_jobs_booking_verification on lv_jobs;
create trigger lv_jobs_booking_verification before insert or update on lv_jobs for each row execute function lv_job_booking_verification();
