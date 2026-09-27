# Clutch

A mechanic-first marketplace and portable reputation platform. **Mechanics should own proof of their skill.**

Product truth: [PRODUCT.md](PRODUCT.md) · Build plan and architecture: [docs/PLAN.md](docs/PLAN.md) · Live data access: [docs/live-reads.md](docs/live-reads.md)

## What is Clutch?

Clutch is a two-sided marketplace connecting customers with independent mechanics.

Customers can:

- identify their exact vehicle and configuration;
- describe a repair problem and upload supporting photos;
- find mechanics with relevant, verified experience;
- compare written estimates;
- book and track repairs;
- approve revised estimates and additional work;
- document payment and leave a verified review.

Mechanics can:

- build a portable professional reputation;
- document completed repairs and credentials;
- receive relevant repair opportunities;
- ask customers follow-up questions;
- create itemized estimates;
- manage appointments, repairs and customers;
- track earnings and reputation.

Clutch is designed around a simple principle: mechanics should own proof of their skill, while customers should have enough evidence to confidently hire an independent professional.

## Current project status

Clutch is an active MVP, not a production-ready marketplace.

The core customer, mechanic and staff workflows are implemented and tested, including **live bookings with real accounts**: sign-up and email confirmation, sign-in, mechanic onboarding (basic profile only; every check may be unverified), a vehicle and repair request, the mechanic's questions and estimate, the customer's verification acknowledgement, booking, and the job through to the customer confirming it's done. `npm run test:browser` runs that whole path in a browser against an isolated database, in both storage modes.

What stands between this and public use are **external prerequisites, not missing product code**: legal review of the booking policy, a production Supabase project with working auth email, secrets and hosting, and the business decisions below. They're listed in the [morning assistance checklist](#morning-assistance-checklist). Until they're done, don't point real customers at it.

### Implemented

- Customer and mechanic account creation
- Email/password and Google authentication through Supabase
- Separate customer and mechanic applications
- Vehicle identification and configuration
- Repair-request intake
- Mechanic search and explainable recommendations
- Mechanic profiles and repair evidence
- Written estimates and estimate revisions
- Booking and appointment management
- Repair lifecycle and additional-work approval
- Self-reported off-platform payment records
- Verified reviews
- In-app notifications
- Staff verification, demand, support and delivery queues
- Demo accounts isolated from the real marketplace
- Transactional and idempotent lifecycle protections
- Normalized live storage with targeted, access-checked reads (built, off by default)
- Bookable mechanics with every verification check shown separately, a customer acknowledgement before booking anyone not fully verified, and that record kept with the booking (policy of 2026-09-26)
- Responsive customer, mechanic and staff interfaces

### Required before public launch

- **Legal review of the 2026-09-26 booking policy** (unverified mechanics bookable after disclosure) and its disclosure text (`lib/domain/disclosure.ts`)
- Connect a real identity and background-screening provider (until then those checks show as not completed for real mechanics)
- Configure reliable authentication email delivery
- Configure a real outbound email provider
- Set production secrets and redirect URLs
- Select a production hosting environment
- Load-test the normalized store, then migrate and switch it on (browser and large-dataset verification are done; see [docs/live-reads.md](docs/live-reads.md))
- Establish a real support inbox and response policy
- Complete legal, privacy, insurance and marketplace-policy review
- Recruit and verify the first real mechanics

**Every mechanic is mobile (2026-09-26):** mechanics go to the car. Requests ask where the car is, not where the repair happens; there is no shop option in onboarding, search or estimates, and every mechanic is matched by their travel radius. Older records that say "shop" or "both" are read as mobile (the `work_model`/`service_mode` columns keep their values; nothing reads them differently).

**Booking policy (2026-09-26, flagged for legal review):** a mechanic with a complete basic profile (service area, repairs, pricing, availability) can be matched, quote and be booked even when identity, background, driving-record or insurance checks are missing, pending, failed to run or unverified. Each check is always shown with its own status and never presented as verified. Before booking a mechanic Clutch hasn't fully verified, the customer sees exactly which checks are and aren't verified, ticks an unticked acknowledgement, and that record (disclosure text and version, statuses, who, when) stays with the booking. The disclosure isn't a waiver and doesn't change anyone's obligations.

### Morning assistance checklist

Things only the project owner can do. Everything else is built and tested locally.

