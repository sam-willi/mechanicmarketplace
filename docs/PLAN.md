# Clutch — MVP plan

> Product truth lives in [PRODUCT.md](../PRODUCT.md). This document covers the build: what exists, how it fits together, and what's real versus mocked.

## 1. Thesis

**Mechanics should own proof of their skill.** Clutch gives every independent mechanic a portable public profile where each claim shows its source, and repair experience is counted per repair type and per vehicle make instead of being flattened into stars. Customers hire based on evidence relevant to *their* car and *their* repair, and every completed job adds to reputation the mechanic takes with them.

## 2. Differentiation

| Others | Clutch |
|---|---|
| Stars and "years of experience" | "18 verified brake jobs · 6 on BMW", contextual to the request |
| Background check = "trusted" | Safety screening and skill proof are **separate systems** with separate visuals |
| Claims are all equal | Every claim carries provenance; self-reported claims are visibly weaker |
| Platform sets price or runs a lowest-bid auction | Mechanic sets rate, diagnostic fee, travel fee and fixed prices; no price ranking |
| Platform owns the customer | Mechanic has a customer list; customers save and rebook the same mechanic |
| Profile only exists inside the marketplace | Public URL works from a text, Nextdoor or Instagram, no account needed |
| Opaque trust score | No score; badges open a plain-language explanation of their source |

## 3. Jobs to be done

**Customer:** "When my car needs a repair and I've found a mechanic I don't know, help me check, in under a minute on my phone, that they're real, safe, have done this repair on this kind of car, and what they'll charge, so I can hand over my keys without gambling."

**Mechanic:** "When I leave the shop to work for myself, help me prove my skill to strangers with evidence I own, so I can charge my own rate and build a customer base that comes back to me."

**Admin:** "Review submitted evidence quickly and leave an audit trail of who approved what, when, how, and until when."

## 4. Page map

**Public (no account)**

| Route | Purpose |
|---|---|
| `/` | Homepage: value proposition, a live example of the evidence, the two CTAs |
| `/mechanics` | Find a mechanic: filter by repair and make; results ranked by relevant verified evidence |
| `/mechanics/[slug]` | **Public profile.** Optional `?repair=brakes&make=BMW` makes the whole page contextual |
| `/verification` | How verification works: every source and status explained |
| `/confirm/[token]` | Prior customer confirms "Yes, this mechanic did this repair" |
| `/request` | Customer repair request (vehicle, problem, location, timing) |

**Mechanic workspace** (`/mechanic`)

| Route | Purpose |
|---|---|
| `/mechanic` | Overview: profile views, shares, requests, quotes accepted, verified jobs and reviews, repeat customers, estimated earnings |
| `/mechanic/onboarding` | Profile setup: basics → work model → pricing → specialties → credentials → employment → insurance |
| `/mechanic/verification` | **Verification Center**: safety and skill tracks, status, expiry, resubmit |
| `/mechanic/repairs` | Past repair log: add a self-reported repair, request customer confirmation |
| `/mechanic/requests` · `/mechanic/requests/[id]` | Incoming requests: decline, ask a question, or quote |
| `/mechanic/jobs` | Upcoming and completed jobs; mark complete |
| `/mechanic/customers` | Book of business: customers, repeat customers, last repair, vehicle |
| `/mechanic/pricing` | Rates, fees, fixed prices |

**Customer** (`/account`)

| Route | Purpose |
|---|---|
| `/account` | Vehicles, requests, upcoming and past repairs, saved mechanics, rebook |
| `/account/requests/[id]` | **Quote comparison**, evidence-first |
| `/account/quotes/[id]` | Written estimate, approve |
| `/account/jobs/[id]` | Job record and verified review |

**Admin** (`/admin`)

| Route | Purpose |
|---|---|
| `/admin` | Review queue by category and status |
| `/admin/reviews/[id]` | Evidence detail: approve, reject, or request more information, with notes and expiry |

