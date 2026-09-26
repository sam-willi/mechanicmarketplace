# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js, TypeScript, Tailwind CSS, Supabase (Auth + Postgres), deployed on Vercel. The MVP may start on strongly typed mock data behind repository abstractions if live Supabase setup would slow the first build; migration to Supabase must stay straightforward.

## Users

Two-sided, both first-class:

- **Independent mechanics** who can do the work but struggle to go independent. Strangers can't tell whether to trust them, they have no easy way to prove their skill, and their reputation usually belongs to the shop or dealership they worked for. Their job is to prove their competence, set their own price, and build their own book of business with a steady stream of customers.
- **Car owners (customers)** who need a repair and want to know who they're hiring before handing over their keys. They often arrive at a mechanic's profile from a text message, a referral, or a social or classifieds post (Facebook, Nextdoor, Craigslist, Instagram) rather than through the marketplace.
- **Admin (internal)**: manually reviews verification evidence for the MVP.

## Product Structure

**One network, two products, one account.**
- **Customer Clutch** ("Find someone you trust to fix your car"): simple, reassuring, low cognitive load. Home, Find Mechanics, My Requests, Quotes, My Repairs, Saved Mechanics, My Vehicles, Account. It holds no mechanic-business features.
- **Mechanic Clutch** ("Build your independent mechanic business"): operational and information-dense. Home, Job Opportunities, Quotes, My Jobs, Customers, Reputation, Verification, Earnings, Public Profile, Settings.
- **One login can hold both roles.** Sign-up asks "How do you want to use Clutch?". The account menu switches between Customer and Mechanic mode. Role-specific data lives on customer and mechanic profiles, never on the shared user.
- **Public mechanic profiles** at `/mechanics/[slug]` sit outside both apps and never need a login.
- **Jobs complete in two steps.** The mechanic marks the job complete, then the customer confirms. Only the confirmation creates the Platform Verified repair.
- **Mechanics can sign up and explore first.** Identity, background and insurance (plus driving record for mobile work) are required before they can send estimates for real work.

## Product Purpose

A mechanic-first marketplace and portable reputation platform. Thesis: **"Mechanics should own proof of their skill."** A mechanic gets a portable public profile that shows, with evidence, who they are, which certifications they hold, where they've worked, which repairs and vehicle makes they've worked on, how customers rated real completed repairs, whether they're insured, what they charge, and whether customers come back.

MVP hypothesis to test: **"Does verified evidence of competence make customers more willing to hire an independent mechanic?"** Everything should support answering it.

Success means:
1. A mechanic can create a credible public professional profile.
2. Important claims show their verification source.
3. Customers can see experience specific to the repair and to the vehicle make.
4. Mechanics set their own rates.
5. Mechanics can receive requests and quote jobs.
6. Customers can choose on evidence, not only on cost.
7. Completed jobs strengthen the mechanic's reputation.
8. Mechanics build up repeat customers.
9. The profile can be shared outside the marketplace.
10. The architecture can test whether verification increases booking intent.

## Positioning

The trust and reputation layer is the wedge, and the marketplace comes second. This is not "Uber for mechanics", and not Yelp, Thumbtack, YourMechanic or Wrenchr. Those act as heavy middlemen, control pricing or the customer relationship, or rely on self-reported experience and generic star ratings.

What sets it apart:
- **Repair-specific reputation:** "23 verified brake repairs" and "8 verified BMW repairs" rather than "4.9 stars" or "4 years experience". Reputation is contextual to the job, so a BMW brake request surfaces BMW and brake evidence.
- **Verified claims with visible source:** every important claim shows how it was verified. Self-reported claims are never presented as equal to verified ones.
- **Portable reputation:** a public profile URL (e.g. `/mechanics/derek-hall`) that works from any source without the customer creating an account.
- **Mechanic-controlled pricing:** no lowest-bid auction and no ranking by price.
- **Mechanic owns the customer relationship:** saved mechanics, rebooking, and the mechanic's own customer list.

## Operating Context

- Customers often open profiles on a phone from a text message, so the mobile profile experience is critical.
- Mechanics may work mobile, at a shop, or both; this is set per mechanic.
- For the MVP, verification is manual through an admin dashboard. Confirmation links to prior customers can be sent or simulated.
- Estimates are approved in-app. There is no real payment processing in the MVP.

## Capabilities and Constraints

**Verification sources** (shown on claims): Platform Verified, Institution Verified, Employer Verified, Customer Verified, Document Verified, Self-Reported. Every badge is clickable and explains, in plain language, what that source means.

