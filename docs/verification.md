# Verification

How Clutch verifies mechanics, what it stores, and what it may claim. This is the design of record;
the code follows it and the tests hold it (see "Tests" below).

## Principles

1. **One canonical record per check, never a boolean.** Every check a mechanic starts is a
   `VerificationRecord` with its own status, source, dates, reasons and an append-only history.
   Nothing about verification is stored as `verified: true` on the mechanic.
2. **Independent checks.** Email, phone, identity (government ID + live selfie + face match),
   background check, insurance, certifications and customer-confirmed repairs are separate. None
   implies another.
3. **Bookable without every check** (policy of 2026-09-26, pending legal review). A mechanic with a
   complete basic profile is discoverable and bookable without background-check or insurance
   verification. Every surface says exactly what is verified, pending, expired, self-reported or
   not verified, and customers acknowledge the gaps before booking.
4. **Never claim more than was checked.** Public statements name who checked what and when
   ("Identity verified by Stripe Identity on Sep 26, 2026"; "Insurance not verified by Clutch").
   No generic "Trusted" or "Verified" badge. Expired and revoked checks drop out of every positive
   claim at read time.
5. **Clutch doesn't handle what it doesn't need.** Identity is done in a hosted provider flow: the
   provider captures the ID and selfie. Clutch keeps the minimum needed for proof and support.
6. **Nothing is faked.** Without provider credentials a check can't be started for a real
   mechanic, and nothing reads as passed. The deterministic test adapter runs only in tests and the
   fictional demo.

## Audit (2026-09-26, before this work)

| Area | Found | Change |
| --- | --- | --- |
| Data model | `VerificationRecord` per item, but decided in place (`v.status = decision`): earlier states, reviewer and notes were overwritten. Statuses mixed stored and derived values (`reverification_required`). Screenings (`ScreeningCheck`) duplicated status on a second record. | Canonical record with the nine explicit statuses, `events[]` history, reason codes, supersession. Derived "renewal due" is computed, never stored. |
| Evidence files | The Verification Center and onboarding **discarded uploaded files and kept only the file name.** Staff approved insurance and certificates without seeing a document. | Documents are stored as private uploads tied to the record and opened by staff through short-lived signed links. Legacy "document verified" decisions made without a stored file are labelled as such. |
| Identity | Mock provider "verified" on first read (demo only; real mechanics were blocked from starting). No hosted flow, webhook or signature checking. | Provider interface for a hosted ID + selfie + liveness flow, server-created sessions bound to the signed-in mechanic, signed idempotent webhooks, server-side result fetch, reason-code mapping. Stripe Identity adapter; deterministic test adapter. |
| Background / driving record | Same mock boundary. | Separate provider boundary with explicit consent capture; disabled until a provider and an approved adjudication policy are configured. No result is ever invented. |
| Insurance | Carrier, last 4, coverage, file name, dates. No policy type or named insured, no reasons, no renewal reminders. | Policy type, carrier, named insured/business, effective and expiry dates, stored evidence; manual review with reasons; reminders at 30 and 7 days; expiry at read time. |
| Email / phone | Not modelled as checks. Accounts can't be created without confirming an email (or Google sign-in). | Email check recorded from the sign-in provider's confirmation. Phone check needs an SMS provider: shown as not available, never assumed. |
| Admin | Approve / reject / needs info; reason required except for approval; no revoke; no self-review guard; any admin could open any upload. | Approve, reject, request more info, revoke, each with a required reason and reason codes; self-review blocked; every action logged; verification documents only via signed links to reviewers. |
| Public UI | Per-check status words (good). Chips read "Identity: Verified" without who or when. | Plain statements with provider/reviewer and date, "What this means" and "What Clutch checked". |

## The record

```ts
VerificationRecord {
  id, mechanicId, accountId          // subject: the mechanic profile and its login
  category                           // email | phone | identity | background | driving_record | insurance | credential | employment | past_repair
  method                             // hosted_identity | vendor_screening | document_review | email_link | sms_code | institution_check | employer_check | customer_confirmation | platform_job
  provider?, providerRef?            // "stripe_identity", "vs_…"; never shown to customers
  status                             // see below
  submittedAt?, reviewedAt?, verifiedAt?, expiresAt?
  decidedBy?: { kind: "staff" | "provider" | "system"; id }   // reviewer user id, or provider webhook event id
  reasonCodes: string[]              // canonical codes (lib/verification/reasons.ts)
  supersedes?, supersededBy?         // a resubmission or renewal is a new record linked to the old one
  legacy?: { note }                  // backfilled from before this model; says what is and isn't known
  events: VerificationEvent[]        // append-only
}
VerificationEvent { at, actor: { kind, id }, action, from?, to, reasonCodes?, note?, idempotencyKey? }
```