Auth is mocked for the MVP: a persona switcher (Derek the mechanic, Maya the customer, an admin reviewer) stands in for Supabase Auth.

## 5. Core user flows

1. **Shared-link trust check (the main flow).** A text message leads to `/mechanics/derek-hall` on a phone. The first screen answers who, safe, done my repair, my car, evidence, and price. Tapping a badge opens a sheet explaining its source. The customer requests a quote.
2. **Mechanic builds a credible profile.** Onboarding creates a public profile immediately. Everything starts Self-Reported or Not Submitted. The Verification Center shows the two tracks (Safety, Skill) and what each unlocks. The mechanic submits evidence and shares the profile.
3. **Screening (mocked vendors).** The mechanic starts an identity check (ID plus selfie) and consents to a background check. The mock provider returns a result through the provider interface. It's stored privately, and only the outcome status is published.
4. **Past repair → Customer Verified (or Document Verified).** A repair backed only by an invoice a reviewer approves becomes Document Verified; a customer's own confirmation makes it Customer Verified. The mechanic logs a prior repair (shown as Self-Reported) and sends a confirmation link. The prior customer opens `/confirm/[token]` and confirms, and the repair becomes Customer Verified, with counts updating.
5. **Admin review.** The admin opens the queue, inspects evidence, and approves, rejects or requests info. A `verification_records` row stores method, reviewer, timestamp, notes and expiry.
6. **Request → quote → compare → estimate.** The customer posts a request, and matched mechanics see it. A mechanic quotes their own price. The customer compares evidence-first cards and approves a written estimate.
7. **Completion compounds.** The mechanic marks a job complete. A Platform Verified repair entry is created, category, make, repeat-customer and rating stats update, and the customer leaves a verified review.
8. **Rebook.** The customer saves the mechanic and rebooks from their history. The job counts as a repeat booking.

## 6. Verification architecture

Two systems, one shared record format.

```
                ┌──────────── SAFETY (baseline) ────────────┐   ┌──────────── SKILL (the differentiator) ────────────┐
 subjects:      identity  background  driving_record insurance     credential  employment   past_repair   job
 method:        vendor    vendor      vendor         document      institution employer     customer      platform
                                                                    / document  / document  / document
                         │                                                     │
                         ▼                                                     ▼
            ScreeningProvider interface                         Manual admin review / customer confirmation
            (IdentityProvider, BackgroundCheckProvider,          / automatic on job completion
             DrivingRecordProvider)
            mock impl today → Persona / Stripe Identity /
            Jumio / Checkr adapters later
                         │                                                     │
                         └───────────────► verification_records ◄──────────────┘
                                   (subject_type, subject_id, category, method,
                                    provider, provider_ref, status, verified_at,
                                    expires_at, reviewer_id, notes)
                                                  │
                                    toPublicProfile() projection
                                   (outcome statuses only, never raw data)
```

- **Provider registry.** `lib/verification/providers/` defines `IdentityProvider`, `BackgroundCheckProvider` and `DrivingRecordProvider` interfaces (`startCheck`, `getResult`, `parseWebhook`). `getProvider(kind)` reads config, and today every kind resolves to a `Mock…Provider`. The mechanic model never names a vendor. Vendor identity lives only on `screening_checks.provider` and `provider_ref`.
- **Sensitive data boundary.** Raw screening data (report IDs, adjudication, document references) lives in `screening_checks`, which is never selected by public queries. Public pages receive a `PublicMechanicProfile` type, built by one projection function that emits only `{ kind, status, verifiedAt, expiresAt }`. In Supabase this becomes RLS: `screening_checks` readable by the owner and admins only, plus a `public_mechanic_profiles` view.
- **Lifecycle.** Status set: `not_submitted | pending | verified | rejected | needs_info | expired | reverification_required`. `effectiveStatus()` derives `expired` from `expires_at` at read time, and records nearing expiry are flagged `reverification_required` 30 days out. Screenings re-run on a cadence (annual background check, credential expiry dates).
- **Evidence ladder.** Every claim on the public profile carries exactly one provenance label.

