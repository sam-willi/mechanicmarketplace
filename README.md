# Clutch

A mechanic-first marketplace and portable reputation platform. **Mechanics should own proof of their skill.**

Product truth: [PRODUCT.md](PRODUCT.md) · Build plan and architecture: [docs/PLAN.md](docs/PLAN.md)

## Run it

### Accounts and data (Supabase)

Without any environment variables Clutch runs on seeded demo data in memory (demo accounts only). To run it for real:

1. Create a Supabase project.
2. In the SQL editor, run `supabase/migrations/0002_app_store.sql`. This creates the tables Clutch stores its data in. The demo data is seeded automatically on first boot. For a real launch set `CLUTCH_SEED=off` (start empty) and `CLUTCH_DEMO_LOGINS=off` before first boot, and list staff emails in `CLUTCH_ADMIN_EMAILS` to give them the reviewer role.
3. Authentication → URL Configuration: set Site URL to your app URL and add `http://localhost:3000/**` (and your production URL) to Redirect URLs.
4. Authentication → Providers → Email: keep "Confirm email" on. For more than a handful of emails an hour, add custom SMTP (for example Resend) under Authentication → Emails.
5. Authentication → Providers → Google: in Google Cloud Console create an OAuth client (Web application) with the redirect URI Supabase shows you (`https://<project-ref>.supabase.co/auth/v1/callback`), then paste its client ID and secret into Supabase.
6. Copy `.env.example` to `.env.local` and fill in the project URL, publishable key and the transaction-pooler `DATABASE_URL`. Set the same variables in Vercel.


```bash
npm install
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

## How it's put together

| Path | What |
|---|---|
| `lib/domain/` | Types, provenance vocabulary, reputation math (pure), and `toPublicProfile()`, the only path from private data to public pages |
| `lib/verification/` | Expiry lifecycle and the provider-agnostic screening interfaces (`ScreeningProvider`) with a mock implementation and registry |
| `lib/data/` | `Repository` interface, domain logic (`mock/repository.ts`), seed data, and the facade in `index.ts` that commits every write |
| `supabase/migrations/0001_init.sql` | Postgres schema, derived reputation views, and RLS for private screening data |
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

- **Screening vendors:** `CLUTCH_IDENTITY_PROVIDER`, `CLUTCH_BACKGROUND_PROVIDER` and `CLUTCH_DRIVING_RECORD_PROVIDER` all resolve to `mock`. Real adapters (Persona, Stripe Identity, Jumio, Checkr) implement `ScreeningProvider` and register in `lib/verification/providers/registry.ts`.
- **Auth is real:** Supabase Auth handles email + password (with email confirmation and password reset) and Google. Sessions are refreshed in `proxy.ts`; `lib/session.ts` resolves them to Clutch accounts, which are created on first sign-in (`lib/auth/provision.ts`). Demo accounts are separate, seeded, passwordless, and can be switched off with `CLUTCH_DEMO_LOGINS=off`.
- **Earnings:** job-value estimates from approved estimates and final amounts. No payments are processed.
- **Persistence:** with `DATABASE_URL`, every record is stored in Postgres (`lib/data/store.ts`, `supabase/migrations/0002_app_store.sql`). Domain logic runs against a snapshot of the records; each write is one transaction guarded by a version number, so several server instances stay consistent and retry on conflicts. `0001_init.sql` is the normalized schema to move to as data grows.
- **Files, SMS, payments:** uploads are stored in Postgres (`app_media`) when `DATABASE_URL` is set (move to Supabase Storage for large volumes). Past-customer confirmation links are shown on screen instead of texted, and no payments are processed. Account emails (confirmation, reset) are sent by Supabase.

## Trust experiment

Profiles render in a `high` (full evidence) or `low` (bio, stars, self-reported) variant. Force one with `?variant=low`. Set `CLUTCH_EXPERIMENT=on` to assign visitors 50/50 by cookie. Every analytics event carries the variant.

## Demo data

Every mechanic, shop, customer and review is fictional. Seven demo mechanics have portrait photos; Priya Nair shows an initials print. No repair photos are seeded: galleries show a repair icon and vehicle outline until a mechanic adds photos. Photos taken during a Clutch job are labelled "Verified repair photo"; photos added to a record later are labelled "Mechanic-uploaded photo".
