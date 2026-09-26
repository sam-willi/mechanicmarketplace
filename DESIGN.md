---
name: Clutch
description: Independent mechanics you can verify, kept like a car's service logbook.
colors:
  paper: "#f4f1e8"
  sheet: "#fdfbf6"
  ink: "#141a26"
  ink-2: "#414857"
  ink-3: "#5a6171"
  rule: "#bcc2cc"
  rule-soft: "#dee1e7"
  brand: "#1f3a5f"
  brand-deep: "#172c4a"
  brand-night: "#0f1c30"
  brand-wash: "#e4e9f1"
  brand-tint: "#c9d3e2"
  on-brand: "#fdfbf6"
  on-brand-2: "#bfcadc"
  brass: "#c9973a"
  brass-wash: "#f4e7c8"
  carbon: "#3d3fc4"
  carbon-deep: "#2c2e9c"
  carbon-wash: "#e8e9fb"
  canary: "#f2da5c"
  canary-wash: "#fbf1b8"
  pencil: "#5e6470"
  alert: "#b3261e"
  alert-wash: "#f8e2df"
  amber: "#7d5200"
  amber-wash: "#fbecc9"
typography:
  display:
    fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2rem, 6vw, 3rem)"
    fontWeight: 800
    lineHeight: 0.98
    letterSpacing: "-0.018em"
  headline:
    fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.012em"
  numeral:
    fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.75rem"
    fontWeight: 800
    lineHeight: 0.9
    letterSpacing: "-0.01em"
    fontFeature: "\"tnum\" 1, \"lnum\" 1"
  body:
    fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.625
  body-sm:
    fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  meta:
    fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.35
  label:
    fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1rem
    letterSpacing: "0.07em"
rounded:
  form: "2px"
spacing:
  hairline: "1px"
  cell-x: "14px"
  cell-y: "12px"
  gutter: "16px"
  gutter-sm: "24px"
  record-gap: "20px"
  section-gap: "48px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.on-brand}"
    rounded: "{rounded.form}"
    padding: "0 18px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.brand-deep}"
  button-line:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.brand-deep}"
    rounded: "{rounded.form}"
    padding: "0 18px"
    height: "44px"
  button-line-hover:
    backgroundColor: "{colors.brand-wash}"
  button-quiet:
    textColor: "{colors.ink}"
    rounded: "{rounded.form}"
    padding: "0 18px"
    height: "44px"
  input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.form}"
    padding: "8px 12px"
    height: "44px"
  sheet:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.form}"
  cover-panel:
    backgroundColor: "{colors.brand-deep}"
    textColor: "{colors.on-brand}"
    rounded: "{rounded.form}"
  count-badge:
    backgroundColor: "{colors.brass}"
    textColor: "{colors.brand-night}"
    rounded: "{rounded.form}"
  field-label:
    textColor: "{colors.ink-3}"
    typography: "{typography.label}"
  tick-box:
    size: "16px"
    rounded: "{rounded.form}"
---

# Design System: Clutch

## Overview

**Creative North Star: "The Logbook"**

Clutch is kept like a car's service logbook: a navy cloth cover with brass stamping, cream pages inside, and every entry dated, numbered and signed by whoever vouches for it. A mechanic's profile is their logbook. Claims sit in ruled fields, proven entries are ticked in carbon blue, and fields nobody has proven stay visible as blank lines waiting to be filled. The record carries a number (Record CL-4180), each job carries a ticket (No.012), and the primary action lives on a perforated tear-off stub.

The cover is navy. It carries the brand and every primary action: the main button, the mechanic app's sidebar, the "I'm a mechanic" door, the band above a recommended mechanic. Brass is the stamping on that cover: a 4px rule under a recommendation band, the count badges in navigation, the tick boxes on the mechanic pitch. Inside, the pages are cream stock with ink type and 1px hairline rules, dense like a working form: one reading column, tight ruled cells, small caps field labels, and heavy tabular numerals that carry the force of the page.

Colour inside the pages still means something specific. Carbon means verified and nothing else. One canary highlighter stroke marks what matches the visitor's car and repair. Self-reported material is written in pencil: grey text, dashed rules, dashed tick boxes, visibly weaker than anything proven.

The world refuses the category default of hero photo, star row, badge strip and rounded booking card. The mechanic's photo is clipped into the record like a real print.

