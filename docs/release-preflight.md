# Release preflight

One read-only command that says whether an environment is configured to run Clutch for real:

```
npm run preflight -- --env-file=<file> --online [--json] [--target=production|preview|local] [--app-url=https://…]
```

Every check is **PASS** (ready), **WARN** (works, but needs a decision or a manual confirmation) or
**BLOCKED** (not safe to call production-ready). An optional provider that is switched off is
reported as **disabled**, a WARN, never as configured. Exit code `0` = nothing blocked, `2` =
something BLOCKED, `1` = the preflight itself couldn't run.

## What it never does

- **Writes nothing.** Database queries run inside `BEGIN READ ONLY` with a 10 s statement timeout,
  so Postgres itself refuses any write (tested in `tests-db/preflight-db.test.ts`). HTTP probes are
  GETs only. It doesn't set secrets, run migrations, change Supabase, Stripe or Vercel settings, or
  touch demo or live records.
- **Prints no secret.** Values of `DATABASE_URL` (and its password on its own), `AUTH_SECRET`,
  `CLUTCH_SIGNING_SECRET`, `CLUTCH_CRON_SECRET`, `STRIPE_IDENTITY_*`, `SMTP_PASSWORD`, Supabase keys
  and test secrets are scrubbed from every string before output. Reports say "set (not shown)",
  lengths, or modes (live/test), never values. Reviewer email addresses aren't printed either.
- **Speaks only for the configuration it was given.** The header names the source (an env file or
  the shell). A READY for `.env.local` says nothing about Vercel's production variables.

## Running it

| Goal | Command |
| --- | --- |
| Config only, this shell | `npm run preflight` |
| A pulled environment file | `npm run preflight -- --env-file=.env.production.local` |
| Also probe DB + public endpoints (read-only) | add `--online` |
| CI / scripts | add `--json` (the full report; `ready`, `summary`, `items[]`) |
| A preview deployment | `--target=preview` (problems warn instead of block; test-mode Stripe keys are fine) |
| Probe the public address while using a local env file | `--app-url=https://mechanicmarketplace.vercel.app` |

To check Vercel's real production configuration, pull it to a git-ignored file, run, and delete it:

```bash
vercel env pull .env.production.local --environment=production
npm run preflight -- --env-file=.env.production.local --online
rm .env.production.local
```

(`.env*.local` is git-ignored. The pulled file holds production secrets. Keep it on your machine only.)

In CI, gate a release job on the exit code and keep the JSON as an artifact:

```yaml
- run: npm run preflight -- --online --json > preflight.json
  env: { APP_URL: ${{ vars.APP_URL }}, DATABASE_URL: ${{ secrets.DATABASE_URL }}, AUTH_SECRET: ${{ secrets.AUTH_SECRET }}, NEXT_PUBLIC_SUPABASE_URL: ${{ vars.SUPABASE_URL }}, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ${{ vars.SUPABASE_PUBLISHABLE_KEY }} }
```

## What it checks

| Area | Checks | Online (read-only) |
| --- | --- | --- |
| environment | test-only switches off (`CLUTCH_TEST_LOGINS`, `CLUTCH_TEST_PROVIDERS`, `CLUTCH_VEHICLE_DATA=fixtures`, `CLUTCH_IDENTITY_PROVIDER=test`); `AUTH_SECRET` ≥ 32 chars; snapshot store; reviewer emails | |
| app_url | `APP_URL` is public https, no localhost, no trailing slash | GET `/`, `/privacy`, `/help` |
| auth | Supabase URL + publishable key; a service/secret key in a `NEXT_PUBLIC_` variable is BLOCKED; the exact Site URL and redirect URLs to confirm by hand | GET `/auth/v1/settings`: reachable, Google on, email confirmation on |
| database | | connects; app tables; schema versions this build records (`app_store:v1`, `delivery:<hash>`; pending = applies on first start); live/demo split markers; verification records with older status words |
| isolation | public demo on/off (a labelled decision) | no demo accounts in live; no ids shared between scopes (each scope's `_kv` settings rows excepted); old `isDemo` flags on live mechanics |
| documents | a secret to sign document links | row level security on every app table with **no** policies; the publishable key reads **no** rows from `app_media` |
| email | outbound alerts: disabled (in-app only) / on but incomplete (BLOCKED) / ready | |
| cron | `CLUTCH_CRON_SECRET` length; a scheduler that **POSTs** to `/api/cron/verification-renewals` (and `deliver-alerts` once alerts are on). Vercel Cron sends GET, so vercel.json crons can't drive these routes (BLOCKED) | |
| identity | disabled (optional) / `stripe_identity` with `rk_`/`sk_` key (test key in production BLOCKED, `sk_` WARN: prefer restricted), `whsec_` webhook secret; the webhook endpoint and return URL to confirm by hand | Stripe: list one verification session (GET) |
| background | disabled (optional); a provider without an adapter is BLOCKED | |
| legal | `/privacy`, `/help`, `/verification` exist; `/terms` missing is a WARN | |

## Last run (2026-09-27)

`npm run preflight -- --env-file=.env.local --online --app-url=https://mechanicmarketplace.vercel.app`
against the production database and public site: **0 blocked · 10 warnings · 22 passed**, no secret
in the output (scanned against every `.env.local` value).

Vercel's production variables (names only, read with the Vercel API, values not decrypted): `APP_URL`,
`DATABASE_URL`, `AUTH_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
So production differs from `.env.local`: it has **no `CLUTCH_ADMIN_EMAILS`**, meaning nobody can review
verification documents there. Vercel also flags `DATABASE_URL` and `AUTH_SECRET` as readable secrets.

## Safe next actions, in order

Each needs the owner's go-ahead. None is done by the preflight.

1. **Reviewer account:** add `CLUTCH_ADMIN_EMAILS` to Vercel production (the reviewer's verified sign-in email).
2. **Sensitive variables:** re-add `DATABASE_URL` and `AUTH_SECRET` as *Sensitive* in Vercel (same values) so they can't be read back.
3. **Supabase URL configuration:** confirm Site URL `https://mechanicmarketplace.vercel.app` and redirects `…/auth/callback` and `…/auth/confirm`.
4. **Renewal reminders:** set `CLUTCH_CRON_SECRET` (32+ random bytes) in Vercel and as a repository secret, and add a daily scheduled workflow that POSTs to `/api/cron/verification-renewals` with `Authorization: Bearer $CLUTCH_CRON_SECRET`.
5. **Data tidy-ups (dry run first, then `--apply` only with approval):** `npm run db:migrate-verifications` (7 live records), `npm run db:repair-demo-flags` (1 record).
6. **Decisions:** keep or turn off the public demo (`CLUTCH_DEMO_LOGINS=off`); terms of service and legal review of the privacy draft; identity (Stripe Identity setup in docs/verification.md); background checks (provider and policy); an email provider adapter for outbound alerts.

Rerun the preflight after each change.
