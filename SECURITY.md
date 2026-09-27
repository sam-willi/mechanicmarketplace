# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately, not in a public issue or pull request.

**A private reporting contact has not been set up yet.** Before public launch, the maintainers must add one here (a monitored address, or GitHub private vulnerability reporting under *Settings → Code security*). Until then, open a GitHub issue that says only that you have a security report and asks for a private channel, without any details.

Include what's affected, how to reproduce it, and the impact you expect. Don't access other people's data, run tests against a production deployment, or disrupt service.

## What's sensitive here

- Customers' contact details, addresses, VINs, repair descriptions and uploads.
- Mechanics' screening, insurance and credential records (never shown publicly).
- The separation between the real and the demo marketplace.
- Server-only settings: `DATABASE_URL`, `AUTH_SECRET`, SMTP credentials, `CLUTCH_CRON_SECRET`. They never belong in client code, logs or the repository.

## Built-in safeguards worth knowing when testing

- `/api/test-login` and the local test fixtures are refused in production builds.
- `AUTH_SECRET` is required in production; without it, signed cookies fail closed.
- Outbound alerts can't send without a real provider adapter, and never to test or placeholder addresses.