**Key Characteristics:**
- Navy cover (brand) for identity and every primary action; brass stamping as its only ornament.
- Cream logbook pages (paper, sheet), ink type, 1px rule hairlines.
- Carbon blue reserved for verification; canary reserved for the visitor's match.
- Pencil grey plus dashed rules for anything self-reported.
- Square corners (2px), ruled sheets, field labels, numbered records and jobs.
- One family (Montserrat), matched to the logo lettering, doing everything through weight: 800 display and numerals, 700 heads, labels and buttons, 450 body.

## Colors

A navy-and-brass cover around cream pages, with one verification ink and one highlighter inside.

### Primary
- **Navy** (brand, #1f3a5f): The brand and every primary action. Primary buttons, the line button's border, focus rings, input focus and caret, the active selection in chips and radio cards, the service-area marker and radius, the accent phrase in the home headline.
- **Deep Navy** (brand-deep, #172c4a): Hover for primary buttons; solid cover panels (the mechanic door, the mechanic CTA, recommendation bands); the text colour of line buttons.
- **Night Navy** (brand-night, #0f1c30): The mechanic app's sidebar and phone header; text on brass.
- **Navy Wash** (brand-wash, #e4e9f1) and **Navy Tint** (brand-tint, #c9d3e2): Tinted page panels (the driver door, the comparison band, the mechanic's headline stat tiles), vehicle and icon tiles, the scrollbar thumb.
- **On Navy** (on-brand, #fdfbf6) and **On Navy Muted** (on-brand-2, #bfcadc): Text on navy, primary and secondary.

### Secondary
- **Brass** (brass, #c9973a) and **Brass Wash** (brass-wash, #f4e7c8): The stamping on the navy cover. The 4px rule under a recommendation band, count badges and the unread dot in navigation, tick boxes on the mechanic pitch, band titles set in brass wash on deep navy. Brass lives on or right next to navy.

### Tertiary
- **Carbon Copy Blue** (carbon, #3d3fc4), **Carbon Deep**, **Carbon Wash**: The verification ink. Filled tick boxes, provenance marks, verified status chips, job tally cells. Brighter and more violet than navy, so the two never read as one colour.
- **Canary Highlighter** (canary, #f2da5c) and **Canary Wash**: A highlighter band across the lower two-thirds of a line of type, only on counts, rows and vehicles that match the visitor's car and repair. Also the text-selection colour.
- **Pencil** (pencil, #5e6470): Self-reported content, dashed tick boxes and dashed section rules.
- **Signal Red** (alert) with **Red Wash**: Lapsed or rejected status, errors, destructive confirmations.
- **Shop Amber** (amber) with **Amber Wash**: Needs-info, renewals and warnings.

### Neutral
- **Logbook Cream** (paper, #f4f1e8): The page ground and the sticky header.
- **Page** (sheet, #fdfbf6): The raised paper of ruled boxes, the stub, the evidence sheet and inputs.
- **Ink** (ink, #141a26): Primary text and the 2px section rule. Navy-tinted, never pure black.
- **Ink 2** (ink-2) and **Ink 3** (ink-3): Supporting prose; field labels, metadata, placeholders.
- **Rule** (rule) and **Rule Soft** (rule-soft): Box borders; row dividers and internal cell splits.

### Named Rules
**The Cover Rule.** Navy is the cover: identity and the primary action. Every page has at most one filled navy button per decision, and navy is never used to mean "verified".

**The Brass Stamp Rule.** Brass is stamping on navy. It appears as a rule, a badge, a tick or a title on or beside a navy surface, never as a page fill, button, or body text on cream.

**The Carbon Copy Rule.** Carbon marks verification and nothing else. If a claim is not proven by a named copy (Clutch, customer, employer, issuer), it is not carbon. No carbon for links, generic success, navigation or decoration.

**The One Highlighter Rule.** Canary is a single highlighter stroke for what matches the visitor's car and repair. It is drawn once, never used as a fill, badge or button, and never appears when the page carries no car-and-repair context.

**The Pencil Rule.** Self-reported means pencil grey and dashed. It is never filled, never carbon, never navy, and never set equal to a verified claim.

**The Answer First Rule.** Every screen shows the answer, two or three supporting facts and one primary action; detail sits behind "See details", "Why this match?" or "More about …". Page titles stay around six words, intros are one sentence, card descriptions two lines, marketplace cards five visible facts. A fact appears once per viewport, and healthy states take one line ("Screening current", "You're ready to receive jobs").

## Typography

**Display Font:** Montserrat 800 (with ui-sans-serif, system-ui). Matched to the logo wordmark.
**Body Font:** Montserrat 450
**Label Font:** Montserrat 700 caps for field labels; numerals 800 with tabular lining figures

**Character:** One family doing everything through weight. Heavy and tight for numbers and names, small tracked caps for the printed field labels, normal weight for reading.

### Hierarchy
- **Display** (800, -0.03em, 2rem to 3rem; up to 4.25rem on the home hero; line-height 1.02, balanced): Page titles and the mechanic's name.
- **Headline** (700, -0.02em, 1.375rem to 1.5rem, line-height 1.15): Section heads under a 2px ink rule.
- **Numeral** (800, -0.035em, tabular lining figures, line-height 0.95; 1.875rem to 2.75rem): Counts, ratings, prices, dashboard stats. The numbers are the loudest thing on the page.
- **Body** (450, 1rem, relaxed; 0.9375rem for most supporting copy): Prose capped at 62 to 65ch.
- **Meta** (0.75rem to 0.8125rem): Captions, count bases, footnotes, provenance labels.
- **Label** (700, 0.65625rem, 0.08em tracking, uppercase, ink-3): Field labels naming a cell of the form.

### Named Rules
**The Numerals Carry the Force Rule.** Counts, ratings and prices are set heavy and tabular, and every count states its base underneath in meta type ("from 27 verified reviews").

**The Field Label Rule.** Small caps labels name a field in a ruled cell (Your car, Checks, Estimate request). They are never decorative kickers above headlines.

## Layout

Three surfaces share one system. The public site and profiles use a 1200px container (profiles 1120px) with 16px gutters, 24px from sm. The customer app has a top navigation from xl and a bottom tab bar below it. The mechanic app has a 240px night-navy sidebar from lg and a night-navy header with bottom tabs on phones. Forms and narrow flows use 720px and 560px columns.

The profile reads top to bottom: who, safe, relevant, proven, price, then the ledgers. On desktop it sits beside an 18.5rem sticky tear-off stub; on phones the stub becomes a fixed bottom bar with a perforated top edge.

Rhythm: record blocks stack at 20px (24px from sm); major sections at 48px to 56px, each opened by a 2px ink rule. Ruled cells pad at 14px by 12px. Dashboard stats sit in a ruled grid whose first row, the numbers that need action, is washed in navy.

## Elevation & Depth

Paper on paper. Depth comes from page stock against cream ground, navy panels against cream, and 1px rules, not from shadows. Shadow appears only where a real object sits on top of the page, and it is always navy-tinted.

### Shadow Vocabulary
- **Pressed button** (`0 1px 0 rgba(15,28,48,0.25), 0 6px 14px -8px rgba(15,28,48,0.55)`): The primary button, as if stamped into the page; the soft drop goes away on press.
- **Recommendation card** (`0 10px 30px -18px rgba(15,28,48,0.55)`): The two recommended mechanics lift slightly above the list.
- **Print** (`0 1px 2px rgba(22,24,29,0.12), 0 6px 16px -8px rgba(22,24,29,0.35)`): The mechanic's photo, a print with a 3px white border.
- **Sheet up** (`0 -12px 40px -12px rgba(22,24,29,0.25)` on phones, `0 24px 60px -20px rgba(22,24,29,0.35)` on desktop): The evidence sheet.

### Named Rules
**The Paper Only Rule.** Only physical objects cast a shadow: the pressed button, a lifted recommendation, a photo print, the evidence sheet. Boxes, strips and panels stay flat. The sticky header's 95% cream with a slight blur is the only translucency.

## Shapes

Square-cornered forms: every box, button, input, badge and tick box uses a 2px corner. Borders are 1px rule; section openings are a 2px ink rule; self-reported sections open with a 2px dashed pencil rule. A recommendation card is the one heavy frame: a 2px deep-navy border with a deep-navy band closed by a 4px brass rule. The perforated edge (3px punched circles on a 10px pitch in the ground colour) marks the tear-off stub and the top of the evidence sheet.

## Components

### Buttons
A button is a stamped block, not a pill.
- **Shape:** Square (2px), 44px minimum height, 18px horizontal padding, 700 weight, 0.875rem.
- **Primary** (`.btn-ink`): Navy block, cream text, pressed shadow; hover deepens to deep navy. "Request a quote", "Find a mechanic", "Finish and send".
- **Line** (`.btn-line`): Page background, 1px navy border, deep-navy text; hover washes navy.
- **Quiet** (`.btn-quiet`): Transparent with a rule border; hover darkens the border to ink-3.
- **On navy:** A page-coloured block with ink text ("Join as a Mechanic").
- **Disabled:** 45% opacity. Transitions are 160ms ease-out.

### Cover Panels
Deep-navy panels with cream text carry the mechanic side of the product: the "I'm a mechanic" door, the mechanic CTA, the role choice at signup, the "Post a repair request" action. Supporting text is on-navy muted; ornament is brass. The driver side's counterpart is a navy-wash panel.

### Recommendation Card
Best Fit and Soonest Strong Fit: a deep-navy band with the pick's name in brass wash and its definition in on-navy muted, closed by a 4px brass rule, above a page with the mechanic, the verified count and the facts grid. Framed in 2px deep navy with the recommendation shadow.

### Tick Box
The form's single mark, drawn at 14 to 18px and reused everywhere.
- **Verified:** Filled carbon square, white check.
- **Self:** Empty square, dashed pencil outline.
- **Pending:** Ink-3 outline with a clock hand.
- **Lapsed:** Red-wash fill, red outline, struck through.
- **Renewing:** Verified tick with an amber dot.
- **Blank:** Rule outline, a designed empty field.

### Provenance Mark and Evidence Sheet
A tick box plus its label, coloured by state, with a dotted underline that turns solid on hover. Every mark opens the evidence sheet: one dialog per page that rises from the bottom on phones and centres at 26rem on desktop. It names who vouches for the claim, its status, dates and Job No., and why Clutch shows sources instead of a score.

### Navigation
- **Site and customer header:** 56px, sticky, 95% cream with a slight blur and a bottom rule. The wrench logo in ink; links in ink-2, the active one in ink with a 2px underline. Count badges are brass with night-navy numerals.
- **Mechanic sidebar:** Night navy; links in on-navy muted, the active link on deep navy in cream, brass count badges.
- **Bottom tabs** on phones, cream for customers and navy for mechanics.

### Inputs / Fields
Page background, 1px rule border with an ink-3 bottom edge (a filled-in line), 2px corners, 44px tall, 1rem text. Focus switches the border and a 1px ring to navy; the caret is navy. A field label sits above and an optional hint below. Selected chips and radio cards fill navy with cream text.

### Counts, Ledgers and Tiles
Counts are heavy numerals over their base, with a rule-grey dash rather than a zero when there is no data. Ledgers are numbered rows (No.012) with a provenance mark aligned right; matching rows carry the canary stroke. Vehicle and icon tiles are navy-wash squares with navy line drawings.

## Do's and Don'ts

### Do:
- **Do** use navy (#1F3A5F) for the primary action and brand surfaces, one filled navy button per decision.
- **Do** keep brass (#C9973A) on or beside navy: rules, badges, ticks, band titles.
- **Do** keep carbon (#3D3FC4) for verified ticks, provenance marks and verified status only.
- **Do** mark the visitor's matching car and repair with one canary (#F2DA5C) highlighter stroke, drawn once.
- **Do** set self-reported material in pencil with dashed rules and dashed tick boxes.
- **Do** keep every corner at 2px and every border a 1px hairline; open sections with a 2px ink rule.
- **Do** set counts, ratings and prices as heavy tabular numerals with their base stated beneath.
- **Do** number records and jobs, and show unproven fields as designed blanks.
- **Do** summarize, then disclose: "Safety screening: 4 of 4 current" opens to the four checks; methodology lives on the verification page.

### Don't:
- **Don't** use navy or brass to signal "verified"; that is carbon's only job.
- **Don't** use brass as a page fill, a button, or text on cream.
- **Don't** use carbon for links, generic success, navigation or confirming the visitor's own actions.
- **Don't** use canary as a fill, badge, button or background block.
- **Don't** fill, colour or visually equate a self-reported claim with a verified one.
- **Don't** use pure black or pure white; ink and page are navy-tinted and cream.
- **Don't** round boxes past 2px, and don't use pills for status.
- **Don't** add decorative gradients, glass or glow; the only gradients are the highlighter band and the perforation.
- **Don't** show a trust score or rank by price.
- **Don't** put caps labels above headlines as kickers.
- **Don't** list every screening badge, credential, fee and caveat on a card, or repeat a fact the same screen already shows.
