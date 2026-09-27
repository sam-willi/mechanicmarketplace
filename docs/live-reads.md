# Targeted live reads (normalized store)

With `CLUTCH_LIVE_STORE=normalized`, every page, action, route and worker reads only the rows it needs from the real (live) marketplace. Nothing is cached in the process and nothing is shared between requests or users. Both flags are **off** by default. The live marketplace stays on the record snapshot (`app_records`) until you switch on the normalized store, and the demo marketplace always stays there.

- **Reads.** Each request gets its own *slice*, a partial copy of the marketplace (`lib/data/normalized/slice.ts`). It is filled by the loaders the page asks for (`lib/data/normalized/needs.ts`), which run indexed queries (`reader.ts`). The domain rules then run on the slice unchanged. A record the viewer may not see is simply never loaded, so the page shows "not found".
- **Writes.** Each of the 58 writes reads what its rules need inside its own repeatable-read transaction (`plans.ts`). The rules then re-check ownership, state and versions on those rows, and the commit is compare-and-swap on every changed row. A concurrent change re-runs the write on fresh rows. What the write committed (and the record it returned) is folded back into the caller's slice, so the same request can read its own writes.
- **Counts and candidate pools.** These are SQL (`queries.ts`), with an in-memory twin for the demo that must give identical answers.

## Access rules (in the queries themselves)