## 7. Trust hierarchy

What the customer sees, in priority order. The profile follows this order top to bottom.

1. **Identity** — is this person who they say they are? *Identity Verified* (vendor ID + selfie).
2. **Safety** — are they safe to let near my car and home? *Background Check Passed*, *Driving Record Check Passed*, *Insurance Verified*. Shown as one compact "Screened" line, because it's the baseline, not the pitch.
3. **Relevant proof** — have they done my repair on my car? Count per repair category and per make, crossed when context is known ("18 brake jobs · 6 on BMW").
4. **Credentials** — certifications and employment, each with its source.
5. **Outcomes** — verified rating (only from verified-repair reviews), per-dimension scores, repeat customers.
6. **Price** — rate, diagnostic fee, travel fee, fixed prices. Clear, never ranked.
7. **Self-reported** — bio, unverified claims, testimonials. Present but visibly quieter and labeled.

**Provenance strength** (used for styling weight, never combined into a score):

| Label | Meaning | Visual weight |
|---|---|---|
| Platform Verified | Booked and completed through Clutch | Strongest |
| Institution Verified | Confirmed with the issuing body | Strong |
| Employer Verified | Confirmed with the employer | Strong |
| Customer Verified | A prior customer independently confirmed it | Strong |
| Document Verified | Clutch reviewed a submitted document | Moderate |
| Self-Reported | Entered by the mechanic, not checked | Deliberately muted, dashed, never green |

## 8. Mechanic profile content hierarchy

Mobile first, as it's opened from a text message.

```
┌─────────────────────────────────────┐
│ Clutch                     [Share]  │
├─────────────────────────────────────┤
│ [photo] Derek Hall                  │
│         Mobile mechanic · Los Angeles│
│         Comes to you within 15 mi   │
│                                     │
│ ✓ Identity verified                 │  ← WHO
│ ✓ Screened: background · driving ·  │  ← SAFE (one line, tappable)
│   insurance                         │
│                                     │
│ ┌ For your BMW brakes ────────────┐ │  ← only with ?repair&make
│ │ 18 verified brake jobs          │ │
│ │  6 on BMW                        │ │
│ └──────────────────────────────────┘│
│ 34 verified repairs · 4.9 from 27   │  ← PROOF + OUTCOME
│ verified reviews · 12 repeat        │
│                                     │
│ $85/hr · $60 diagnostic             │  ← PRICE
│ [ Request a quote ]                 │
├─────────────────────────────────────┤
│ Repair record  (the ledger)         │  per-category rows, count bar,
│   Brakes         18  ▮▮▮▮▮▮▮▮▮      │  expandable to jobs, BMW/Honda…
│   Starters        6                 │  cross-filter by make
│   …                                 │
│ Vehicles worked on                  │
├─────────────────────────────────────┤
│ Recent verified work                │  car · repair · month · source
├─────────────────────────────────────┤
│ Credentials & employment            │  each with provenance chip + dates
├─────────────────────────────────────┤
│ Reviews (verified only in rating)   │  dimension scores; testimonials
│                                     │  separated and labeled
├─────────────────────────────────────┤
│ Pricing & service area              │
├─────────────────────────────────────┤
│ Self-reported by Derek              │  bio + claims, visibly quieter
└─────────────────────────────────────┘
 Sticky bottom bar on mobile: $85/hr · [Request a quote]
```

**Above-the-fold trust signals (exact):** name and photo, work model and area, Identity Verified, the Screened line (Background Check Passed · Driving Record Check Passed · Insurance Verified), the contextual match block when the link carries a repair and make, the total verified repair count, the verified rating with its review count, the repeat customer count, the labor rate and diagnostic fee, and Request a quote.

**UX changes recommended beyond the brief**