**Verification statuses** (Verification Center, admin): Not Submitted, Pending, Verified, Rejected, Needs More Information, Expired. Categories: Identity, Background Check, Certification, Employment, Insurance, Previous Repairs. Records store subject type and ID, method, status, reviewer, verified_at, expires_at, and notes.

**Verification model: follow the gig and marketplace norm (Uber, DoorDash, Instacart, Airbnb).** Mechanics go through the same kind of screening those platforms use for their providers:
- **Identity:** a photo of a government-issued ID plus a live selfie matched against it, checked through a third-party identity provider such as Persona, Stripe Identity or Jumio.
- **Background check:** run through a consumer reporting agency such as Checkr, with FCRA-compliant disclosure and consent captured in onboarding. It covers criminal records (county, state and national) and a sex offender registry search. A motor vehicle record check applies to mechanics who test-drive customer cars or work mobile.
- **Insurance:** an uploaded proof-of-insurance document, reviewed by the platform, with an expiration date that sets the record to Expired when it lapses.
- **Ongoing monitoring:** periodic re-screening and expiry of time-limited documents, as those platforms do.

Those platforms verify who someone is and whether they're safe, not whether they're skilled. Clutch's competence checks go beyond that: certifications are Document or Institution Verified, employment is Employer Verified, and repairs are Customer or Platform Verified.

For the MVP, identity and background checks run behind a provider-agnostic adapter with a mock implementation that simulates vendor results and statuses. The admin still reviews everything manually, and the real vendor integrations come later. Background-check results are never shown publicly in detail; the public profile shows only a pass/verified signal.

**Past repairs** start as Self-Reported. They become Customer Verified when the prior customer confirms through a link. Jobs completed on the platform become Platform Verified automatically.

**Reviews:** verified repair reviews (tied to a platform job), customer-verified reviews of prior repairs, and unverified testimonials. Only verified repair reviews count toward the primary rating. Review dimensions are overall, communication, timeliness, price accuracy, workmanship, and a comment.

**Pricing:** mechanics set an hourly labor rate, a diagnostic fee, an optional travel fee, fixed labor prices for common repairs, and custom quotes. Price is one factor among relevant experience, verified jobs, rating, certifications, availability and distance.

**Repair intake:** the customer describes evidence, Clutch structures it, the mechanic interprets it and makes the diagnosis. The intake asks "What is your car doing?", never which part failed. It answers three questions for the mechanic: what exact vehicle this is, what it's actually doing, and whether the repair can realistically happen where the car is. Diagnostic codes, the customer's suspected issue and another shop's opinion are always labelled as such and never presented as a diagnosis. The address and access details stay private until the customer books a mechanic. Mechanics can ask questions before quoting, and customers can reply with photos, video or audio.

**Marketplace model:** customers post jobs, qualified mechanics choose whether to respond, mechanics set their own estimate, and customers choose their mechanic. Clutch never decides who is "best"; it supplies evidence.
- **Find a mechanic** (customer roughly knows the job, e.g. BMW → Brakes → Los Angeles): results are ordered by relevant verified repair experience, then make and model experience, availability, distance, reputation, and price last. Never primarily by price. A quote requested from a profile goes to that mechanic only.
- **Post a repair request** (customer unsure who to choose): the request goes to a small set of qualified mechanics (identity verified, serving the area, with relevant verified or declared experience). Each can decline, ask a question, say they're interested, or send an estimate. Mechanics never see each other's estimates. There is no live auction and nothing encourages undercutting.
- **Shortlist:** the customer sees everyone interested or quoting, with trust and relevant experience leading each card, the mechanic's own notes, and a side-by-side table of facts so the trade-off between price and experience is visible without a winner being picked.
- **Language:** quote, estimate, "interested in this job", "available to help". Never bid, lowest bid or winning bid.

**Core surfaces:**
- public homepage
- public mechanic profile (the most important screen)
- mechanic onboarding
- mechanic dashboard with Verification Center
- customer repair request
- quote flow and quote comparison
- written estimates
- job completion that creates repair history and updates stats
- reviews
- customer dashboard
- admin dashboard

**Analytics events:** profile_view, profile_share, verification_badge_clicked, repair_request_started, repair_request_completed, quote_requested, quote_viewed, mechanic_selected, repeat_booking, review_submitted.

**Trust experiment:** components must be able to render a low-evidence profile (bio, stars, self-reported experience) or a high-evidence profile, to support a future A/B test.