| Viewer | Can read |
|---|---|
| Customer | Their own account, cars, requests, **sent** estimates on those requests (never drafts), jobs, history, saved list, draft, notifications and support cases. The **public** profile of each mechanic involved. The booked mechanic's account (for their phone) only on that job's page. |
| Mechanic | Their own profile and evidence (in full). Requests they were sent (by invitation), their **own** estimate on each (never another mechanic's), their own jobs, customers' display names, and their own history with a customer. The customer's account only on a job they share. |
| Staff (admin role) | The review queue, support cases, demand and the delivery health page, and only on staff pages. |
| Anyone | Public profiles, a confirmation link's one repair, and public repair photos and portraits. |

Public profiles are read with private fields removed **in SQL**: screening vendor, reference and result; policy number, carrier and document; reviewer notes and evidence summaries; credential and employment documents; repair descriptions.

## Inventory: what each screen reads

| Screen or action | Loader | Rows it reads (bounded) |
|---|---|---|
| Every signed-in request | `account` | The user, their customer and mechanic profile (memoized per request) |
| Customer layout | `customerShell` | ≤100 open requests with their sent estimates, ≤99 unread notifications |
| Customer home | `customerHome` | Open requests, cars, jobs, history, saved, draft. Profiles only where one is shown: the first 3 estimates per request, upcoming jobs, 4 recent or saved mechanics. Names only otherwise. Supply is an existence check. |
| Requests | `customerRequests` | Every open request, plus one page of past ones (keyset, 20). No profiles. |
| Request, edit, estimate | `customerRequest`, `customerQuote` | That request if it's theirs: car, sent estimates, jobs, profiles of the mechanics on it. Replacement suggestions only when the customer needs a new mechanic (bookable pool). |
| My Repairs | `customerRepairs` | Unfinished requests, plus one page of finished ones. Profiles of the booked mechanics shown. |
| Job | `customerJob` | That job if it's theirs: estimate, request, car, review, record, saved flag, mechanic profile and account |
| Vehicles, vehicle, saved, help | `customerVehicles`, `customerVehicle`, `customerSaved`, `customerHelp` | Their own records. Mechanic names only where no profile is shown. |
| Find a mechanic | `searchPool` | Bookable candidates only (indexed prefilter on a complete profile, then the exact rule), one `lv_mechanic_stats` row each for ranking (never their repair documents), their check records, and a sample of ≤20 profiles that can't be booked |
| Notifications | `notifications` | One page (keyset, 50) |
| Mechanic layout | `mechanicShell` | Unread notifications, open invitations, estimates with an unanswered question, own verifications, active jobs |
| Mechanic home, requests | `mechanicHome`, `mechanicRequests` | Own evidence, open invitations with the car and their own estimate, recent jobs and estimates. Waiting demand is a grouped count; no request is read. |
| Mechanic request | `mechanicRequest` | That request if they were sent it: car, customer name, their own estimate |
| Estimates | `mechanicQuotes` | One tab, one page (25). Tab counts are counted, not loaded. |
| Jobs, job, customers, earnings, help, profile, reputation, verification, repairs | `mechanicJobs`, `mechanicJob`, … | Their own records |
| Staff queue | `verificationQueue` | One page of the tab (60, oldest first) and those mechanics' records. Tiles are counted in SQL with the page's own rule (`lib/admin-queue.ts`). |
| Staff review | `verificationReview` | That item, the mechanic's record, the subject's confirmation, the reviewer's name. "Next item" is a lookup. |
| Staff support, case | `supportCases`, `supportCase` | One page per status tab (50) and reporters' names. A case with its job. |
| Staff demand | `demand` | The 500 oldest open requests, their cars and live estimates. No customer data. The page says when there are more. |
| Public profile, confirmation link | `publicProfile`, `confirmation` | That mechanic or confirmation only |
| `/api/media/[id]` | `media` | Records the file is attached to, as far as this viewer may see them |
| Server actions | `ownRecords`, `historyWith`, … | The record the action checks ownership of, before the write re-checks it |
| Writes (58) | `PLANS` | Per write: its record, the records around it and the accounts notified. Matching reads the bookable pool (with stats rows), plus the 200 oldest waiting requests after anything that can make a mechanic bookable, including a first publish. Long id lists are read in primary-key batches of 200. |
| Delivery worker | (worker SQL) | Claims ≤batch undelivered events via a partial index and updates them by primary key. Reads each recipient by id. |

## Indexes and tables (`0006_live_reads.sql`, `0007_booking_verification.sql`, `0008_mechanic_stats.sql`, plus `delivery_outbox_open` in 0005)

- **Customer, mechanic and staff lists.** Owner and status indexes whose sort key is the record's `createdAt` in the `"C"` collation. That is exactly JavaScript's string order, so SQL pages and in-memory pages agree.
- **Bookable prefilter.** Since the 2026-09-26 policy a complete basic profile (area, repairs, pricing, availability) makes a mechanic bookable, so the prefilter is on profile fields; partial indexes on verified checks and insurance serve the "verified only" filters.
- **Open requests.** `lv_requests_open_category` (open requests by repair) serves waiting-demand counts and matching of waiting requests.
- **Ranking numbers.** `lv_mechanic_stats` (0008) keeps each mechanic's verified-repair counts per repair|make, per make|model, rating and repeat customers, maintained by triggers. Search and matching rank on it; the DB tests check it gives the same ranking as counting the documents.
- **Booking record.** 0007's trigger makes a job's `verificationAtBooking` immutable and refuses an unverified booking without the customer's acknowledgement.
- **Uploads.** GIN indexes find the record an uploaded file belongs to.
- **Alert worker.** A partial index on undelivered alerts only.
- **Expiry rule.** `lv_effective_status()` is the app's expiry rule in SQL.

## Measured (`tests-db/targeted.test.ts`, disposable Postgres, 277,573 rows)

The fixture holds 3,000 mechanics (about 1,200 with complete profiles, 174 of them fully verified, plus look-alikes the exact rule must reject), 4,000 customers, 20,000 requests, 38,800 invitations, 22,300 estimates, 8,900 jobs, 31,400 repairs and 50,000 notifications.

| Page | Rows read | Queries | Time |
|---|---:|---:|---:|
| Customer layout | 165 | 3 | 8 ms |
| Customer home (busiest customer) | 769 | 18 | 11 ms |
| Requests (customer with 140 requests) | 127 | 6 | 2 ms |
| Request / estimate / job | 36 / 37 / 24 | 12–16 | 1–2 ms |
| Notifications (300 of them) | 51 | 1 | 1 ms |
| Mechanic layout / home / request / job | 6 / 77 / 22 / 24 | 8–19 | 1–2 ms |
| Estimates tab | 4 | 5 | 1 ms |
| Public profile | 18 | 8 | 1 ms |
| Staff queue / support / demand | 495 / 101 / 1,197 | 9 / 2 / 3 | 3 / 1 / 10 ms |
| Search pool (1,224 bookable + 20 sample) | 5,534 | 11 | 98 ms |
| Delivery worker, 200-event batch | n/a | n/a | 95 ms |

The snapshot path it replaces loaded every live record into every server process.

The test also proves:

- **Pages have no N+1 queries.** Query counts are fixed per page, whatever the data size.
- **Pagination.** Keyset pagination concatenates to exactly the database order. A stale cursor still pages correctly after rows are added or removed between pages. Malformed or hostile cursors read as "from the start".
- **Unauthorized ids.** Another person's ids read nothing, whether direct or through actions.
- **No leakage.** A customer's slice never holds another person's records or private fields.
- **Search.** Best Fit, Soonest Strong Fit, order, reasons and "remove this filter" counts are identical to the whole-store path for 11 searches.
- **Matching, counts, demand and review hand-off** are identical to the whole-store path.
- **Two app instances.** Two independent instances race to a single booking, and the next request on either reads the result fresh.
- **Delivery worker.** It claims bounded batches and finds accounts in either live store.

**Query plans.** All 763 distinct queries were run through `EXPLAIN` against the loaded, analyzed data:

- No query does a sequential scan of any table over 5,000 rows.
- With sequential scans disabled, every query has an index path, including on smaller tables.
- Three staff tallies count whole tables by design (queue tiles, support tiles, total profiles). They are listed, and they run only on staff pages.

## Rollback

- `CLUTCH_LIVE_READS=snapshot` goes back to the whole-marketplace cache on the normalized tables. It is the explicit rollback and diagnostic path, logs a warning, and is never the default. The same write guarantees hold; `tests-db/normalized*.test.ts` runs the suite in both modes.
- To leave the normalized store entirely, see "Migrating and rolling back" in the README (`--export-snapshot`, then unset `CLUTCH_LIVE_STORE`).

## Before switching `CLUTCH_LIVE_STORE=normalized` on

1. `npm test`, `npm run test:db`, `npm run lint`, `npx tsc --noEmit`, `npm run build` all pass.
2. Dry-run, then `--apply`, `scripts/migrate-live.ts` against the production database. Apply again right before switching.
3. On a large production database, create the 0006 indexes with `CREATE INDEX CONCURRENTLY` first. The app's boot-time `create index if not exists` then does nothing.
4. Set `CLUTCH_LIVE_STORE=normalized` on **every** instance, and on the delivery worker, at the same time. Leave `CLUTCH_LIVE_READS` unset.
5. `AUTH_SECRET` is set. Under the 2026-09-26 policy (pending legal review) mechanics are bookable with a complete profile; unverified ones only after the customer's acknowledgement, in either store.

## Known limits

- **Soft 404s.** The customer and mechanic areas stream (`loading.tsx`), so another person's id gets Next.js's soft 404: the not-found page with a `noindex` tag, but HTTP status 200 (documented Next.js behavior).
- **Per-mechanic evidence.** A single mechanic's evidence is read in full wherever their profile is built, because reputation counts need all of it. That cost grows with one mechanic's history, not with the marketplace.
- **Search grows with supply.** Every bookable mechanic is a candidate, so search reads one small stats row (and check records) per bookable mechanic. At 1,224 bookable that's 98 ms locally; a load test with 24 concurrent operations has search p95 around 0.7 s on a laptop and 2.5 s on a 2-core CI runner. A geographic prefilter is the next step if supply grows by an order of magnitude.
- **Capped lists.** Owner lists used for badges and counts read at most 500 rows (`OWNER_MAX`). Demand looks at the 500 oldest open requests. Matching after a mechanic becomes bookable handles the 200 oldest waiting requests per write.