1. **Contextual profile links.** Quotes and search results link to `/mechanics/derek-hall?repair=brakes&make=BMW`, and the profile re-orders itself to lead with that evidence. Mechanics can generate these links for a specific lead ("send this to the guy with the Civic").
2. **Split "safety" from "skill" visually**, with two different visual treatments, so a background check can never read as competence.
3. **Rating always shows its base:** "4.9 from 27 verified reviews", never a bare 4.9.
4. **Every count opens its list.** Tapping "18 brake jobs" shows the 18 entries with car, month and source. Counts are never unsupported.
5. **Self-reported sits in its own section, in the mechanic's voice** ("Derek says…"), so it's honest, not hidden.
6. **Expiry is shown publicly as "verified Mar 2026 · valid to Mar 2027"**, making freshness part of the trust story.

## 9. Data model

Typed domain models in `lib/domain/types.ts` follow the original relational design in `supabase/migrations/0001_init.sql` (reference only, never applied; the live normalized schema is `0004_live_normalized.sql`).

```
users(id, role[customer|mechanic|admin], email, created_at)
mechanic_profiles(id, user_id, slug, display_name, photo_url, city, lat, lng, service_radius_mi,
  bio, work_model[mobile|shop|both], shop_address, hourly_rate_cents, diagnostic_fee_cents,
  travel_fee_cents, availability_note, joined_at, is_demo)
fixed_prices(id, mechanic_id, repair_category, label, labor_cents)
customer_profiles(id, user_id, display_name, city)
vehicles(id, customer_id, year, make, model, trim, mileage)

-- Safety (private)
screening_checks(id, mechanic_id, kind[identity|background|driving_record], provider, provider_ref,
  status, result[clear|consider|failed|null], completed_at, expires_at, consent_at)   -- RLS: owner+admin
insurance_records(id, mechanic_id, carrier, policy_number_last4, coverage_cents, document_path,
  effective_on, expires_on)                                                          -- RLS: owner+admin

-- Skill
credentials(id, mechanic_id, issuer, name, code, credential_number_last4, issued_on, expires_on, document_path)
employment_history(id, mechanic_id, employer, position, started_on, ended_on, employer_contact, document_path)
mechanic_repair_specialties(mechanic_id, repair_category)            -- declared (self-reported)
mechanic_vehicle_specialties(mechanic_id, make)                      -- declared (self-reported)
past_repairs(id, mechanic_id, source[self|customer_confirmed|document|platform], job_id, year, make, model,
  repair_category, description, performed_on)
repair_evidence(id, past_repair_id, kind[photo|invoice|document], path)
customer_confirmations(id, past_repair_id, token, contact, sent_at, responded_at, response[confirmed|denied])

-- Unified verification ledger
verification_records(id, subject_type, subject_id, mechanic_id, category, method, provider,
  status, submitted_at, verified_at, expires_at, reviewer_id, notes)

-- Marketplace
repair_requests(id, customer_id, vehicle_id, repair_category, description, diagnosis, obd_code,
  media_paths[], location_text, mobile_required, preferred_window, status)
quotes(id, request_id, mechanic_id, labor_cents, diagnostic_fee_cents, travel_fee_cents,
  parts_included, parts_estimate_cents, duration_hours, available_on, service_mode, scope, notes, status)
jobs(id, quote_id, mechanic_id, customer_id, vehicle_id, repair_category, status, scheduled_for, completed_at)
reviews(id, mechanic_id, kind[verified_job|customer_confirmed|testimonial], job_id, past_repair_id,
  overall, communication, timeliness, price_accuracy, workmanship, comment, author_name, created_at)
saved_mechanics(customer_id, mechanic_id, saved_at)
customer_mechanic_relationships(customer_id, mechanic_id, first_job_at, last_job_at, job_count)
analytics_events(id, name, mechanic_id, actor_id, session_id, variant, props jsonb, created_at)
```