1. **Legal review** of the 2026-09-26 booking policy, the disclosure and acknowledgement text (`lib/domain/disclosure.ts`), terms and privacy policy.
2. **Payments decision.** Clutch doesn't process payments; customers pay mechanics directly and either side can record it. Confirm that's the launch model and that the terms say so.
3. **Supabase Auth, production project:** Site URL and redirect URLs (`https://<domain>/auth/callback`, `https://<domain>/auth/confirm`), email confirmation on, and **custom SMTP** (Supabase's built-in sender is rate-limited and for testing only) with SPF/DKIM/DMARC on the sending domain.
4. **Google sign-in:** a Google OAuth client with a published consent screen, added in Supabase. Not tested locally (it needs Google); hide the button if it isn't set up.
5. **One real sign-up per role against that Supabase project**, with a mailbox you control. Locally the auth server is a stand-in (below), so this is the first run against real Supabase Auth.
6. **Hosting:** `DATABASE_URL`, `AUTH_SECRET`, `APP_URL` and the Supabase keys set in production; `CLUTCH_DEMO_LOGINS=off` unless the demo should be public.
7. **Optional before launch:** a screening provider (checks show as not completed until then), an outbound email provider for alerts (in-app notifications work without it), and a support inbox.

## Table of contents

- [Run it](#run-it)
- [Product areas](#product-areas)
- [Environment variables](#environment-variables)
- [Testing](#testing)
- [External services](#external-services)
- [Security and privacy](#security-and-privacy)
- [Architecture](#how-its-put-together)
- [Demo accounts](#demo-data)
- [Deployment checklist](#deployment-checklist)
- [Known limitations](#known-limitations)
- [Forking and running on another machine](#forking-and-running-on-another-machine)
- [Contributing](#contributing)

## Run it

### On your own machine

Needs Node 20.9 or newer (verified on Node 24; see `.nvmrc`) and npm. Postgres is optional.

```bash
git clone <your fork> clutch && cd clutch
npm ci
npm run dev
```

Open http://localhost:3000. With no `.env.local` at all, Clutch runs in memory: an empty real marketplace plus the fictional demo marketplace (one-click demo accounts at `/login` or `/demo`). Nothing leaves your machine.

**With a local database** (still nothing external):

```bash
npm run db:local              # creates and starts Postgres in ./.local-pg on 127.0.0.1, prints DATABASE_URL
cp .env.example .env.local    # then set DATABASE_URL to what it printed, and CLUTCH_TEST_LOGINS=on
npm run dev
```

`/api/test-login?as=customer|mechanic|staff` then signs you in to fictional `@example.test` accounts in the real marketplace (only outside production and only with a local database). Add `CLUTCH_LIVE_STORE=normalized` to try the normalized store with targeted reads. `npm run db:local -- stop` stops the database; `-- reset` deletes it.

**Resetting the demo.** With a database, the fictional demo is saved like everything else, so what you do in it persists. `npm run db:reset-demo` shows what the demo scope holds; `npm run db:reset-demo -- --yes` removes it (demo rows only, never the real marketplace) and the original demo is seeded the next time the app loads. Restart a running server afterwards. Without a database the demo resets on every restart.

`npm run db:local` and `npm run test:db` need Postgres 16+ server binaries (`initdb`, `pg_ctl`). They're found on the PATH, via `pg_config`, or in the usual Homebrew and Debian/Ubuntu locations. Otherwise set `CLUTCH_PG_BIN` (macOS: `brew install postgresql@18`; Debian/Ubuntu: `apt install postgresql`).

**Migrations.** You never run them by hand locally. `0002` (and `0003`) are the base store: `npm run db:local` applies them, and on Supabase you run them once in the SQL editor. The app applies `0003` and `0005` itself, plus `0004` and `0006`–`0008` when `CLUTCH_LIVE_STORE=normalized`. Each is applied once per version, recorded in `clutch_schema`, never on every start. `0001` is reference only.

### Accounts and data (Supabase)

Without any environment variables Clutch runs in memory: an empty real marketplace plus the seeded demo marketplace (demo accounts only). To run it for real:

1. Create a Supabase project.
2. In the SQL editor, run `supabase/migrations/0002_app_store.sql` (and optionally `0003_data_scope.sql`; the server applies it on boot anyway). This creates the tables Clutch stores its data in. The real marketplace starts empty; the fictional demo marketplace is seeded separately the first time a demo session uses it. Set `CLUTCH_DEMO_LOGINS=off` to switch the demo off entirely, and list staff emails in `CLUTCH_ADMIN_EMAILS` to give them the reviewer role.
3. Authentication → URL Configuration: set Site URL to your app URL and add `http://localhost:3000/**` (and your production URL) to Redirect URLs.
4. Authentication → Providers → Email: keep "Confirm email" on. For more than a handful of emails an hour, add custom SMTP (for example Resend) under Authentication → Emails.
5. Authentication → Providers → Google: in Google Cloud Console create an OAuth client (Web application) with the redirect URI Supabase shows you (`https://<project-ref>.supabase.co/auth/v1/callback`), then paste its client ID and secret into Supabase.
6. Copy `.env.example` to `.env.local` and fill in the project URL, publishable key and the transaction-pooler `DATABASE_URL`. Set the same variables in Vercel.

```bash
npm ci
npm run dev
```

Open http://localhost:3000. Sign up with email and password or Google (once Supabase is configured, see above), or pick a demo account at `/login` or `/demo`.

Clutch is one account with two apps:
- `/customer/*` is the customer app: find mechanics, post requests, compare quotes, track repairs, save mechanics and keep vehicles.
- `/mechanic/*` is the mechanic app: opportunities, quotes, jobs, customers, reputation, verification, earnings and public-profile tools.
- Derek Hall's demo account holds both roles, so you can switch modes from the account menu.

Good places to start:

- `/mechanics/derek-hall?repair=brakes&make=BMW` — a profile opened from a job-specific link
- `/mechanics/marcus-webb` — a new mechanic whose experience is mostly self-reported
- `/mechanics/derek-hall?variant=low` — the low-evidence arm of the trust experiment
- `/customer/requests/req-maya-bmw` — evidence-first quote comparison (as Maya)
- `/mechanic/verification` — the Verification Center (as any mechanic)
- `/admin` — the verification review queue (as the reviewer)
- `/confirm/derek-c300` — a past customer confirming a repair
- `/mechanics?repair=brakes&make=Toyota` — Best Fit and Soonest Strong Fit as two different mechanics, with the tradeoff spelled out
- `/customer/quotes/quote-samuel-bmw` — an estimate from a mechanic whose insurance has expired: visible, but can't be booked
- `/mechanic/requests/req-chris-135i` — structured opportunity, "enough to quote?" check, and the itemized estimate builder
- `/customer/quotes/quote-derek-bmw` — a written estimate with Accept / Ask a question / Decline (as Maya)
- `/mechanic/jobs/job-elena-pilot` — confirm an appointment and add job photos (as Derek)
- `/help` and `/customer/help` — what protects customers, what Clutch doesn't do, and issue reports

## Product areas

| Area | Route | Purpose |
|---|---|---|
| Public marketplace | `/` and `/mechanics` | Explain Clutch and browse eligible mechanics |
| Customer application | `/customer/*` | Vehicles, requests, estimates, bookings and repairs |
| Mechanic application | `/mechanic/*` | Opportunities, estimates, jobs, profile and verification |
| Staff application | `/admin/*` | Verification, demand, support and delivery monitoring |
| Demo marketplace | `/demo` | Fictional testing environment isolated from real data |

A single account may hold both customer and mechanic roles. The two modes use separate navigation and workflows.

## Environment variables

Copy `.env.example` to `.env.local`. Never commit `.env.local` or production credentials.

| Variable | Required | Purpose |
|---|---:|---|
| `NEXT_PUBLIC_SUPABASE_URL` | For real auth | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | For real auth | Public Supabase browser key |
| `DATABASE_URL` | For persistence | PostgreSQL connection (Supabase transaction pooler, or `npm run db:local`) |
| `APP_URL` | Production | Public HTTPS application address |
| `AUTH_SECRET` | Production | Signs the demo-account, marketplace-scope and test sign-in cookies |
| `CLUTCH_ADMIN_EMAILS` | For staff | Comma-separated authorized staff accounts |
| `CLUTCH_DEMO_LOGINS` | Optional | On unless set to `off`: fictional demo access |
| `CLUTCH_TEST_LOGINS` | Local testing only | Fictional test accounts; only outside production with no database or a local one |
| `CLUTCH_LIVE_STORE` | Optional | `normalized`: normalized live storage, after migration |
| `CLUTCH_LIVE_READS` | Rollback only | `snapshot`: the legacy whole-marketplace read path |
| `CLUTCH_OUTBOUND_ALERTS` | Optional | Enables outbound alerts once a provider is configured |
| `CLUTCH_EMAIL_PROVIDER`, `SMTP_*`, `EMAIL_FROM` | With alerts | Email provider settings (no adapter ships yet) |
| `CLUTCH_CRON_SECRET` | When scheduling alerts | Protects the hosted delivery-worker endpoint |
| `CLUTCH_PG_BIN` | Rarely | Postgres binaries for `test:db` and `db:local`, if not found automatically |

See `.env.example` for the complete and current list.

## Testing

Before a pull request, one command runs every non-destructive check:

```bash
npm ci
npm run verify    # lint, type-check, app tests, database tests, production build
```

`verify` blanks `DATABASE_URL`, Supabase keys and every Clutch switch for each step, so it never touches your database or services. The database tests always create their own temporary Postgres cluster, which needs Postgres 16+ server binaries (see [Run it](#run-it)); without them, `npm run verify -- --skip-db` skips that step and says so. The steps also run one at a time: `npm test`, `npm run test:db`, `npm run lint`, `npx tsc --noEmit`, `npm run build`.

**Browser test of real accounts** (`npm run test:browser`): two fictional users sign up and complete a booking and repair in Chrome, with a server restart and log-out/log-in, against a throwaway Postgres cluster and a production build with demo logins off (built into `.next-browser-test`, so a running dev server isn't touched; nothing from `.env.local` is used). Sign-up goes through the app's real Supabase Auth code, pointed at `scripts/local-auth.mjs`: a **local stand-in for the Supabase Auth API, not Supabase**. It listens on 127.0.0.1, keeps its users in the throwaway database, and never sends email; confirmation links go to a local mailbox the test reads. It needs Chrome and `npm i --no-save puppeteer-core`. `CLUTCH_BROWSER_STORE=normalized npm run test:browser` runs it on the normalized store.

CI (`.github/workflows/ci.yml`) runs `npm run verify` on Node 20 and 24 on Ubuntu for every push and pull request, forks included. It needs no secrets and has read-only permissions.

Important coverage includes:

- authentication and onboarding;
- customer/mechanic role separation;
- real/demo data isolation;
- request and estimate authorization;
- concurrent estimate acceptance;
- idempotent retries and duplicate submissions;
- booking and repair state transitions;
- estimate revisions and additional-work approval;
- support cases and review integrity;
- notification delivery and privacy;
- database migration and rollback;
- large-marketplace pagination and query behavior;
- responsive layouts and browser workflows;
- the real-account path end to end in a browser (`npm run test:browser`).

## External services

Clutch intentionally does not fake unavailable providers.

| Service | Current state |
|---|---|
| Supabase authentication | Implemented |
| PostgreSQL persistence | Implemented |
| Identity/background screening | Interface exists; no real provider yet, so those checks show as not completed (not required to be booked) |
| Authentication email | Supabase sender works for limited testing; custom SMTP required |
| Marketplace alerts | Queue and worker implemented; provider intentionally absent |
| Payments | Not processed by Clutch |
| SMS | Not implemented |
| File storage | PostgreSQL-backed for MVP (in memory without a database); object storage recommended before scale |

## Security and privacy

- Real and demo marketplaces are isolated on the server.
- Demo records cannot be matched with or accessed by real accounts.
- Direct record access is authorized by ownership, role and marketplace scope, in the database query itself.
- Unauthorized records return a not-found experience.
- Sensitive screening evidence is not exposed on public mechanic profiles; only each check's status is.
- Booking a mechanic who isn't fully verified requires the customer's acknowledgement of exactly which checks aren't verified; the server re-checks it at booking, and the database keeps the record unchangeable.
- Notification payloads omit names, VINs, addresses, prices, documents and message contents.
- Database writes are transactional, versioned and idempotent.
- Accepted estimates are immutable; additional work requires customer approval.
- Payment records are self-reported. Clutch does not hold, process, refund or guarantee funds.
- Secrets must remain in server-side environment variables.
- Test accounts and placeholder addresses are blocked from outbound delivery.
- **Uploads** (`lib/media/policy.ts`) are accepted from what their bytes are, never the browser's type or the file name: photos (JPEG, PNG, WebP, up to 20 MB), video (MP4, MOV, WebM, 3GP) and audio (M4A, MP3, WAV, WebM, Ogg, AAC) up to 40 MB, and PDFs (customers' request attachments only, up to 20 MB). The declared type and extension must match the bytes. SVG, HTML/XML, scripts, archives, programs, GIFs and double extensions are refused. HEIC/HEIF is refused with instructions, because most browsers can't display it. Portraits and car photos must be photos; mechanics upload photos and video only.
- **Serving uploads** (`/api/media/[id]`) keeps the same authorization and demo/live isolation, and re-derives the type from the stored bytes. Photos, video and audio are sent inline; PDFs and anything unrecognised (including files stored before this check) are downloads. Every response has `X-Content-Type-Options: nosniff`, a sandboxing `Content-Security-Policy`, `Cross-Origin-Resource-Policy: same-origin` and a generated file name (`clutch-photo-1a2b3c4d.jpg`), never the uploader's. Byte ranges are supported for video.

To report a vulnerability, see [SECURITY.md](SECURITY.md). Don't file it publicly.

## How it's put together

| Path | What |
|---|---|
| `lib/domain/` | Types, provenance vocabulary, reputation math (pure), and `toPublicProfile()`, the only path from private data to public pages |
| `lib/verification/` | Expiry lifecycle and the provider-agnostic screening interfaces (`ScreeningProvider`) with a mock implementation and registry |
| `lib/data/` | `Repository` interface, domain logic (`mock/repository.ts`), seed data, and the facade in `index.ts` that commits every write |
| `supabase/migrations/0001_init.sql` | The original relational design (Supabase-only: it references `auth.users`). Kept for reference; the app never applies it, and `0004` superseded it |
| `components/trust/` | Tick marks, provenance chips, the evidence sheet, and the trust-first summary |
| `components/profile/` | Public profile sections |
| `app/actions/` | Server actions (account, analytics, customer, intake, mechanic) |
| `proxy.ts` | Tags requests with the app area (customer/mechanic) so one login uses the right role; session id; evidence variant when `CLUTCH_EXPERIMENT=on` |
| `app/customer/`, `app/mechanic/` | The two apps, each with its own layout, navigation and phone bottom bar |
| `lib/session.ts`, `app/actions/account.ts`, `app/auth/*` | Supabase Auth sessions, sign-up/in, Google, password reset, role modes, demo accounts |
| `lib/vehicles/` | Vehicle identification: provider interface (NHTSA vPIC for model lists and VIN decoding, curated factory catalog for configurations), spec builder with a source for every attribute, recorded specs for repair history |
| `lib/data/store.ts` | Postgres persistence: snapshot load, versioned transactional commits, media and analytics tables |
| `lib/mechanic-insights.ts` | Opportunity matching (with "why you matched"), earnings estimates, reputation milestones |

## Mocked in this MVP

- **Screening vendors:** `CLUTCH_IDENTITY_PROVIDER`, `CLUTCH_BACKGROUND_PROVIDER` and `CLUTCH_DRIVING_RECORD_PROVIDER` all resolve to `mock`. Real adapters (Persona, Stripe Identity, Jumio, Checkr) implement `ScreeningProvider` and register in `lib/verification/providers/registry.ts`. The mock only runs for demo (fictional) mechanics: in the real marketplace, ID, background and driving record checks show "Opens soon", can't be started, and a check that no provider ran can't be approved by staff (`screeningOpen`). Until a real provider is connected those checks show as not completed; under the 2026-09-26 policy that doesn't stop a mechanic being booked, but customers see it and acknowledge it first.
- **Notifications:** updates appear in the in-app Notifications list only. Clutch doesn't send email, SMS or push updates yet, and the UI doesn't promise them.
- **Auth is real:** Supabase Auth handles email + password (with email confirmation and password reset) and Google. Sessions are refreshed in `proxy.ts`; `lib/session.ts` resolves them to Clutch accounts, which are created on first sign-in (`lib/auth/provision.ts`). Demo accounts are separate, seeded, passwordless, and can be switched off with `CLUTCH_DEMO_LOGINS=off`.
- **Earnings:** job-value estimates from approved estimates and final amounts. No payments are processed.
- **Persistence:** with `DATABASE_URL`, every record is stored in Postgres (`lib/data/store.ts`, `supabase/migrations/0002_app_store.sql`). Domain logic runs against a snapshot of the records; each write is one transaction guarded by a version number, so several server instances stay consistent and retry on conflicts. The normalized live schema is `0004_live_normalized.sql` (see below); `0001_init.sql` is the original design, kept for reference and never applied.
- **Files, SMS, payments:** uploads are stored in Postgres (`app_media`) when `DATABASE_URL` is set (move to Supabase Storage for large volumes). Past-customer confirmation links are shown on screen instead of texted, and no payments are processed. Account emails (confirmation, reset) are sent by Supabase.

## An empty marketplace

With no bookable mechanics, nothing is blank and nothing is invented. Search says no mechanics match, repeats the search, counts what removing each filter would change, and offers to save a repair request. Saved requests stay open (`waitingSince`), can be edited or cancelled, and are sent automatically to the first mechanics who fit once one finishes their profile (`matchWaiting` in `lib/data/mock/repository.ts`). New mechanics see a "Get matched with customers" checklist (`lib/matchable.ts`). Staff see unmatched requests by area, repair, make, age and status at `/admin/demand`, for the marketplace they're in.

To browse the real marketplace locally as a signed-in customer, mechanic or reviewer without Supabase, run the dev server in memory with test sign-in on, then open `/api/test-login?as=customer` (or `mechanic`, `staff`; add `&car=1` for a customer with a sample car). It only works with `CLUTCH_TEST_LOGINS=on`, no `DATABASE_URL` or a local one (`npm run db:local`), and never in production:

```bash
DATABASE_URL= NEXT_PUBLIC_SUPABASE_URL= CLUTCH_TEST_LOGINS=on npx next dev -p 3200
```

## Alerts (email now, SMS later): built, off

In-app notifications are the source of truth. Material ones (new request, estimate received/revised/accepted/declined, booking, time confirmed, reschedule, cancellation, extra-work approval, marked complete / sent back / confirmed, payment notes that don't match, review, support update; `lib/notify/events.ts`) also queue an optional alert in `delivery_outbox`, in the same database transaction as the notification (`supabase/migrations/0005_delivery.sql`). Account confirmation and password emails stay with Supabase Auth.

- Alerts are generic ("You have a new estimate") plus a link into Clutch: never names, cars, addresses, VINs, prices, documents, screening details or message text. The queue stores no addresses; the worker looks up the contact when sending.
- Sent only to verified sign-in emails, when the person hasn't turned email alerts off; never to demo accounts, test or placeholder domains, or anything outside the live marketplace (the table refuses other scopes).
- States: pending → processing (leased) → sent | retry (backoff) | failed (dead letter after max attempts) | suppressed (with a reason) | no_provider (nothing sent; retried automatically once a provider is configured). Every attempt is recorded, redacted. "Sent" requires a provider message id and is final.
- Workers claim with `FOR UPDATE SKIP LOCKED` and a lease; a crashed worker's lease expires and another finishes. Each send carries the event's idempotency key; after a timeout the next attempt asks the provider (`lookup`) before sending again.

Nothing sends today: no provider adapter is implemented (`lib/notify/providers.ts`), and `CLUTCH_OUTBOUND_ALERTS` is off. Staff can see queue health at `/admin/delivery`, including a readiness checklist. Check configuration (never prints secrets):

```bash
npx tsx --env-file=.env.local --conditions react-server scripts/deliver-alerts.ts --check-config
```

**Running the worker** (safe to run often and concurrently):
- a scheduler runs `scripts/deliver-alerts.ts` (one batch, then exits) every minute, or `--loop` as a long-running process; or
- a hosted cron calls `POST /api/cron/deliver-alerts` with `Authorization: Bearer $CLUTCH_CRON_SECRET` (the route is off until that secret is set).

**To switch alerts on:** implement an `EmailProvider` adapter (e.g. SMTP) in `lib/notify/providers.ts` and register it; set `CLUTCH_EMAIL_PROVIDER`, its settings (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`), `EMAIL_FROM` on a domain with SPF/DKIM/DMARC, and `APP_URL`; schedule the worker; then set `CLUTCH_OUTBOUND_ALERTS=on`. Waiting "no provider" alerts go out on the next run, and the app's wording switches from "alerts are off" to describing email alerts.

## Normalized live storage (behind a flag)

`CLUTCH_LIVE_STORE=normalized` stores the real marketplace in normalized tables (`supabase/migrations/0004_live_normalized.sql`, `lib/data/normalized/`) instead of the record snapshot. It's off by default; the demo always stays on its own snapshot.

- One table per entity, with typed columns for relationships, status and amounts; child tables for invitations, questions, estimate versions, extra work, reschedules, payment reports, lifecycle history, review edits and support messages; other descriptive fields in each row's `data` jsonb.
- The database enforces the lifecycle: one accepted estimate and one active job per request, one job per estimate, one review per completed job, estimates only from invited mechanics, jobs only for the estimate's mechanic and the request's customer, a request only for the customer's own car, valid status transitions, frozen accepted estimates, append-only history, unique idempotency keys, demo accounts rejected.
- Each write runs the domain rules on a private copy and commits only the changed rows in one transaction, compare-and-swap on each row's version. Another instance's change to a row this write touches makes it re-run on fresh data; unrelated writes never conflict.
- New notifications queue their optional alert in `delivery_outbox` in the same transaction (see Alerts).
- **Targeted reads.** Every page, action and worker reads only the rows it needs, with the viewer's access rules in the query, keyset pagination on growing lists, and indexes behind each path. Nothing is cached per process. The inventory, measurements (277k-row test marketplace), query-plan evidence, rollback and exact enablement steps are in [docs/live-reads.md](docs/live-reads.md). `CLUTCH_LIVE_READS=snapshot` is the explicit rollback to the older whole-marketplace cache.

`npm run test:db` runs the database tests, including a large synthetic marketplace, on a disposable local Postgres.

**Migrating and rolling back** (`scripts/migrate-live.ts`; prints a reconciliation report, never credentials, never deletes):

```bash
npx tsx --env-file=.env.local --conditions react-server scripts/migrate-live.ts
```
runs a dry run (everything in one transaction, rolled back). `--apply` backs up the snapshot rows to `app_scope_backup` first, copies, and quarantines rows that break a rule in `lv_quarantine`. Re-running is safe: identical rows are skipped, rows never written by the normalized app are refreshed from the snapshot, and rows it did write are left alone. Run `--apply` again right before switching the flag on.

To roll back after running normalized: `--export-snapshot` (backs up the snapshot, then writes every normalized record back into it), then unset `CLUTCH_LIVE_STORE` and restart. The normalized tables and backups are kept.

## Booking lifecycle

Requests, estimates and jobs move only along the transitions in `lib/domain/transitions.ts`. Every lifecycle write in `lib/data/mock/repository.ts` takes the acting customer or mechanic, checks ownership and the current state inside the same transaction, and throws a `LifecycleError` with a plain reason (shown on the page) otherwise. A write that throws partway is rolled back (`lib/data/store.ts`).

- **Estimates** keep every sent version (`revisions`); accepting names the version the customer read, so a stale page can't accept a price that changed. Accepted estimates are frozen. Accepting is idempotent and closes competing estimates in the same transaction: exactly one job per request.
- **Jobs**: confirm time → (optional reschedule, agreed by the other side) → check in and start → diagnosis → extra work only with the customer's approval → mark complete (final amount compared with what was approved) → customer confirms, or sends it back as not finished. Either side can cancel only before work starts; Clutch charges no fee.
- **Payment** stays off-platform. Each side can record paid / not paid and an amount; both are shown as self-reported. No card or bank data is collected.
- **Reviews**: one per completed job, only by its customer; edits keep earlier versions and count once.
- **Support**: reports are a case queue at `/admin/support` (staff only). Staff reply and set status in the app; reporters see both on their Help page and in Notifications. Nothing is emailed or texted, and no response time is promised.
- Every material action is recorded in a `history` (role, action, time; no names or contact details) shown to both sides and to staff.

## Trust experiment

Profiles render in a `high` (full evidence) or `low` (bio, stars, self-reported) variant. Force one with `?variant=low`. Set `CLUTCH_EXPERIMENT=on` to assign visitors 50/50 by cookie. Every analytics event carries the variant.

## Demo data

Real and demo data are kept apart on the server (`lib/data/scope.ts`). Every record has a scope: `live` (the real marketplace) or `demo` (a fictional showcase). A request is in the demo only when the browser holds a signed, HttpOnly demo-scope cookie, set by a demo account sign-in or "Browse the demo" at `/demo`, and only while `CLUTCH_DEMO_LOGINS` is on. Everyone else, including every real account, reads and writes live data only. The two are separate stores, so a demo id never resolves in live (search, matching, requests, estimates, jobs, messages, reviews, verification and direct URLs), and writes that link to a missing record throw a `ScopeError`. A banner shows on every page in demo mode, with "Exit demo". Databases created before scopes existed are split once on boot (`lib/data/classify.ts`): seed records and anything owned by a demo account go to demo, the rest stay live, records that linked both are moved to a `quarantine` scope that is never loaded, and every original row is copied to `app_scope_backup` first. `npm test` covers the isolation (`tests/isolation.test.ts`).

In the demo, every mechanic, shop, customer and review is fictional. Seven demo mechanics have portrait photos; Priya Nair shows an initials print. No repair photos are seeded: galleries show a repair icon and vehicle outline until a mechanic adds photos. Photos taken during a Clutch job are labelled "Verified repair photo"; photos added to a record later are labelled "Mechanic-uploaded photo".
## Deployment checklist

Do not enable public traffic until every applicable item is complete.

- [ ] All tests, type checks, linting and the production build pass
- [ ] Production database migrations were dry-run and reconciled
- [ ] Normalized storage was validated and intentionally enabled ([steps](docs/live-reads.md#before-switching-clutch_live_storenormalized-on))
- [ ] `AUTH_SECRET` and other secrets are securely configured
- [ ] Supabase Site URL and redirect URLs use the production address
- [ ] Custom SMTP is configured and tested
- [ ] Google OAuth is published for production users
- [ ] Legal review of the unverified-booking policy, disclosure text and acknowledgement record is complete
- [ ] A real screening provider is connected and webhook handling is tested (checks then show as verified)
- [ ] The first mechanics have been manually reviewed
- [ ] Outbound alerts have a real provider and scheduled worker
- [ ] SPF, DKIM and DMARC are configured
- [ ] A support inbox and response policy exist
- [ ] Privacy policy, terms and marketplace policies were reviewed
- [ ] Backup and rollback procedures were tested
- [ ] A real sign-up per role was completed against the production Supabase project
- [ ] Demo access is intentionally enabled or disabled (with `CLUTCH_DEMO_LOGINS=off`, no public page links to `/demo`)
- [ ] No test credentials or personal data are present

## Known limitations

- Real mechanic screening is not yet connected, so ID, background and driving-record checks show as not completed for real mechanics.
- Under the 2026-09-26 policy, mechanics are bookable without verification (after a customer acknowledgement); this needs legal review before launch.
- Real-account sign-up is tested locally against a stand-in for the Supabase Auth API, not Supabase itself; Google sign-in isn't tested locally. See the [morning assistance checklist](#morning-assistance-checklist).
- Clutch does not process payments.
- Email and SMS marketplace alerts are disabled until a provider is configured.
- File uploads use database storage and should move to object storage before significant traffic.
- The real marketplace begins empty and requires mechanic supply.
- Production legal, insurance and marketplace-policy review is still required.
- Another person's record inside the customer and mechanic apps shows the not-found page with a `noindex` tag, but HTTP status 200, because those pages stream (standard Next.js behavior).
- A mechanic's profile reads their whole evidence history; this grows with one mechanic's record, not with the marketplace. Other data-access limits are in [docs/live-reads.md](docs/live-reads.md#known-limits).

## Forking and running on another machine

A clean fork works without access to the original developer's accounts. Setup is in [Run it](#run-it): with no environment file, `npm ci && npm run dev` starts on local in-memory data, and the isolated fictional demo marketplace works without Supabase or PostgreSQL.

Before merging changes, verify the repository from a clean clone or archive:

1. No untracked local dependency is required.
2. No absolute filesystem path is referenced.
3. `.env.example` documents every supported setting without containing secrets.
4. `npm ci`, tests and the production build succeed.
5. The app starts without Supabase or PostgreSQL.
6. Database setup instructions work on macOS and Linux.
7. Demo accounts work without access to the original Supabase project.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: `npm ci`, make a focused change without secrets or real personal data, `npm run verify`, and explain how you tested it.