Statuses: `not_started`, `in_progress` (hosted flow opened), `submitted` (mechanic finished their
part), `needs_more_info`, `under_review` (staff or provider deciding), `verified`, `failed`,
`expired`, `revoked`. "Renewal due" (verified, expiring within 30 days) and "expired" are derived
from `expiresAt` at every read, so a lapsed record can never read as verified.

Transitions are checked in one place (`lib/verification/transitions.ts`); anything else throws.
A retry after `failed`, `expired` or `revoked`, or a renewal, starts a new record that
`supersedes` the old one. The old record and its history are kept.

## Identity provider

**Recommendation: Stripe Identity.** The project has no identity vendor yet. Stripe Identity is a
hosted document + selfie flow with liveness and face match, per-verification pricing, no minimums,
signed webhooks, and a documented set of error codes. It works on phone cameras and keeps the ID
and selfie on Stripe. Persona and Veriff also fit; one provider is implemented, not three.

Flow:
1. The mechanic (signed in) chooses "Verify identity". The server creates a
   `VerificationSession` (type `document`, `require_live_capture`, `require_matching_selfie`,
   `metadata.clutch_record`, `metadata.clutch_account`) and redirects to the provider's hosted URL
   (single-use, short-lived). The record moves to `in_progress`.
2. The mechanic returns to `/mechanic/verification/identity/return`. Nothing is trusted from the
   URL: the server fetches the session and maps it.
3. The provider calls `/api/verification/webhook/stripe_identity`. The route checks the
   `Stripe-Signature` HMAC and timestamp (5-minute tolerance), drops replays by event id, checks
   that the session belongs to the record it names, fetches the session server-side, maps it, and
   appends one event. Duplicate deliveries change nothing.
4. Mapping: `verified` → `verified` (expires in 36 months); `requires_input` with
   `last_error.code` → `needs_more_info` or `failed` with canonical reason codes; `processing` →
   `under_review`; `canceled` → back to `not_started` with a `cancelled` event.
5. Stored: provider, session id, status, reason codes, verified date, and whether the name on the
   ID matches the account (a yes/no). **Not stored or shown:** ID number, date of birth, address,
   document or selfie images or URLs, and biometric scores.

Without `STRIPE_IDENTITY_SECRET_KEY` and `STRIPE_IDENTITY_WEBHOOK_SECRET`, the check says "Identity
verification isn't available yet". Nothing starts and nothing reads as verified. The `test`
adapter (tests and fictional demo only) behaves deterministically and is refused in the live
scope.

## Background check and driving record

Provider boundary (`BackgroundProvider`) with explicit FCRA disclosure and consent captured before
anything is sent. It is disabled (setup state shown) until both a provider key and
`CLUTCH_BACKGROUND_POLICY_APPROVED=yes` (an approved adjudication policy) are configured. No
adapter is shipped yet; results are never invented. Only the outcome status would be stored,
never report contents.

## Insurance

The mechanic submits policy type, carrier, named insured (person or business), effective and
expiry dates, and the certificate (stored privately). Staff review it and approve, reject,
request more information or revoke, with a reason. Reminders go out at 30 and 7 days before
expiry; at expiry it stops counting at once. Renewal is a new record superseding the old one.

## Admin review

- Only staff (`CLUTCH_ADMIN_EMAILS`) can review. Staff can't decide their own records.
- The review page shows: the submission and its stored evidence (signed link, 5 minutes, bound to
  the reviewer), the record's source, its full history, related records for the same mechanic
  (conflicts: an overlapping pending record, a name mismatch, a lapsed date), and expiry.
- Actions: approve, reject, request more information, revoke. Every action needs a reason (a code
  plus a note) and is appended to the history with the reviewer's id.
- Signed links carry the record, the file and the viewer, and expire quickly. One mechanic's
  documents are never reachable from another's pages or links.

## Public claims

Generated from the records at read time (`lib/verification/claims.ts`), never stored:
- Verified: "Identity verified by Stripe Identity on Sep 26, 2026", or "Insurance verified by
  Clutch staff on Sep 12, 2026, valid until Mar 2027".
- Not verified: "Insurance not verified by Clutch". Pending: "Background check: pending". Expired:
  "Insurance expired Aug 2026 (no longer verified)". Revoked: "Not verified".
- Each has a "What this means" sentence and a "What Clutch checked" list.

Cards, profiles, estimates, quote acceptance and the pre-booking confirmation all use these. The
booking acknowledgement records the exact statements shown.

## Notifications (mechanic)

A status change on any record, a request for more information (with the reason), and renewal
reminders (30 and 7 days before expiry, and on expiry), in-app and through the existing delivery
queue.