Derived, never stored by hand: per-category counts, per-make counts, the category × make cross-count, verified rating, and repeat customers (relationships with `job_count ≥ 2`). They're computed from `past_repairs` (verified sources only) and `reviews` (kind `verified_job` only), so completed work compounds automatically.

## 10. Component architecture

```
lib/
  domain/types.ts            domain + enums (ProvenanceSource, VerificationStatus…)
  domain/reputation.ts       counts, cross-counts, rating, repeat customers (pure)
  domain/provenance.ts       labels, explanations, strength
  domain/public-profile.ts   toPublicProfile() — the only path to public pages
  verification/providers/    interfaces + mock providers + registry
  verification/lifecycle.ts  effectiveStatus(), expiry, reverification
  data/repository.ts         Repository interface
  data/mock/                 seed + in-memory implementation
  analytics.ts               track(event, props, variant)
  experiment.ts              evidence variant (high|low) from cookie/query
components/
  trust/ProvenanceMark       the single provenance chip used everywhere
  trust/ProvenanceSheet      explanation sheet opened by any mark
  trust/SafetyLine           compact screening statuses
  trust/RepairLedger         category rows with counts, expandable
  trust/MakeLedger / ContextMatch
  trust/EvidenceItem         one verified repair row
  profile/ProfileHeader, ProfilePricing, ProfileReviews, SelfReported, ShareButton
  marketplace/QuoteCard, EstimateSheet, RequestForm
  workspace/StatusPill, VerificationTrack, ReviewQueue
```

**Trust experiment:** the profile renders from `PublicMechanicProfile` with `variant: "high" | "low"`. The low variant shows only the bio, stars and self-reported experience. It's assigned by cookie (overridable with `?variant=`) and tagged on every analytics event.

## 11. Mocked versus functional

| Area | MVP |
|---|---|
| Public profile, contextual links, share, provenance sheets | **Functional** |
| Reputation math (counts, cross-counts, verified rating, repeat) | **Functional**, derived live |
| Verification Center, admin queue, approve/reject/needs info, expiry | **Functional** (manual review, audit fields stored) |
| Past repair → customer confirmation link → Customer Verified | **Functional** (link shown in-app instead of SMS/email) |
| Request → quote → compare → estimate → complete → review → rebook | **Functional, plainer UI** |
| Analytics events | **Functional** (in-memory store + console; `track()` interface ready for a sink) |
| Identity, background and driving record checks | **Mocked** behind provider interfaces; mock returns results after a simulated delay |
| Insurance | Document upload + manual review (no insurer API) |
| Auth | **Mocked** persona switcher; Supabase Auth later |
| Persistence | **In-memory repository** seeded on boot (resets on restart); the Supabase schema ships as a migration for the swap |
| File uploads, SMS/email, payments, maps | **Not built**; file names captured, links shown on screen |

## 12. MVP scope and build order

**Tier 1 — must be exceptional**
1. Domain, reputation math, provenance, public projection, seed (Derek plus 7 fictional LA mechanics with varied completeness).
2. Public mechanic profile (mobile first), provenance sheets, contextual mode, share, the low-evidence variant.
3. Homepage and `/verification`.
4. Mechanic Verification Center, admin review queue, past repairs and customer confirmation.
5. Find-a-mechanic results ranked by relevant evidence.

**Tier 2 — working, plainer**
6. Mechanic onboarding.
7. Repair request, mechanic quote, quote comparison, estimate approval, completion, review, rebook.
8. Mechanic overview, customers list and pricing, plus the customer dashboard.

**Not in the MVP:** payments, live vendor integrations, background-check adjudication workflows, AI, parts, GPS, warranties, disputes, chat, native apps.

## 13. Changes made during the build

