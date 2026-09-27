# Contributing to Clutch

1. Fork and clone the repository, then `npm ci` (never `npm install`: the lockfile is the source of truth).
2. Create a focused branch.
3. Make the change without adding secrets, real personal data, absolute paths or machine-specific files. Test data uses `@example.test` addresses and invented names.
4. Run `npm run verify` (lint, type-check, app tests, database tests on a throwaway Postgres, production build). It never uses your `DATABASE_URL`. If you can't install Postgres, run `npm run verify -- --skip-db` and say so in the pull request. If you touched sign-up, sign-in, onboarding, requests, estimates, booking or jobs, also run `npm run test:browser` (needs Chrome and `npm i --no-save puppeteer-core`; see the README).
5. For interface changes, check the page at desktop width and at 390 px, and attach screenshots.
6. Open a pull request that says:
   - what changed and why;
   - how it was tested;
   - whether it needs a migration or an environment change (and update `.env.example` and the README if so);
   - screenshots for visible changes.

## Rules that reviews enforce

- **Demo and real data never mix.** Demo records live in their own scope; a real account can't read, match or link to them.
- **Authorization lives on the server,** in the queries (`lib/data/normalized/needs.ts`) and the domain rules (`lib/data/mock/repository.ts`). A page that shows less isn't a permission check.
- **Don't fake providers.** Screening, email, SMS and payments stay honestly "not connected" until a real integration exists.
- **Don't weaken a test to make it pass.** If a rule changed on purpose, change the test and explain why in the pull request.
- **Migrations stay idempotent** (`if not exists`, `create or replace`). The app applies each file once per content version (recorded in `clutch_schema`), so a changed file runs once more on the next start; prefer a new numbered file for anything that isn't safe to re-run.
