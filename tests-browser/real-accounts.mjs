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
    // Every wait is bounded; the runner's watchdog reports a step that makes no progress at all.
    p.setDefaultTimeout(30000);
    p.setDefaultNavigationTimeout(45000);
    (globalThis.__clutchTestPages ??= []).push({ label, p });
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
  /** The app header at a phone width: the mode shown in full, 44px targets, nothing clipped or overflowing. */
  async function headerCheck(p, label, mode) {
    const url = p.url();
    for (const width of [390, 360]) {
      await p.setViewport({ width, height: 844, isMobile: true, hasTouch: true });
      await p.goto(url, { waitUntil: "networkidle0" });
      const h = await p.evaluate(() => {
        const btn = [...document.querySelectorAll('button[aria-haspopup="menu"][aria-label^="Account"]')].find((x) => x.offsetParent);
        const b = btn?.getBoundingClientRect();
        const clipped = btn ? [...btn.querySelectorAll("span")].some((x) => x.scrollWidth > x.clientWidth + 1) : true;
        const header = btn?.closest("header");
        const targets = header ? [...header.querySelectorAll("a, button")].filter((x) => x.offsetParent).map((x) => Math.round(x.getBoundingClientRect().height)) : [];
        return { text: btn?.innerText.replace(/\s+/g, " ").trim(), h: b ? Math.round(b.height) : 0, right: b ? Math.round(b.right) : 0, vw: innerWidth, clipped, minTarget: Math.min(...targets), over: document.documentElement.scrollWidth - innerWidth };
      });
      ok(`${label} header @${width}: "${mode}" shown in full, 44px targets, fits`, h.text?.includes(mode) && !h.clipped && h.h >= 44 && h.minTarget >= 44 && h.right <= h.vw && h.over <= 0, JSON.stringify(h));
    }
    await p.setViewport({ width: 1280, height: 900 });
    await p.goto(url, { waitUntil: "networkidle0" });
  }
  async function confirmFromMailbox(p, email) {
    const box = await (await fetch(`${AUTH}/__local/mailbox?email=${encodeURIComponent(email)}`)).json();
    ok(`${email}: one confirmation link in the local mailbox (nothing sent)`, box.length === 1 && box[0].kind === "signup", JSON.stringify(box));
    await p.goto(box[0].link, { waitUntil: "networkidle0" });
  }
  /** The structured vehicle picker, driven like a person: type into the labelled combobox, click the option. */
  async function combo(p, label, text) {
    const input = await p.evaluateHandle((l) => {
      document.querySelectorAll("form details").forEach((d) => (d.open = true));
      const lab = [...document.querySelectorAll("label")].find((x) => (x.textContent ?? "").trim().replace(/\s*\(required\)$/, "") === l && x.htmlFor);
      return lab ? document.getElementById(lab.htmlFor) : null;
    }, label);
    if (!(await input.evaluate((x) => Boolean(x)))) throw new Error(`no ${label} picker on ${p.url()}`);
    await p.waitForFunction((el) => !el.disabled, { timeout: 20000 }, input);
    await input.click({ clickCount: 3 });
    await input.type(text);
    await p.waitForFunction((t) => [...document.querySelectorAll('[role="option"]')].some((o) => o.innerText.trim() === t), { timeout: 20000 }, text);
    const opt = await p.evaluateHandle((t) => [...document.querySelectorAll('[role="option"]')].find((o) => o.innerText.trim() === t), text);
    await opt.click();
    await sleep(500);
  }
  async function chip(p, group, text) {
    await p.waitForFunction((g, t) => [...document.querySelectorAll(`[role="radiogroup"][aria-label="${g}"] [role="radio"]`)].some((b) => b.innerText.trim() === t), { timeout: 20000 }, group, text);
    await p.evaluate((g, t) => [...document.querySelectorAll(`[role="radiogroup"][aria-label="${g}"] [role="radio"]`)].find((b) => b.innerText.trim() === t).click(), group, text);
    await sleep(300);
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
  {
    const o = await M.p.evaluate(() => ({ city: Boolean(document.querySelector('[name="city"]')), summary: document.body.textContent.match(/\d+ repairs? · \d+ makes? selected/)?.[0] ?? "", optional: /Experience and first proof \(optional\)/.test(document.body.textContent), text: document.body.textContent }));
    ok(`onboarding: one service-base choice (no City field), picker shows "${o.summary}", step 4 optional`, !o.city && o.summary === "1 repair · 1 make selected" && o.optional && !/Send estimates and be booked[^.]*verified/i.test(o.text), o.summary);
  }
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
  await headerCheck(M.p, "mechanic home", "Mechanic");

  // ============================================================ 2. customer signs up with a car, confirms
  const C = await ctx("customer");
  await go(C.p, "/signup?role=customer");
  await phone(C.p, "customer sign-up", "04-cust-signup");
  await set(C.p, 'form input[name="name"]', CUST.name);
  await set(C.p, 'form input[name="email"]', CUST.email);
  await set(C.p, 'form input[name="password"]', CUST.password);
  await C.p.evaluate(() => { const d = document.querySelector("form details"); if (d) d.open = true; });
  // Year first, then make, then only models that existed for it, then the configuration.
  await combo(C.p, "Year", "2016");
  await combo(C.p, "Make", "BMW");
  await combo(C.p, "Model", "328i");
  await chip(C.p, "Transmission", "8-speed automatic");
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
  {
    const spec = JSON.parse((await psql(`select data->'spec' from ${T('vehicles')} data->>'model'='328i' and data->>'mileage'='71000'`)) || "null");
    ok(`sign-up car stored with a structured spec: engine ${spec?.engine?.code} (${spec?.engine?.status}), transmission ${spec?.transmission?.id} (${spec?.transmission?.status})`, spec?.engine?.code === "N20" && spec.engine.status === "likely" && spec.transmission?.id === "8AT" && spec.transmission.status === "selected", JSON.stringify(spec));
  }
  await phone(C.p, "customer home", "06-cust-home");
  await headerCheck(C.p, "customer home", "Customer");

  // ============================================================ 3. repair request
  await go(C.p, "/customer/requests/new?repair=brakes&make=BMW&area=mid-city");
  const stepTo = (n) => C.p.waitForFunction((n) => document.body.innerText.includes(`Step ${n} of 4`), { timeout: 20000 }, n);
  await click(C.p, /^Continue/, "button"); await stepTo(2);
  await C.p.type("textarea", "Grinding from the front brakes, worse in the morning.");
  await click(C.p, /^Starts normally/, "label"); await sleep(200);
  await click(C.p, /^Continue/, "button"); await stepTo(3);
  // Diagnostic media: HTML disguised as a JPEG is refused; a photo and a PDF estimate are accepted.
  const anyFile = 'input[type="file"][accept*="application/pdf"]';
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
  {
    const b = await M.p.evaluate(() => document.querySelector('section[aria-label="Vehicle"]')?.innerText ?? "");
    ok("mechanic request: the vehicle brief first; the likely engine says so, with how to confirm and a warning before pricing parts", /Likely N20 2\.0L turbo four/.test(b) && /LIKELY \(INFERRED\)|Likely \(inferred\)/i.test(b) && /To confirm:/.test(b) && /Confirm the engine( and drivetrain)? before pricing parts/.test(b) && /8-speed automatic/.test(b), b.slice(0, 600));
  }
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
  // Estimate page: the policies are one labelled disclosure on phones, open on desktop; nothing is removed.
  for (const width of [390, 1280]) {
    await C.p.setViewport(width === 390 ? { width: 390, height: 844, isMobile: true, hasTouch: true } : { width: 1280, height: 900 });
    await C.p.goto(C.p.url(), { waitUntil: "networkidle0" });
    const e = await C.p.evaluate(() => {
      const d = [...document.querySelectorAll("details")].find((x) => /Before you book/.test(x.querySelector("summary")?.innerText ?? ""));
      const visibleText = document.body.innerText;
      return { hasDetails: Boolean(d && d.offsetParent), open: d?.open ?? null, inDom: /If something goes wrong/.test(document.body.textContent), policiesVisible: /If something goes wrong/.test(visibleText), bookVisible: [...document.querySelectorAll("a")].some((a) => /^Review verification and book/.test(a.innerText.trim()) && a.offsetParent) };
    });
    ok(`estimate @${width}: ${width === 390 ? "'Before you book' collapsed" : "policies open"}, action in view, nothing removed`, e.inDom && e.bookVisible && (width === 390 ? e.hasDetails && e.open === false && !e.policiesVisible : e.policiesVisible && !e.hasDetails), JSON.stringify(e));
  }
  await C.p.setViewport({ width: 1280, height: 900 });
  // The mechanic's public profile bar at phone width: price and next opening fully visible, never under the button.
  const slugRow = await psql(`select data->>'slug' from ${T('mechanics')} id='${mechId}'`);
  for (const width of [390, 360]) {
    await C.p.setViewport({ width, height: 844, isMobile: true, hasTouch: true });
    await go(C.p, `/mechanics/${slugRow}`);
    const bar = await C.p.evaluate(() => {
      const bar = [...document.querySelectorAll("div")].find((x) => getComputedStyle(x).position === "fixed" && x.getBoundingClientRect().bottom >= innerHeight - 1 && /Request estimate/.test(x.innerText));
      if (!bar) return null;
      const btn = [...bar.querySelectorAll("a")].find((a) => /Request estimate/.test(a.innerText));
      const texts = [...bar.querySelectorAll("p")].map((x) => ({ right: x.getBoundingClientRect().right, clipped: x.scrollWidth > x.clientWidth + 1 }));
      const bb = btn.getBoundingClientRect();
      return { overlap: texts.some((t) => t.right > bb.left + 1), clipped: texts.some((t) => t.clipped), btnH: Math.round(bb.height), pad: parseFloat(getComputedStyle(bar).paddingBottom), over: document.documentElement.scrollWidth - innerWidth };
    });
    ok(`profile bar @${width}: price and next opening legible, not under the button`, bar && !bar.overlap && !bar.clipped && bar.btnH >= 44 && bar.pad >= 12 && bar.over <= 0, JSON.stringify(bar));
  }
  await C.p.setViewport({ width: 1280, height: 900 });
  await go(C.p, `/customer/quotes/${quoteId}`);
  ok("estimate: the car's details and what isn't confirmed, before booking (not a block)", /Your car's engine( and drivetrain)? (isn't|aren't) confirmed/.test(await main(C.p)) && /Add your VIN to confirm/.test(await main(C.p)), (await main(C.p)).slice(0, 800));
  await act(C.p, /^Review verification and book/, "a");
  ok("booking step repeats the vehicle warning", /Your car's engine( and drivetrain)? (isn't|aren't) confirmed/.test(await main(C.p)));
  ok(`booking step (${path(C.p)})`, path(C.p) === `/customer/quotes/${quoteId}/book`);
  ok("acknowledgement unticked", await C.p.$eval('input[name="acknowledge"]', (x) => !x.checked));
  {
    const t = await main(C.p);
    ok("booking step states plainly what Clutch hasn't verified (no generic badge)", /Identity not verified by Clutch/.test(t) && /Insurance not verified by Clutch/.test(t) && !/\bTrusted\b/.test(t), t.slice(0, 600));
  }
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
  ok("booking keeps the acknowledgement record, with the exact statements shown", rec && rec.fullyVerified === false && rec.acknowledgement?.version === "unverified-booking/2026-09-27.1" && rec.checks?.length === 4 && rec.checks.every((c) => /not verified by Clutch/.test(c.statement ?? "")) && rec.acknowledgement.disclosure.includes("- Identity not verified by Clutch"), JSON.stringify(rec));
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
  // Stored (the confirmation time is recorded) and shown (the shared status moves to Scheduled).
  const confirmedAt = await psql(`select coalesce(data->>'confirmedAt', '') from ${T('jobs')} id='${jobId}'`);
  ok(`appointment confirmed (confirmedAt ${confirmedAt || "missing"})`, Boolean(confirmedAt) && /Step 4 of 6 · Scheduled/.test(await main(M.p)), (await main(M.p)).slice(0, 300));
  await mstep("check in and start", () => click(M.p, /^Check in and start/, "button"), (x) => x === "in_progress");
  await mstep("share what they found (matches the estimate)", async () => {
    await set(M.p, 'textarea[name="note"]', "Front pads at 2 mm, rotors scored. Same work as the estimate.");
    await click(M.p, /^Share with /, "button");
  }, (x) => x === "in_progress");
  ok("diagnosis stored", /Front pads at 2 mm/.test(await psql(`select data::text from ${T('jobs')} id='${jobId}'`)));
  await go(M.p, `/mechanic/jobs/${jobId}`);
  await chooseFile(M.p, 'input[type="file"][multiple][accept^="image/*"]', FILES.svg);
  ok("repair photo: SVG refused", /doesn't accept web pages, SVG images or scripts/.test(await alertText(M.p)), await alertText(M.p));
  await chooseFile(M.p, 'input[type="file"][multiple][accept^="image/*"]', FILES.png);
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
  // ============================================================ 10. a request nobody fits yet waits, then reaches a mechanic exactly once
  // The live case of 2026-09-26: a real mechanic whose profile (from older onboarding) had no service
  // area and a stray demo flag. The customer's request is saved; setting the area sends it on, once.
  if (store !== "snapshot") {
    console.log("SKIP  waiting-request dispatch: runs on the snapshot store (what production uses)");
  } else {
    // Long Beach is ~21 mi from our mechanic's Mid-City base (15 mi radius): nobody reaches it yet.
    await go(C2.p, "/customer/requests/new?repair=starters&make=BMW&area=long-beach");
    const step = (n) => C2.p.waitForFunction((n) => document.body.innerText.includes(`Step ${n} of 4`), { timeout: 20000 }, n);
    await click(C2.p, /^Continue/, "button"); await step(2);
    await C2.p.type("textarea", "Clicks but won't crank on cold mornings.");
    await click(C2.p, /^Starts normally|^Won.t start|^Doesn.t start/, "label"); await sleep(200);
    await click(C2.p, /^Continue/, "button"); await step(3);
    await click(C2.p, /^Continue/, "button"); await step(4);
    await click(C2.p, /this week|flexible/i, "label"); await sleep(600);
    const send2 = await C2.p.evaluate(() => [...document.querySelectorAll("button")].filter((x) => x.offsetParent).map((x) => x.innerText.trim()).find((x) => /^Send|^Save/.test(x)));
    await act(C2.p, new RegExp(`^${(send2 ?? "Send").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "button");
    const waitId = path(C2.p).split("?")[0].split("/").pop();
    t = await main(C2.p);
    const matched = async () => JSON.parse((await psql(`select data->'matchedMechanicIds' from ${T('requests')} id='${waitId}'`)) || "null");
    ok(`starter request saved while no mechanic fits (${waitId})`, /^req-/.test(waitId) && !errPage(t) && (await matched())?.length === 0 && (await psql(`select data->>'status' from ${T('requests')} id='${waitId}'`)) === "open", t.slice(0, 400));
    await C2.p.screenshot({ path: `${OUT}15-waiting-request-1280.png`, fullPage: true });
    // Make our mechanic's record look like the legacy one: starters offered, no area, the old flag.
    await sql`update app_records set data = (data - 'neighborhood') || '{"isDemo": true}'::jsonb || jsonb_build_object('declaredRepairCategories', (data->'declaredRepairCategories') || '["starters"]'::jsonb) where scope = 'live' and collection = 'mechanics' and id = ${mechId}`;
    await sql`update app_meta set version = version + 1 where key = 'main'`;
    const mechUser = await psql(`select data->>'userId' from ${T('mechanics')} id='${mechId}'`);
    const notes = async () => Number(await psql(`select count(*) from ${T('notifications')} data->>'userId'='${mechUser}' and data->>'href'='/mechanic/requests/${waitId}'`));
    await go(M2.p, "/mechanic");
    t = await M2.p.evaluate(() => document.getElementById("ready-title")?.innerText ?? "");
    ok("mechanic home: the service area is the required next step", t === "Add your service area to start receiving requests.", t);
    await M2.p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await M2.p.reload({ waitUntil: "networkidle0" });
    await M2.p.screenshot({ path: `${OUT}16-needs-area-390.png`, fullPage: true });
    await M2.p.setViewport({ width: 1280, height: 900 });
    await M2.p.reload({ waitUntil: "networkidle0" });
    ok("…nothing sent to them yet", (await matched()).length === 0 && (await notes()) === 0);
    await act(M2.p, /^Set area/, "a");
    ok(`"Set area" opens the profile editor (${path(M2.p)})`, path(M2.p).startsWith("/mechanic/onboarding"));
    const publish = async (P) => {
      for (let i = 0; i < 8 && path(P).startsWith("/mechanic/onboarding"); i++) {
        const more = await P.evaluate(() => [...document.querySelectorAll("button")].some((x) => x.innerText.trim().startsWith("Continue") && x.offsetParent));
        if (more) { await click(P, /^Continue/, "button"); await sleep(400); continue; }
        const label = await P.evaluate(() => [...document.querySelectorAll("form button:not([type=button])")].filter((x) => x.offsetParent).map((x) => x.innerText.trim()).filter(Boolean).at(-1));
        await act(P, new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "button");
      }
    };
    await set(M2.p, 'select[name="neighborhood"]', "long-beach");
    await publish(M2.p);
    ok(`area saved → ${path(M2.p)}`, path(M2.p).startsWith("/mechanic") && !path(M2.p).startsWith("/mechanic/onboarding"), await main(M2.p));
    ok("the waiting request went to them, once", JSON.stringify(await matched()) === JSON.stringify([mechId]), JSON.stringify(await matched()));
    ok("one notification for it", (await notes()) === 1, String(await notes()));
    ok("the stray demo flag is gone from the real profile", (await psql(`select coalesce(data->>'isDemo', 'absent') from ${T('mechanics')} id='${mechId}'`)) === "absent");
    const sees = async (p) => { await go(p, "/mechanic/requests"); const x = await main(p); return /won.t crank/i.test(x) && (await p.evaluate((id) => Boolean(document.querySelector(`a[href="/mechanic/requests/${id}"]`)), waitId)); };
    ok("it's in their Requests", await sees(M2.p));
    await M2.p.reload({ waitUntil: "networkidle0" });
    ok("…after a refresh", /won.t crank/i.test(await main(M2.p)));
    await logout(M2.p);
    const M3 = await ctx("mechanic-3");
    await login(M3.p, MECH);
    ok("…and after logging in again", await sees(M3.p));
    await M3.p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await M3.p.reload({ waitUntil: "networkidle0" });
    await M3.p.screenshot({ path: `${OUT}17-dispatched-390.png`, fullPage: true });
    await M3.p.setViewport({ width: 1280, height: 900 });
    await M3.p.reload({ waitUntil: "networkidle0" });
    // Saving the profile again never sends it twice.
    await go(M3.p, "/mechanic/onboarding?edit=1");
    await publish(M3.p);
    ok("saving the profile again: still sent once, one notification", JSON.stringify(await matched()) === JSON.stringify([mechId]) && (await notes()) === 1, `${JSON.stringify(await matched())} ${await notes()}`);
    ok("the demo never sees it", (await psql(`select count(*) from app_records where scope='demo' and (id='${waitId}' or data::text like '%${waitId}%')`)) === "0");
  }
  // ============================================================ 11. verification: identity (test provider), insurance, review, revoke
  {
    const V = await ctx("mechanic-verify");
    await login(V.p, MECH);
    const idRec = () => sql.unsafe(store === "normalized" ? `select data from lv_verifications where mechanic_id='${mechId}' and category='identity' order by created_at desc` : `select data from app_records where scope='live' and collection='verifications' and data->>'mechanicId'='${mechId}' and data->>'category'='identity'`).then((rows) => rows.map((r) => r.data).filter((d) => !d.supersededBy));
    const finishTest = async (outcome, webhook, name = MECH.name) => {
      await V.p.waitForFunction(() => location.pathname.startsWith("/verification-test/identity/"), { timeout: 20000 });
      ok(`hosted test page says it isn't a real check (${outcome})`, /not a real identity check/i.test(await main(V.p)));
      await V.p.evaluate((o, w, n) => {
        document.querySelector(`input[name="outcome"][value="${o}"]`).click();
        document.querySelector(`input[name="webhook"][value="${w}"]`).click();
        const f = document.querySelector('input[name="nameOnId"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(f, n);
      }, outcome, webhook, name);
      await act(V.p, /^Finish$/, "button");
      await V.p.waitForFunction(() => location.pathname === "/mechanic/verification", { timeout: 30000 });
    };
    const startId = async () => {
      await go(V.p, "/mechanic/verification");
      await act(V.p, /^(Verify your identity|Continue identity check|Try again|Start a new check)/, "button");
    };
    await V.p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await go(V.p, "/mechanic/verification");
    t = await main(V.p);
    ok("verification center @390: every check says what it is and its status", /Identity not verified by Clutch/.test(t) && /Insurance not verified by Clutch/.test(t) && /Background check/.test(t) && /Phone/.test(t) && (await V.p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, t.slice(0, 400));
    await V.p.screenshot({ path: `${OUT}20-verification-390.png`, fullPage: true });
    // Cancelled, and the webhook never arrives: the return page asks the provider itself.
    await startId();
    await finishTest("cancelled", "skip");
    ok("cancelled with no webhook: recovered on return, nothing claimed", /You left before finishing/.test(await main(V.p)) && (await idRec())[0]?.status === "not_started", JSON.stringify((await idRec())[0]?.status));
    // Selfie mismatch: told what to change.
    await startId();
    await finishTest("selfie_mismatch", "once");
    t = await main(V.p);
    ok("selfie mismatch → needs more information, with what to change", (await idRec())[0]?.status === "needs_more_info" && /selfie/i.test(t), t.slice(0, 400));
    // Retry: verified, the webhook delivered twice.
    await startId();
    await finishTest("verified", "twice");
    const rec = (await idRec())[0];
    t = await main(V.p);
    ok("verified: one record, verified once despite a duplicate webhook", rec?.status === "verified" && rec.events.filter((e) => e.to === "verified" && e.from !== "verified").length === 1 && rec.events.filter((e) => e.to === "verified").length === 1 && rec.nameMatches === true, JSON.stringify(rec?.events?.map((e) => `${e.action}:${e.from}>${e.to}`)));
    ok("the center says who verified it (a test provider, not a real check)", /Identity verified by Clutch's test provider \(not a real check\)/.test(t), t.slice(0, 400));
    ok("nothing identifying stored: no ID number, date of birth, images or scores", !/(idNumber|dateOfBirth|dob|selfieUrl|documentUrl|score)/i.test(JSON.stringify(rec)));
    // Insurance with a real (private) document.
    await V.p.setViewport({ width: 1280, height: 900 });
    await go(V.p, "/mechanic/verification#insurance");
    await set(V.p, 'form select[name="policyType"]', "general_liability");
    await set(V.p, 'form input[name="carrier"]', "Fixture Mutual");
    await set(V.p, 'form input[name="namedInsured"]', MECH.name);
    await set(V.p, 'form input[name="effectiveOn"]', "2026-01-01");
    await set(V.p, 'form input[name="expiresOn"]', "2027-06-30");
    await chooseFile(V.p, '#insurance input[type="file"]', FILES.pdf);
    ok("certificate stored privately", /stored privately/.test(await main(V.p)), await alertText(V.p));
    await act(V.p, /^Submit for review$/, "button");
    const insRow = async () => (await sql.unsafe(store === "normalized" ? `select data from lv_verifications where mechanic_id='${mechId}' and category='insurance'` : `select data from app_records where scope='live' and collection='verifications' and data->>'mechanicId'='${mechId}' and data->>'category'='insurance'`)).map((r) => r.data).at(-1);
    let ins = await insRow();
    ok("insurance submitted with its document and details", ins?.status === "submitted" && ins.documentIds?.length === 1, JSON.stringify(ins));
    const docId = ins.documentIds[0];
    ok("the document is refused to anyone but its uploader (a customer: 404)", (await fetchAs(C2.p, `/api/media/${docId}`)).status === 404);
    const G2 = await ctx("guest-2");
    await go(G2.p, "/");
    ok("…and to a signed-out visitor", (await fetchAs(G2.p, `/api/media/${docId}`)).status === 404);
    ok("the uploader can open their own document", (await fetchAs(V.p, `/api/media/${docId}`)).status === 200);
    // Staff review.
    const STAFF = { name: "Reviewer Fixture", email: "reviewer@example.test", password: `Fixture-${RUN}-rv` };
    const A = await ctx("admin");
    await go(A.p, "/signup?role=customer");
    await set(A.p, 'form input[name="name"]', STAFF.name);
    await set(A.p, 'form input[name="email"]', STAFF.email);
    await set(A.p, 'form input[name="password"]', STAFF.password);
    await act(A.p, /^Create account$/, "button");
    await confirmFromMailbox(A.p, STAFF.email);
    ok("a plain admin session can't open the document without a review link", (await fetchAs(A.p, `/api/media/${docId}`)).status === 404);
    for (const w of [390, 1280]) {
      await A.p.setViewport(w === 390 ? { width: 390, height: 844, isMobile: true, hasTouch: true } : { width: 1280, height: 900 });
      await go(A.p, `/admin/reviews/${ins.id}`);
      t = await main(A.p);
      ok(`admin review @${w}: evidence, history and structured actions`, /Fixture Mutual/.test(t) && /History/.test(t) && /Record decision/.test(t) && /Named insured/.test(t) && (await A.p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, t.slice(0, 500));
      await A.p.screenshot({ path: `${OUT}21-admin-review-${w}.png`, fullPage: true });
    }
    const link = await A.p.evaluate(() => [...document.querySelectorAll('a[href*="/api/media/"]')].map((a) => a.getAttribute("href"))[0]);
    ok(`review link is short-lived and private (${(link ?? "").replace(/vt=.*/, "vt=…")})`, /\?vt=\d+\.[0-9a-f]{64}$/.test(link ?? ""));
    const opened = await fetchAs(A.p, link);
    ok("the reviewer opens it through the link, never cached", opened.status === 200 && /no-store/.test(opened.h["cache-control"] ?? ""), JSON.stringify(opened));
    ok("the same link is useless to anyone else, and a tampered one to the reviewer too", (await fetchAs(C2.p, link)).status === 404 && (await fetchAs(G2.p, link)).status === 404 && (await fetchAs(A.p, link.replace(/vt=\d+/, "vt=1"))).status === 404);
    // Approve without a reason is refused by the form (required); with one, it's recorded.
    await A.p.evaluate(() => document.querySelector('input[name="action"][value="approve"]').click());
    await set(A.p, 'select[name="reasonCode"]', "evidence_matches");
    await act(A.p, /^Record decision$/, "button");
    ins = await insRow();
    ok("approved, with the reviewer and reason in the history", ins?.status === "verified" && ins.events.some((e) => e.action === "approved" && e.reasonCodes?.includes("evidence_matches") && e.actor.kind === "staff"), JSON.stringify(ins?.events?.map((e) => e.action)));
    const slug = await psql(`select data->>'slug' from ${T('mechanics')} id='${mechId}'`);
    for (const w of [390, 1280]) {
      await C2.p.setViewport(w === 390 ? { width: 390, height: 844, isMobile: true, hasTouch: true } : { width: 1280, height: 900 });
      await go(C2.p, `/mechanics/${slug}`);
      t = await main(C2.p);
      ok(`customer profile @${w}: each check shown on its own, no generic badge`, /Identity: Verified/.test(t) && /Insurance: Verified/.test(t) && /Background check: Not completed/.test(t) && !/\bTrusted\b/.test(t), t.slice(0, 600));
      await C2.p.screenshot({ path: `${OUT}22-profile-verified-${w}.png`, fullPage: false });
    }
    const opens = await C2.p.evaluate(() => [...document.querySelectorAll("button[aria-haspopup=dialog]")].find((b) => /Insurance/.test(b.getAttribute("aria-label") ?? ""))?.click());
    await sleep(300);
    t = await C2.p.evaluate(() => document.querySelector("dialog[open]")?.innerText ?? "");
    ok("insurance evidence: who, when, what it means, what Clutch checked", /Insurance verified by Clutch staff on/.test(t) && /What this means/i.test(t) && /What Clutch checked/i.test(t), `${opens} ${t.slice(0, 400)}`);
    // Revoke: gone from every positive claim at once.
    await go(A.p, `/admin/reviews/${ins.id}`);
    await set(A.p, 'select[name="reasonCode"]', "policy_cancelled");
    await set(A.p, 'textarea[name="note"]', "The carrier says this policy was cancelled.");
    await act(A.p, /^Record decision$/, "button");
    ins = await insRow();
    await go(C2.p, `/mechanics/${slug}`);
    await C2.p.evaluate(() => [...document.querySelectorAll("button[aria-haspopup=dialog]")].find((b) => /Insurance/.test(b.getAttribute("aria-label") ?? ""))?.click());
    await sleep(300);
    t = await C2.p.evaluate(() => document.querySelector("dialog[open]")?.innerText ?? document.body.innerText);
    ok("revoked: the profile no longer claims insurance", ins?.status === "revoked" && /Insurance not verified by Clutch|hasn't verified/.test(t), `${ins?.status} ${t.slice(0, 300)}`);
    await go(V.p, "/mechanic/notifications");
    ok("the mechanic was told, with the reason", /Insurance: verification withdrawn/.test(await main(V.p)) && /cancelled/i.test(await main(V.p)));
  }

  // ============================================================ 12. vehicles: 2008 BMW 135i, 6-speed manual; VIN conflict; VIN-decoded; persistence
  {
    const P = C2.p;
    const vehRow = async () => JSON.parse((await psql(`select data from ${T('vehicles')} data->>'model'='135i'`)) || "null");
    await P.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await go(P, "/customer/vehicles?add=1");
    await combo(P, "Year", "2008");
    await combo(P, "Make", "BMW");
    // Only models that existed for a 2008 BMW are offered.
    const offered = await P.evaluate(async () => (await (await fetch("/api/vehicles?step=models&year=2008&make=BMW")).json()).models);
    ok(`models are limited to the year and make (${offered.length}: ${offered.slice(0, 6).join(", ")}…)`, offered.includes("135i") && !offered.includes("330i") && !offered.includes("M2"), JSON.stringify(offered));
    await combo(P, "Model", "135i");
    await chip(P, "Body style", "Coupe");
    await chip(P, "Transmission", "6-speed manual");
    await set(P, 'form input[name="mileage"]', "94000");
    await act(P, /^(Save|Add) (vehicle|car)/i, "button");
    let v = await vehRow();
    ok(`2008 135i saved: engine ${v?.spec?.engine?.code} ${v?.spec?.engine?.status}, ${v?.spec?.transmission?.label} ${v?.spec?.transmission?.status}`, v?.spec?.engine?.code === "N54" && v.spec.engine.status === "likely" && v.spec.transmission?.id === "6MT" && v.spec.transmission.status === "selected" && v.spec.body?.status === "selected", JSON.stringify(v?.spec));
    t = await P.evaluate(() => document.querySelector('section[aria-label="Vehicle"]')?.innerText ?? "");
    ok("vehicle page @390: N54 shown as likely with how to confirm; manual as the customer's choice; no VIN yet", /Likely N54 3\.0L twin-turbo inline-six/.test(t) && /To confirm:/.test(t) && /6-speed manual/.test(t) && /No VIN yet/.test(t) && (await P.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, t.slice(0, 500));
    await P.screenshot({ path: `${OUT}30-vehicle-135i-390.png`, fullPage: true });
    // A VIN that disagrees (it's a 128i): flagged in the picker; saved, both are kept and shown.
    await go(P, `/customer/vehicles/${v.id}?edit=1#edit`);
    await P.evaluate(() => document.querySelectorAll("form details").forEach((d) => (d.open = true)));
    await P.type('input[aria-label="VIN"]', "WBAUP93558VF00128");
    await click(P, /Look up VIN/, "button");
    await P.waitForFunction(() => /This VIN is a/.test(document.body.innerText), { timeout: 20000 });
    ok("a disagreeing VIN is flagged before saving", /doesn't match what you picked \(2008 BMW 135i\)/.test(await main(P)), (await main(P)).slice(0, 400));
    await act(P, /^Save/, "button");
    v = await vehRow();
    ok("saved with the conflict recorded; the selections and the likely engine are kept, not overwritten", v?.model === "135i" && v.spec?.vin?.conflicts?.some((c) => /VIN says 128i/.test(c)) && v.spec.engine?.status === "likely", JSON.stringify(v?.spec?.vin));
    ok("the conflict is shown, and the VIN isn't called decoded", /The VIN and the selections disagree/.test(await main(P)) && /VIN on file doesn't match/.test(await main(P)) && !/VIN-decoded/.test(await P.evaluate(() => document.querySelector('section[aria-label="Vehicle"]')?.innerText ?? "")));
    // The right VIN: confirmed, VIN-decoded, the correction history kept.
    await go(P, `/customer/vehicles/${v.id}?edit=1#edit`);
    await P.evaluate(() => document.querySelectorAll("form details").forEach((d) => (d.open = true)));
    await P.waitForSelector('input[aria-label="VIN"]', { visible: true, timeout: 20000 });
    // Replace the old VIN like a person would: select it all, delete, type the new one.
    await P.$eval('input[aria-label="VIN"]', (el) => { el.focus(); el.select(); });
    await P.keyboard.press("Backspace");
    await P.type('input[aria-label="VIN"]', "WBAUC73508VF00135");
    await P.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Look up VIN/.test(b.innerText) && !b.disabled), { timeout: 20000 }).catch(async () => {
      throw new Error(`VIN field holds "${await P.$eval('input[aria-label="VIN"]', (el) => el.value)}"`);
    });
    await click(P, /Look up VIN/, "button");
    await P.waitForFunction(() => /This VIN is a 2008 BMW 135i/.test(document.body.innerText), { timeout: 20000 });
    await click(P, /Yes, that.s my car/, "button");
    await act(P, /^Save/, "button");
    v = await vehRow();
    ok(`VIN-decoded: engine ${v?.spec?.engine?.status}, drive ${v?.spec?.drivetrain?.status}, no conflicts, corrections kept (${v?.spec?.corrections?.length})`, v?.spec?.engine?.status === "vin_confirmed" && v.spec.vin.status === "decoded" && v.spec.vin.conflicts.length === 0 && v.spec.corrections?.some((c) => c.field === "engine" && c.from.status === "likely" && c.to.status === "vin_confirmed"), JSON.stringify(v?.spec?.corrections));
    ok("the full VIN is stored only on the vehicle; the spec keeps the last six", v.vin === "WBAUC73508VF00135" && v.spec.vin.last6 === "F00135" && !JSON.stringify(v.spec).includes("WBAUC73508"));
    await P.reload({ waitUntil: "networkidle0" });
    ok("after a refresh: VIN-decoded", /VIN-decoded/.test(await main(P)) && /N54 3\.0L twin-turbo inline-six/.test(await main(P)));
    await logout(P);
    const C3 = await ctx("customer-3");
    await login(C3.p, CUST);
    for (const w of [1280, 390]) {
      await C3.p.setViewport(w === 390 ? { width: 390, height: 844, isMobile: true, hasTouch: true } : { width: 1280, height: 900 });
      await go(C3.p, `/customer/vehicles/${v.id}`);
      t = await C3.p.evaluate(() => document.querySelector('section[aria-label="Vehicle"]')?.innerText ?? "");
      ok(`after logging in again @${w}: the same VIN-decoded car`, /VIN-decoded/.test(t) && /N54/.test(t) && !/Likely N54/.test(t) && (await C3.p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, t.slice(0, 300));
      await C3.p.screenshot({ path: `${OUT}31-vehicle-135i-vin-${w}.png`, fullPage: true });
    }
    ok("the car is only in the live marketplace", (await psql(`select count(*) from app_records where scope='demo' and collection='vehicles' and (data->>'vin'='WBAUC73508VF00135' or id='${v.id}')`)) === "0");
  }

  ok("nothing reached the demo scope", await psql(`select count(*) from app_records where scope='demo' and (data->>'email' in ('${CUST.email}','${MECH.email}') or id in ('${reqId}','${jobId}'))`) === "0");
  ok("no delivery was attempted (no provider configured)", await psql(`select count(*) from delivery_attempts where outcome='sent'`) === "0");

  console.log(`\n${checks} checks, ${fails ? `${fails} FAILED` : "ALL PASSED"}`);
  await b.close();
  await sql.end({ timeout: 5 });
  return fails;
}