- **Document-verified past repairs:** a prior repair backed by an invoice or work order that a reviewer approved counts as verified with the `document` source. Only a customer's own confirmation makes it Customer Verified.
- **Numbered records:** every profile has a record number (`CL-xxxx`), and every verified repair has a job number (oldest = No. 001). Job numbers print on the work list and are cited in the evidence sheet.
- **Dates:** "today" is computed in the launch market's timezone (America/Los_Angeles).

### Auth and persistence (MVP launch)

- **Auth:** Supabase Auth. Email + password with email confirmation and password reset, and Google. `proxy.ts` refreshes sessions; `lib/session.ts` verifies claims and maps the auth user to the Clutch account (same id). The account is created on first sign-in from sign-up metadata (name, role, phone, optional car) or, for Google, after the person picks a role at `/welcome`. Staff get the reviewer role through `CLUTCH_ADMIN_EMAILS`. Seeded demo accounts remain as a separate, clearly labelled, passwordless path (`CLUTCH_DEMO_LOGINS`).
- **Persistence:** `lib/data/store.ts` keeps every record in Postgres (`app_records`, jsonb) and runs the existing domain logic against a snapshot. Each write is one transaction guarded by `app_meta.version`; a concurrent commit from another instance triggers a reload and a retry, so writes never apply to stale data. Analytics go to `app_events`, uploads to `app_media`. Reads call `ready()` first, which reloads only when the version has moved.
- **Next step as data grows:** the normalized live schema (`0004_live_normalized.sql`, with targeted reads) is built and behind a flag; see `docs/live-reads.md`. Move uploads to object storage.

### Product audit pass

- **One eligibility rule** (`lib/domain/eligibility.ts`): since the 2026-09-26 policy (needs legal review before launch), a complete basic profile (service area, repairs, pricing, availability) is what lets a mechanic be matched, quote and be booked. The four verification checks (ID, background, driving record when mobile, insurance) are shown separately everywhere with exact statuses, rank fully verified mechanics higher at equal experience, and need a recorded customer acknowledgement before booking a mechanic who isn't fully verified (`lib/domain/disclosure.ts`).
- **Recommendations** (`lib/domain/recommend.ts`): Best Fit and Soonest Strong Fit are separately defined; one mechanic winning both is labelled as such; the tradeoff between two different picks compares the same measure for both.
- **Site feasibility** (`lib/domain/site.ts`): one normalized reading of where the car is, with each fact classified as fine, missing, unsure, a risk, or a blocker, and contradictions surfaced as "confirm before quoting".
- **Quote readiness** (`lib/domain/readiness.ts`): the same "enough to quote?" rules for mechanics (opportunities) and customers (before sending a request).
- **Job lifecycle** (`lib/domain/lifecycle.ts`): ten stages including diagnosis and extra-work approval, with who is waiting on whom, the next action, the notification it sends and what becomes public.
- **Estimates** carry line items, expiry, assumptions, exclusions and alternate outcomes; `lib/domain/quote.ts` totals them the same way everywhere.

### Vehicle identification

- **Data:** `VehicleDataProvider` (`lib/vehicles/provider.ts`). Model lists and VIN decoding come from NHTSA vPIC (cached; falls back to the catalog if unreachable). Factory configurations (platform, engine, transmission, drivetrain, body) come from a curated US-market catalog (`lib/vehicles/catalog.ts`) covering the launch data's models. A licensed YMMT provider can replace both behind the same interface. Models outside the catalog fall back to generic choices; nothing is guessed.
- **Every attribute has a status:** VIN confirmed, customer selected, likely configuration (only one factory option), needs confirmation, customer's description, mechanic confirmed, not recorded. The server rebuilds specs from the customer's choices; it never trusts a client-built spec.
- **History:** completed jobs record platform, and engine/transmission only when confirmed (VIN, customer selection, or the mechanic at completion). Older records aren't backfilled. Matching and explanations use the most specific verified evidence and never claim engine or transmission experience a record doesn't show.
- **Privacy:** the full VIN is stored on the vehicle and shown to the owner and the booked mechanic only; others see the last six characters.