## Migration and backfill

`scripts/migrate-verifications.ts` is a dry run by default, and `--apply` runs it in one
transaction after a backup. It maps each old record to the new model without deleting anything:
- `not_submitted` → `not_started`, `pending` → `under_review` (or `in_progress` for a started
  screening), `rejected` → `failed`, `needs_info` → `needs_more_info`,
  `reverification_required` → `verified` (renewal due is derived).
- Adds a `legacy` note and a first history event that says it was migrated.
- A legacy "verified" document review without a stored file is labelled "approved from a file
  name only; document not retained" and does not count as verified publicly until resubmitted.
- A screening "verified" by the mock provider in the live scope is marked `revoked` with reason
  `legacy_unverified_provider`.
- Email checks are created for accounts, from their confirmed sign-in.

Production is not migrated without explicit approval.

## Retention and deletion (decisions to confirm)

- Identity: provider session id, status, reason codes and dates, kept while the account exists and
  for 2 years after closure (proof of what was shown to customers at booking). Images stay with the
  provider under its retention settings; set Stripe Identity's to the shortest period you're
  comfortable with.
- Insurance and certificate files: until superseded plus 2 years, then deleted.
- History events: kept with the record.
- Account deletion: records are anonymized except what booking acknowledgements referenced.

## Environment

| Variable | Purpose |
| --- | --- |
| `CLUTCH_IDENTITY_PROVIDER` | `stripe_identity` in production. Unset: identity isn't available (the Verification Center says so; nothing reads as verified). |
| `STRIPE_IDENTITY_SECRET_KEY` | A restricted key (`rk_live_…`) with Identity: write. Server only; never logged. |
| `STRIPE_IDENTITY_WEBHOOK_SECRET` | The signing secret (`whsec_…`) of the webhook endpoint below. |
| `CLUTCH_SIGNING_SECRET` | Signs 5-minute document links for reviewers (falls back to `AUTH_SECRET`). |
| `CLUTCH_BACKGROUND_PROVIDER` | Unset (disabled). No adapter ships yet. |
| `CLUTCH_BACKGROUND_POLICY_APPROVED` | `yes` only after the adjudication policy is approved. Both are required before any check opens. |
| `CLUTCH_CRON_SECRET` | Enables `POST /api/cron/verification-renewals` (daily reminders and expiry events), called with `Authorization: Bearer <secret>`. |
| `CLUTCH_TEST_PROVIDERS`, `CLUTCH_TEST_IDENTITY_SECRET` | Tests only. The test identity provider is refused when `VERCEL_ENV=production`, and for real mechanics unless `CLUTCH_TEST_PROVIDERS=on`. The fictional demo always uses it, labelled "not a real check". |

The configuration is validated at use (`lib/verification/identity/config.ts`): a missing or malformed key gives a setup message naming the variable, never its value.

### Stripe Identity setup

1. In the Stripe dashboard, turn on Identity (Settings → Identity) and set the shortest image retention you're comfortable with.
2. Create a restricted key with **Identity: Write** (and nothing else). Put it in `STRIPE_IDENTITY_SECRET_KEY` on Vercel (Production only).
3. Add a webhook endpoint `https://<your-domain>/api/verification/webhook/stripe_identity` for `identity.verification_session.verified`, `.requires_input`, `.processing` and `.canceled`. Put its signing secret in `STRIPE_IDENTITY_WEBHOOK_SECRET`.
4. Set `CLUTCH_IDENTITY_PROVIDER=stripe_identity` and redeploy.
5. Test with a Stripe test-mode key first (`rk_test_…`) and Stripe's test documents; then switch to live keys.

### Daily renewals

Point the host's scheduler (Vercel Cron, or any cron) at `POST /api/cron/verification-renewals` once a day with the bearer secret. Missing a run is safe: expiry is applied at every read; the run only records the event and notifies the mechanic.

### Migrating existing data

```
npm run db:migrate-verifications            # dry run: lists every change
npm run db:migrate-verifications -- --apply # backs up to app_scope_backup, then one transaction
```

The normalized tables (off in production) migrate through `0009_verification_canonical.sql`. The 2026-09-27 dry run of production listed 7 status/history updates and 1 backfilled email check; nothing has been applied.

## Open business and legal decisions

- Legal review of the 2026-09-26 booking policy (booking mechanics without background or
  insurance verification) and of the disclosure wording.
- Background-check provider, adjudication criteria, FCRA adverse-action process, and whether
  California's ICRAA rules apply (they will for LA).
- Minimum insurance (types and coverage) Clutch will call "verified" for mobile work.
- Retention periods above; a biometric-data notice if any provider's flow requires one in your
  jurisdiction.
- Whether to require identity before a mechanic's first booking in future.
