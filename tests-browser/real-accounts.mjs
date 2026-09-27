// The real-account path in a browser: two fictional live-scope users sign up through the app's
// real auth flow (confirmation link read from the local auth fixture's mailbox; nothing is sent),
// then onboarding with every check unverified, a request, a question and answer, an estimate,
// the verification acknowledgement, booking, the job to completion, a server restart, and
// log out / log in on both sides. No demo accounts and no /api/test-login.
// Run with: npm run test:browser (scripts/test-browser.mjs sets up everything).
import puppeteer from "puppeteer-core";
import postgres from "postgres";
import { mkdirSync, writeFileSync } from "node:fs";

export async function run({ base, auth, db, chrome, out, restart, store = "snapshot" }) {
  /** Where live records are: the snapshot store's app_records, or the normalized lv_* tables. */
  const T = (c) => (store === "normalized" ? `lv_${c.replace(/[A-Z]/g, (x) => `_${x.toLowerCase()}`)} where` : `app_records where scope='live' and collection='${c}' and`);
  const u = base;
  const AUTH = auth;
  const OUT = out.endsWith("/") ? out : `${out}/`;
  mkdirSync(OUT, { recursive: true });
  const sql = postgres(db, { prepare: false, max: 2, onnotice: () => undefined });
  // Upload fixtures: a real PNG, and files that must be refused (HTML named .jpg, an SVG with script).
  const FILES = {
    png: `${OUT}photo.png`,
    fakeJpg: `${OUT}brakes.jpg`,
    svg: `${OUT}face.svg`,
    pdf: `${OUT}shop-estimate.pdf`,
  };
  writeFileSync(FILES.png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAHklEQVR42mO8wMDAQApgHNUwqmFUw6iGUQ2jGgYAAJoYAhGGlGzLAAAAAElFTkSuQmCC", "base64"));
  writeFileSync(FILES.fakeJpg, "<!doctype html><script>fetch('/api/account')</script>");
  writeFileSync(FILES.svg, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  writeFileSync(FILES.pdf, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  /** Upload through a file input, then wait for the page to settle. */
  const chooseFile = async (p, selector, file) => {
    const input = await p.$(selector);
    if (!input) throw new Error(`no ${selector} on ${p.url()}`);
    await input.uploadFile(file);
    await p.waitForNetworkIdle({ idleTime: 800 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
  };
  const alertText = (p) => p.evaluate(() => [...document.querySelectorAll('[role="alert"]')].map((x) => x.innerText).join(" | "));
  /** Status and headers of a file as this browser session sees it. */
  const fetchAs = (p, url, headers = {}) => p.evaluate(async (url, headers) => { const r = await fetch(url, { headers }); return { status: r.status, h: Object.fromEntries(r.headers.entries()) }; }, url, headers);
  /** First column of the first row, as text ("" when none), like psql -tA. */
  const psql = async (q) => {
    const [row] = await sql.unsafe(q);
    if (!row) return "";
    const v = Object.values(row)[0];
    return v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  };
  const RUN = Date.now().toString(36);
  const CUST = { name: "Casey Fixture", email: `casey.${RUN}@example.test`, password: `Fixture-${RUN}-c1` };
  const MECH = { name: `Morgan Fixture ${RUN}`, email: `morgan.${RUN}@example.test`, password: `Fixture-${RUN}-m1`, phone: "(555) 010-0199" };

  const b = await puppeteer.launch({ executablePath: chrome, headless: true, protocolTimeout: 120000, args: process.platform === "linux" ? ["--no-sandbox"] : [] });
  let fails = 0, checks = 0;
  const ok = (l, c, x = "") => { checks++; if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"}  ${l}${!c && x ? `  [${String(x).replace(/\s+/g, " ").slice(0, 500)}]` : ""}`); return c; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const main = (p) => p.evaluate(() => (document.querySelector("main") ?? document.body).innerText);
  const path = (p) => { const x = new URL(p.url()); return x.pathname + x.search; };
  const errPage = (t) => /This page didn.t load|Something went wrong|Application error/.test(t);
  async function ctx(label) {
    const c = await b.createBrowserContext();
    const p = await c.newPage();
    p.on("dialog", (d) => d.accept().catch(() => {}));
    p.on("pageerror", (e) => { fails++; console.log(`PAGEERROR (${label})`, e.message); });
    p.on("response", (r) => { if (r.status() >= 500) console.log(`HTTP ${r.status()} (${label}) ${r.url()}`); });
    await p.setViewport({ width: 1280, height: 900 });
    return { c, p };
  }
  const go = (p, url) => p.goto(u + url, { waitUntil: "networkidle0" });
  const find = (p, re, sel = "button, a, label, summary") => p.evaluateHandle((src, flags, sel) => { const r = new RegExp(src, flags); return [...document.querySelectorAll(sel)].find((x) => r.test(x.innerText.trim()) && !x.disabled && x.offsetParent) ?? null; }, re.source, re.flags, sel);
  async function click(p, re, sel) {
    const h = await find(p, re, sel);
    if (!(await h.evaluate((x) => Boolean(x)))) throw new Error(`no ${re} on ${path(p)} :: ${(await main(p)).replace(/\s+/g, " ").slice(0, 400)}`);
    await h.evaluate((x) => x.scrollIntoView({ block: "center" }));
    await h.click();
  }
  async function act(p, re, sel) {
    const before = p.url();
    await click(p, re, sel);
    await p.waitForFunction((b) => location.href !== b, { timeout: 20000 }, before).catch(() => {});
    await p.waitForNetworkIdle({ idleTime: 600 }).catch(() => {});
  }
  const set = (p, sel, v) => p.$eval(sel, (el, v) => { const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, v);
  async function phone(p, label, shot) {
    const url = p.url();
    await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await p.goto(url, { waitUntil: "networkidle0" });
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(`${label} @390 fits (${over}px over)`, over <= 0);
    await p.screenshot({ path: `${OUT}${shot}-390.png`, fullPage: true });
    await p.setViewport({ width: 1280, height: 900 });
    await p.goto(url, { waitUntil: "networkidle0" });
    await p.screenshot({ path: `${OUT}${shot}-1280.png`, fullPage: true });
  }
  async function confirmFromMailbox(p, email) {
    const box = await (await fetch(`${AUTH}/__local/mailbox?email=${encodeURIComponent(email)}`)).json();
    ok(`${email}: one confirmation link in the local mailbox (nothing sent)`, box.length === 1 && box[0].kind === "signup", JSON.stringify(box));
    await p.goto(box[0].link, { waitUntil: "networkidle0" });
  }
  async function login(p, who) {
    await go(p, "/login");
    await set(p, 'form input[name="email"]', who.email);
    await set(p, 'form input[name="password"]', who.password);
    await act(p, /^Log in$/, "button");
  }
  async function logout(p) {
    await p.evaluate(() => [...document.querySelectorAll('button[aria-haspopup="menu"][aria-label^="Account"]')].find((x) => x.offsetParent)?.click());
    await sleep(300);
    await act(p, /^Log out$/, "button");
  }

  // ============================================================ 1. mechanic signs up and onboards
  const M = await ctx("mechanic");
  await go(M.p, "/signup?role=mechanic");
  ok("mechanic sign-up form shown (Supabase-style auth configured)", Boolean(await M.p.$('form input[name="password"]')));
  await phone(M.p, "mechanic sign-up", "01-mech-signup");
  await set(M.p, 'form input[name="name"]', MECH.name);
  await set(M.p, 'form input[name="email"]', MECH.email);
  await set(M.p, 'form input[name="password"]', MECH.password);
  await set(M.p, 'form input[name="phone"]', MECH.phone);
  await act(M.p, /^Continue to your profile$/, "button");
  ok(`mechanic → check your email (${path(M.p)})`, path(M.p).startsWith("/signup/check-email"), await main(M.p));
  ok("no account before confirming", await psql(`select count(*) from ${T('users')} data->>'email'='${MECH.email}'`) === "0");
  await confirmFromMailbox(M.p, MECH.email);
  ok(`confirmed → onboarding (${path(M.p)})`, path(M.p).startsWith("/mechanic/onboarding"), await main(M.p));
  ok("live account created, not demo", await psql(`select count(*) from ${T('users')} data->>'email'='${MECH.email}'`) === "1" && await psql(`select count(*) from app_records where scope='demo' and data->>'email'='${MECH.email}'`) === "0");
  await phone(M.p, "onboarding", "02-onboarding");
  // Portrait: an SVG with script is refused with a clear reason; a real photo is accepted.
  await chooseFile(M.p, 'input[type="file"][accept="image/*"]', FILES.svg);
  ok("portrait: SVG refused with the reason", /doesn't accept web pages, SVG images or scripts/.test(await alertText(M.p)), await alertText(M.p));
  await chooseFile(M.p, 'input[type="file"][accept="image/*"]', FILES.png);
  const portraitUrl = await M.p.evaluate(() => document.querySelector('img[alt="Your portrait"]')?.getAttribute("src") ?? "");
  ok(`portrait: photo accepted (${portraitUrl})`, /^\/api\/media\/[0-9a-f-]+$/.test(portraitUrl) && !(await alertText(M.p)), await alertText(M.p));
  await M.p.evaluate((name) => {
    const f = document.querySelector('input[name="displayName"]').form;
    const s = (n, v) => { const el = f.querySelector(`[name="${n}"]`); const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
    s("displayName", name); s("bio", "Fictional fixture mechanic. Brakes and suspension on European cars.");
    s("neighborhood", "mid-city"); s("serviceRadiusMi", "15"); s("availability", "Weekdays 8am to 5pm");
    f.querySelector('[name="categories"][value="brakes"]').click(); f.querySelector('[name="makes"][value="BMW"]').click();
    s("hourlyRate", "95"); s("diagnosticFee", "60");
  }, MECH.name);
  for (let i = 0; i < 8 && path(M.p).startsWith("/mechanic/onboarding"); i++) {
    const more = await M.p.evaluate(() => [...document.querySelectorAll("button")].some((x) => x.innerText.trim().startsWith("Continue") && x.offsetParent));
    if (more) { await click(M.p, /^Continue/, "button"); await sleep(400); continue; }
    const label = await M.p.evaluate(() => [...document.querySelectorAll("form button:not([type=button])")].filter((x) => x.offsetParent).map((x) => x.innerText.trim()).filter(Boolean).at(-1));
    await act(M.p, new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "button");
  }
  ok(`onboarding published → ${path(M.p)}`, path(M.p).startsWith("/mechanic") && !path(M.p).startsWith("/mechanic/onboarding"), await main(M.p));
  const mechId = await psql(`select id from ${T('mechanics')} data->>'displayName'='${MECH.name}'`);
  ok("mechanic profile stored live, no checks recorded", Boolean(mechId) && await psql(`select count(*) from ${T('screenings')} data->>'mechanicId'='${mechId}'`) === "0");
  await go(M.p, "/mechanic");
  let t = await main(M.p);
  ok("mechanic home: can receive requests and be booked; every check not completed", /You can receive requests and be booked/.test(t) && /identity \(not completed\)/.test(t) && /insurance \(not completed\)/.test(t), t);
  await phone(M.p, "mechanic home", "03-mech-home");

  // ============================================================ 2. customer signs up with a car, confirms
  const C = await ctx("customer");
  await go(C.p, "/signup?role=customer");
  await phone(C.p, "customer sign-up", "04-cust-signup");
  await set(C.p, 'form input[name="name"]', CUST.name);
  await set(C.p, 'form input[name="email"]', CUST.email);
  await set(C.p, 'form input[name="password"]', CUST.password);
  await C.p.evaluate(() => { const d = document.querySelector("form details"); if (d) d.open = true; });
  await set(C.p, 'form select[name="year"]', "2016");
  await set(C.p, 'form select[name="make"]', "BMW");
  await set(C.p, 'form input[name="model"]', "328i");
  await set(C.p, 'form input[name="mileage"]', "71000");
  await act(C.p, /^Create account$/, "button");
  ok(`customer → check your email (${path(C.p)})`, path(C.p).startsWith("/signup/check-email"), await main(C.p));
  await phone(C.p, "check your email", "05-check-email");
  // Signing in before confirming is refused with a clear message.
  const early = await ctx("early");
  await login(early.p, CUST);
  ok("sign-in before confirming: told to confirm, no session", /confirm/i.test(await main(early.p)) && path(early.p).startsWith("/login"), path(early.p) + " " + (await main(early.p)));
  await early.c.close();
  await confirmFromMailbox(C.p, CUST.email);
  t = await main(C.p);
  ok(`customer confirmed → customer home (${path(C.p)})`, path(C.p).startsWith("/customer") && !errPage(t), t);
  ok("the car from sign-up is saved", /2016 BMW 328i/.test(t), t);
  await phone(C.p, "customer home", "06-cust-home");

  // ============================================================ 3. repair request
  await go(C.p, "/customer/requests/new?repair=brakes&make=BMW&area=mid-city");
  const stepTo = (n) => C.p.waitForFunction((n) => document.body.innerText.includes(`Step ${n} of 4`), { timeout: 20000 }, n);
  await click(C.p, /^Continue/, "button"); await stepTo(2);
  await C.p.type("textarea", "Grinding from the front brakes, worse in the morning.");
  await click(C.p, /^Starts normally/, "label"); await sleep(200);
  await click(C.p, /^Continue/, "button"); await stepTo(3);
  // Diagnostic media: HTML disguised as a JPEG is refused; a photo and a PDF estimate are accepted.
  const anyFile = 'input[type="file"][accept="image/*,video/*,audio/*,application/pdf"]';
  await chooseFile(C.p, anyFile, FILES.fakeJpg);
  ok("diagnostic upload: HTML named .jpg refused with the reason", /doesn't accept web pages, SVG images or scripts/.test(await alertText(C.p)), await alertText(C.p));
  await C.p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  ok("upload refusal @390 fits", (await C.p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
  await C.p.screenshot({ path: `${OUT}07a-upload-refused-390.png`, fullPage: true });
  await C.p.setViewport({ width: 1280, height: 900 });
  await chooseFile(C.p, anyFile, FILES.png);
  await chooseFile(C.p, anyFile, FILES.pdf);
  const tiles = await C.p.evaluate(() => [...document.querySelectorAll('[aria-label="Attached files"] a[href^="/api/media/"]')].map((a) => a.getAttribute("href")));
  ok(`diagnostic upload: photo and PDF attached (${tiles.length})`, tiles.length === 2 && !(await alertText(C.p)), await alertText(C.p));
  await C.p.screenshot({ path: `${OUT}07b-uploads-1280.png`, fullPage: true });
  const [photoUrl, pdfUrl] = tiles;
  await click(C.p, /^Continue/, "button"); await stepTo(4);
  await click(C.p, /this week|flexible/i, "label"); await sleep(300);
  // A refresh straight after moving on comes back to the same step (it used to fall back to step 1).
  await C.p.reload({ waitUntil: "networkidle0" });
  ok("request form: refresh right after 'Continue' keeps step 4", /Step 4 of 4/.test(await main(C.p)), (await main(C.p)).slice(0, 200));
  await click(C.p, /this week|flexible/i, "label"); await sleep(1200);
  await phone(C.p, "request review", "07-req-review");
  ok("request review: still step 4 after the width check", /Step 4 of 4/.test(await main(C.p)));
  const sendLabel = await C.p.evaluate(() => [...document.querySelectorAll("button")].filter((x) => x.offsetParent).map((x) => x.innerText.trim()).find((x) => /^Send/.test(x)));
  await act(C.p, new RegExp(`^${(sendLabel ?? "Send").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "button");
  const reqId = path(C.p).split("?")[0].split("/").pop();
  t = await main(C.p);
  ok(`request sent to the matching mechanic (${reqId})`, /^req-/.test(reqId) && /Sent to \d+ mechanics? who match(es)? your car, repair and area/.test(t), path(C.p) + " " + t);
  ok("stored live, sent to our new mechanic", (await psql(store === "normalized" ? `select string_agg(mechanic_id, ',') from lv_request_invitations where request_id='${reqId}'` : `select data->'matchedMechanicIds' from ${T('requests')} id='${reqId}'`)).includes(mechId));
  await phone(C.p, "request sent", "08-req-sent");

  // ============================================================ 4. mechanic receives it, asks a question
  await go(M.p, "/mechanic/requests");
  t = await main(M.p);
  ok("mechanic sees the request", /2016 BMW 328i/.test(t) && /Grinding/.test(t), t);
  await go(M.p, `/mechanic/requests/${reqId}`);
  await phone(M.p, "mechanic request", "09-mech-request");
  await act(M.p, /^I.m interested/, "button");
  await set(M.p, 'textarea[name="question"]', "Does the grinding happen when you first pull away, or only when braking?");
  await act(M.p, /^(Ask|Send question)/, "button");
  ok("question stored", await psql(store === "normalized" ? `select count(*) from lv_request_questions where request_id='${reqId}'` : `select jsonb_array_length(data->'questions') from ${T('requests')} id='${reqId}'`) === "1");

  // customer answers
  await go(C.p, `/customer/requests/${reqId}`);
  t = await main(C.p);
  ok("customer sees the question", /first pull away/.test(t), t);
  const ans = await C.p.$("textarea[aria-label^='Reply to']");
  if (ok("answer box shown", Boolean(ans))) {
    await ans.click(); await C.p.keyboard.type("Only when braking, mostly the first few stops.");
    await click(C.p, /^(Send|Reply|Send reply|Answer)/, "button"); await C.p.waitForNetworkIdle({ idleTime: 800 }).catch(() => {}); await sleep(500);
    ok("answer stored", /Only when braking/.test(await psql(store === "normalized" ? `select response from lv_request_questions where request_id='${reqId}' and seq=0` : `select data->'questions'->0->>'response' from ${T('requests')} id='${reqId}'`)));
  }

  // ============================================================ 5. estimate
  await go(M.p, `/mechanic/requests/${reqId}`);
  t = await main(M.p);
  ok("mechanic sees the answer", /Only when braking/.test(t), t);
  await set(M.p, 'textarea[placeholder^="What you"]', "Replace front pads and rotors; road test.");
  await set(M.p, 'input[aria-label="Date"]', "2026-10-06");
  await set(M.p, 'input[aria-label="Time"]', "09:00");
  await sleep(500);
  await act(M.p, /^Review and send$/, "button");
  ok("estimate sent", path(M.p).includes("sent=1"), path(M.p) + " " + (await main(M.p)));
  const quoteId = await psql(`select id from ${T('quotes')} data->>'requestId'='${reqId}' and data->>'status'='submitted'`);
  ok("estimate stored live", /^quote-|^q/.test(quoteId), quoteId);

  // ============================================================ 6. customer reviews and books with the acknowledgement
  await go(C.p, `/customer/quotes/${quoteId}`);
  t = await main(C.p);
  ok("estimate shows each check not completed + insurance note", /Identity: Not completed/.test(t) && /Driving record: Not completed/.test(t) && /Ask the mechanic for proof of insurance/.test(t), t);
  await phone(C.p, "estimate", "10-estimate");
  await act(C.p, /^Review verification and book/, "a");
  ok(`booking step (${path(C.p)})`, path(C.p) === `/customer/quotes/${quoteId}/book`);
  ok("acknowledgement unticked", await C.p.$eval('input[name="acknowledge"]', (x) => !x.checked));
  await phone(C.p, "booking step", "11-book");
  await C.p.evaluate(() => { const f = document.querySelector('input[name="acknowledge"]').form; f.noValidate = true; f.requestSubmit(); });
  await C.p.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
  ok("without the acknowledgement: refused, nothing booked", await psql(`select count(*) from ${T('jobs')} data->>'requestId'='${reqId}'`) === "0");
  await go(C.p, `/customer/quotes/${quoteId}/book`);
  await click(C.p, /^I understand/, "label");
  await act(C.p, /^Book /, "button");
  const jobPath = path(C.p).split("?")[0];
  ok(`booked → ${jobPath}`, /^\/customer\/jobs\//.test(jobPath), path(C.p) + " " + (await main(C.p)));
  const jobId = jobPath.split("/").pop();
  const rec = JSON.parse(await psql(`select data->'verificationAtBooking' from ${T('jobs')} id='${jobId}'`) || "null");
  ok("booking keeps the acknowledgement record", rec && rec.fullyVerified === false && rec.acknowledgement?.version && rec.checks?.length === 4, JSON.stringify(rec));
  await phone(C.p, "customer job", "12-cust-job");

  // ============================================================ 7. restart the app, sessions persist
  await restart();
  ok("app restarted", true);
  await C.p.reload({ waitUntil: "networkidle0" });
  ok("customer still signed in after refresh/restart", path(C.p).startsWith("/customer/jobs/"), path(C.p));
  await go(M.p, "/mechanic/jobs");
  ok("mechanic still signed in after restart, sees the job", /2016 BMW 328i|328i/.test(await main(M.p)) && path(M.p).startsWith("/mechanic/jobs"), await main(M.p));

  // ============================================================ 8. job progression
  await go(M.p, `/mechanic/jobs/${jobId}`);
  await phone(M.p, "mechanic job", "13-mech-job");
  const statusOf = () => psql(`select data->>'status' from ${T('jobs')} id='${jobId}'`);
  async function mstep(label, run, want) {
    const before = (await statusOf());
    try { await run(); } catch (e) { return ok(`mechanic: ${label}`, false, e.message); }
    await M.p.waitForNetworkIdle({ idleTime: 800 }).catch(() => {}); await sleep(400);
    ok(`mechanic: ${label} (job ${before} → ${(await statusOf())})`, want((await statusOf())), (await main(M.p)).slice(0, 500));
  }
  await mstep("confirm the appointment time", () => click(M.p, /^Confirm$/, "button"), (x) => x === "scheduled");
  ok("appointment confirmed", /confirmed/i.test(await psql(`select data->>'confirmedAt' is not null or data->>'appointmentConfirmed' = 'true' or data::text ilike '%confirmedAt%' from ${T('jobs')} id='${jobId}'`)) || /is confirmed for/.test(await main(M.p)), (await main(M.p)).slice(0, 300));
  await mstep("check in and start", () => click(M.p, /^Check in and start/, "button"), (x) => x === "in_progress");
  await mstep("share what they found (matches the estimate)", async () => {
    await set(M.p, 'textarea[name="note"]', "Front pads at 2 mm, rotors scored. Same work as the estimate.");
    await click(M.p, /^Share with /, "button");
  }, (x) => x === "in_progress");
  ok("diagnosis stored", /Front pads at 2 mm/.test(await psql(`select data::text from ${T('jobs')} id='${jobId}'`)));
  await go(M.p, `/mechanic/jobs/${jobId}`);
  await chooseFile(M.p, 'input[type="file"][accept="image/*,video/*"]', FILES.svg);
  ok("repair photo: SVG refused", /doesn't accept web pages, SVG images or scripts/.test(await alertText(M.p)), await alertText(M.p));
  await chooseFile(M.p, 'input[type="file"][accept="image/*,video/*"]', FILES.png);
  await M.p.waitForNetworkIdle({ idleTime: 800 }).catch(() => {});
  const jobPhoto = await psql(`select data->'photos'->0->>'url' from ${T('jobs')} id='${jobId}'`);
  ok(`repair photo attached to the job (${jobPhoto})`, /^\/api\/media\//.test(jobPhoto), await main(M.p));
  await mstep("mark complete", () => click(M.p, /^Mark complete/, "button"), (x) => x === "awaiting_customer");
  await go(C.p, `/customer/jobs/${jobId}`);
  t = await main(C.p);
  const confirmBtn = await find(C.p, /^Yes, the work is done/, "button");
  if (ok("customer asked to confirm the repair", await confirmBtn.evaluate((x) => Boolean(x)), t.slice(0, 600))) {
    await confirmBtn.evaluate((x) => x.scrollIntoView({ block: "center" })); await confirmBtn.click();
    await C.p.waitForNetworkIdle({ idleTime: 800 }).catch(() => {});
    ok(`customer confirms → job ${(await statusOf())}`, (await statusOf()) === "completed", await main(C.p));
  }

  // ============================================================ 9. log out, log back in: same persisted state on both sides
  await go(C.p, "/customer");
  await logout(C.p);
  await go(C.p, "/customer");
  ok("customer logged out: private pages need sign-in", path(C.p).startsWith("/login") || /Log in/.test(await main(C.p)), path(C.p));
  await go(M.p, "/mechanic");
  await logout(M.p);
  const C2 = await ctx("customer-2"); // a different browser
  await login(C2.p, CUST);
  ok(`customer logs in again → ${path(C2.p)}`, path(C2.p).startsWith("/customer"), await main(C2.p));
  await go(C2.p, `/customer/jobs/${jobId}`);
  t = await main(C2.p);
  ok("customer sees the completed job and the booking record", /Verification when you booked/.test(t) && /[Cc]ompleted/.test(t) && !errPage(t), t.slice(0, 800));
  const M2 = await ctx("mechanic-2");
  await login(M2.p, MECH);
  ok(`mechanic logs in again → ${path(M2.p)}`, path(M2.p).startsWith("/mechanic"), await main(M2.p));
  await go(M2.p, `/mechanic/jobs/${jobId}`);
  t = await main(M2.p);
  ok("mechanic sees the same completed job", /[Cc]ompleted/.test(t) && /328i/.test(t) && !errPage(t), t.slice(0, 600));
  // Who can open the uploads, and how they're served.
  const photo = await fetchAs(C2.p, photoUrl);
  ok("customer opens their diagnostic photo: inline, typed from the bytes, nosniff, sandboxed", photo.status === 200 && photo.h["content-type"] === "image/png" && /^inline; filename="clutch-photo-[a-z0-9]+\.png"$/.test(photo.h["content-disposition"]) && photo.h["x-content-type-options"] === "nosniff" && /sandbox/.test(photo.h["content-security-policy"]) && photo.h["cross-origin-resource-policy"] === "same-origin", JSON.stringify(photo));
  const pdf = await fetchAs(C2.p, pdfUrl);
  ok("the PDF is only ever a download", pdf.status === 200 && pdf.h["content-type"] === "application/pdf" && /^attachment;/.test(pdf.h["content-disposition"]), JSON.stringify(pdf));
  const ranged = await fetchAs(C2.p, photoUrl, { Range: "bytes=0-7" });
  ok("byte ranges work (video playback in Safari)", ranged.status === 206 && /^bytes 0-7\//.test(ranged.h["content-range"] ?? ""), JSON.stringify(ranged));
  ok("the mechanic the request went to can open it", (await fetchAs(M2.p, photoUrl)).status === 200);
  const G = await ctx("guest");
  await go(G.p, "/");
  ok("a signed-out visitor can't", (await fetchAs(G.p, photoUrl)).status === 401);
  ok("the mechanic's portrait is public", (await fetchAs(G.p, portraitUrl)).status === 200);
  // An unrelated signed-in customer.
  const OTHER = { name: "Riley Fixture", email: `riley.${RUN}@example.test`, password: `Fixture-${RUN}-r1` };
  await go(G.p, "/signup?role=customer");
  await set(G.p, 'form input[name="name"]', OTHER.name);
  await set(G.p, 'form input[name="email"]', OTHER.email);
  await set(G.p, 'form input[name="password"]', OTHER.password);
  await act(G.p, /^Create account$/, "button");
  await confirmFromMailbox(G.p, OTHER.email);
  ok(`unrelated customer signed in (${path(G.p)})`, path(G.p).startsWith("/customer"));
  for (const [label, url] of [["diagnostic photo", photoUrl], ["PDF estimate", pdfUrl]]) ok(`an unrelated customer can't open the ${label} (404)`, (await fetchAs(G.p, url)).status === 404);
  await go(G.p, photoUrl);
  ok("…and opening it directly shows no file", !/PNG|IHDR/.test(await G.p.evaluate(() => document.body.innerText)));
  for (const w of [1280, 390]) {
    await C2.p.setViewport(w === 390 ? { width: 390, height: 844, isMobile: true, hasTouch: true } : { width: 1280, height: 900 });
    await go(C2.p, `/customer/requests/${reqId}`);
    ok(`customer sees their attachments on the request @${w}`, await C2.p.evaluate((u) => Boolean(document.querySelector(`a[href="${u}"]`)), photoUrl));
    ok(`request page @${w} fits`, (await C2.p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
    await C2.p.screenshot({ path: `${OUT}14-attachments-${w}.png`, fullPage: true });
  }
  ok("nothing reached the demo scope", await psql(`select count(*) from app_records where scope='demo' and (data->>'email' in ('${CUST.email}','${MECH.email}') or id in ('${reqId}','${jobId}'))`) === "0");
  ok("no delivery was attempted (no provider configured)", await psql(`select count(*) from delivery_attempts where outcome='sent'`) === "0");

  console.log(`\n${checks} checks, ${fails ? `${fails} FAILED` : "ALL PASSED"}`);
  await b.close();
  await sql.end({ timeout: 5 });
  return fails;
}