**Explicit prohibitions:**
- no arbitrary 0–100 trust score; show evidence instead
- no lowest-bid auction
- no gamification
- no fake AI features

**Out of scope for the MVP:**
- Stripe payments
- live integrations with ASE, insurers, or identity and background-check vendors (the flows and adapters are in scope, backed by mocks)
- AI diagnosis
- parts purchasing
- OEM diagnostic software
- GPS tracking
- tow trucks
- platform-backed warranties
- complex disputes
- native apps
- complex chat

**Launch market:** Los Angeles.

**Undecided:**
- which identity and background-check vendors to use
- the exact screening criteria, meaning which background-check results disqualify a mechanic

## Brand Commitments

- **Name:** Clutch.
- **Voice:** the product should feel trustworthy, serious and mechanic-first. Transparency matters more than a mysterious proprietary score.
- **Candidate copy:**
  - headline: "Find independent mechanics you can actually verify."
  - supporting text: "See verified certifications, repair history, experience, pricing, and reviews before handing someone your keys."
  - CTAs: "Find a Mechanic" and "Build Your Mechanic Profile"
  - customer value proposition: "Know who you are hiring."
  - mechanic value proposition: "Set your price. Prove your experience. Build your own customer base."
- **References given by the user:** Stripe, Airbnb, Linear, Carfax.
- **Must not feel like:** Craigslist, a cheap gig marketplace, a generic SaaS template, or a racing or car-enthusiast site.
- **User-named exclusions:** excessive gradients, neon automotive aesthetics, cartoon cars, and giant rounded UI everywhere.

## Evidence on Hand

- There is no logo, real mechanics, reviews, customers, or photography.
- All seed data is fictional and must read as demo data. The primary demo mechanic is Derek Hall:
  - Los Angeles, independent mobile mechanic, $85/hr
  - ASE, Identity and Insurance Verified
  - 34 verified repairs: 18 brakes, 6 starters, 5 suspension, 5 diagnostics
  - by make: 8 BMW, 9 Honda, 7 Toyota, 5 Ford, 5 other
  - 4.9 verified rating, 12 repeat customers
- Plus 6–8 fictional mechanics that vary in pricing, experience, certifications, verification completeness, specialties and ratings. Some carry clearly marked self-reported claims.
- Photography uses professional placeholders. Never fabricate real testimonials, customers, partners, certification bodies' endorsements, or statistics.

## Product Principles

Tradeoff order, in this sequence: trust, mechanic ownership, portable reputation, evidence, customer conversion, then marketplace functionality. In the marketplace itself: trust over lowest price, relevant experience over generic rating, customer choice over platform assignment, mechanic pricing control over platform-set pricing. When one surface has to be weaker, the marketplace flow gives way before the mechanic profile.

1. **Safety screening and skill verification are separate systems.** Identity, background, driving record and insurance are the baseline safety layer. Competence is proven separately through certifications, employment and repair evidence. A mechanic can pass screening without being proven competent, and the UI never blurs the two.
2. **Repair-specific proof is the core differentiator.** "18 verified brake jobs, including 6 BMWs" matters more than a generic "4.9 stars". Surface experience relevant to this repair on this make first.
3. **Every claim has provenance.** Each claim is Platform, Institution, Employer, Customer or Document Verified, or Self-Reported, and that is always visible. Self-reported claims are never presented as equal to verified ones.
4. **Never expose sensitive screening information.** Public profiles show only outcome statuses: Identity Verified, Background Check Passed, Driving Record Check Passed, Insurance Verified. ID, criminal, driving and insurance documents never appear publicly.
5. **Expiration and re-verification are built in.** Credentials, insurance and screenings carry a verified date, an expiration date and a status (Pending, Verified, Expired, Reverification Required, and so on).
6. **Mechanics own their reputation.** The profile stays useful outside the marketplace and is easy to share by text, on social media or through referrals.
7. **Not a lowest-bid marketplace.** Mechanics set their prices, and customers compare price alongside relevant verified experience.
8. **Completed work compounds reputation automatically.** Every completed Clutch job adds to the mechanic's repair-category history, vehicle-make history, verified reviews and repeat-customer history.
9. **Trust is legible within seconds.** A nervous customer on a profile quickly understands: is this person who they say they are, are they safe to hire, have they done my kind of repair on my kind of car, what evidence supports that, and what do they charge.
10. **Vendors are swappable and mocked for now.** Persona, Stripe Identity, Jumio and Checkr sit behind provider interfaces. No vendor is hard-coded into the mechanic model, and nothing is live in the MVP.
