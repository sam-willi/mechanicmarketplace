// The demo marketplace in a browser at 390 px (360 where it's tight) and desktop: the header and
// banner, the mechanic profile bar, estimates that can all be booked, the estimate page's
// "Before you book", the demo picker, leaving the demo before real sign-up, onboarding's location
// step, repair/make picker and optional step (with resume), the mechanic readiness card, and the
// request form's required labels. Run by scripts/test-browser.mjs with demo logins on.
import puppeteer from "puppeteer-core";
import postgres from "postgres";
import { mkdirSync } from "node:fs";

export async function run({ base, db, chrome, out }) {
  const OUT = out.endsWith("/") ? out : `${out}/`;
  mkdirSync(OUT, { recursive: true });
  const sql = postgres(db, { prepare: false, max: 2, onnotice: () => undefined });
  const b = await puppeteer.launch({ executablePath: chrome, headless: true, protocolTimeout: 120000, args: process.platform === "linux" ? ["--no-sandbox"] : [] });
  let fails = 0, checks = 0;
  const ok = (l, c, x = "") => { checks++; if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"}  [demo-ui] ${l}${!c && x ? `  [${String(x).replace(/\s+/g, " ").slice(0, 500)}]` : ""}`); return c; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function page(label) {
    const p = await (await b.createBrowserContext()).newPage();
    p.setDefaultTimeout(30000);
    p.setDefaultNavigationTimeout(45000);
    p.on("pageerror", (e) => { fails++; console.log(`PAGEERROR (${label})`, e.message); });
    (globalThis.__clutchTestPages ??= []).push({ label: `demo-${label}`, p });
    await p.setViewport({ width: 1280, height: 900 });
    return p;
  }
  const view = (p, w) => p.setViewport(w < 700 ? { width: w, height: 844, isMobile: true, hasTouch: true } : { width: w, height: 900 });
  const go = (p, url) => p.goto(base + url, { waitUntil: "networkidle0" });
  const over = (p) => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  async function signIn(p, name) {
    await go(p, "/demo");
    const h = await p.evaluateHandle((n) => [...document.querySelectorAll("button")].find((x) => x.innerText.includes(n) && x.offsetParent) ?? null, name);
    if (!(await h.evaluate((x) => Boolean(x)))) {
      await p.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
    }
    const h2 = await p.evaluateHandle((n) => [...document.querySelectorAll("button")].find((x) => x.innerText.includes(n) && x.offsetParent), name);
    await Promise.all([p.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}), h2.click()]);
  }

  // ---- the demo picker (390 and desktop)
  const pk = await page("picker");
  for (const w of [390, 1280]) {
    await view(pk, w);
    await go(pk, "/demo");
    const d = await pk.evaluate(() => {
      const main = document.querySelector("main");
      const visibleButtons = [...main.querySelectorAll("button")].filter((x) => x.checkVisibility());
      const more = [...main.querySelectorAll("details")].find((x) => /More demo scenarios/.test(x.querySelector("summary")?.innerText ?? ""));
      return { primary: visibleButtons.map((x) => x.innerText.split("\n")[1] ?? "").filter(Boolean).slice(0, 2), buttons: visibleButtons.length, moreClosed: more ? !more.open : false, words: main.innerText.split(/\s+/).length, real: /Create a real account/.test(main.innerText) };
    });
    ok(`picker @${w}: Maya and Derek first, the rest under "More demo scenarios", a real-account option apart`, d.buttons === 2 && d.moreClosed && d.real && d.words < 120, JSON.stringify(d));
    ok(`picker @${w}: fits`, (await over(pk)) <= 0);
    await pk.screenshot({ path: `${OUT}demo-picker-${w}.png`, fullPage: true });
  }

  // ---- real sign-up from inside the demo: leave the demo first
  await signIn(pk, "Maya Chen");
  await view(pk, 390);
  await go(pk, "/signup?role=customer");
  let t = await pk.evaluate(() => ({ form: Boolean(document.querySelector('form input[name="password"]')), text: document.body.innerText }));
  ok("sign-up from the demo: no account form inside the demo, a clear way out", !t.form && /Leave the demo and sign up/.test(t.text) && /Real accounts are separate from the demo/.test(t.text), t.text.slice(0, 400));
  await pk.screenshot({ path: `${OUT}signup-from-demo-390.png`, fullPage: true });
  const leave = await pk.evaluateHandle(() => [...document.querySelectorAll("button")].find((x) => /Leave the demo and sign up/.test(x.innerText)));
  await Promise.all([pk.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}), leave.click()]);
  t = await pk.evaluate(() => ({ path: location.pathname + location.search, banner: Boolean(document.querySelector('[aria-label="Demo mode"]')), form: Boolean(document.querySelector('form input[name="password"]')) }));
  ok("…then the real sign-up form, with no demo banner", t.path.startsWith("/signup") && t.path.includes("role=customer") && !t.banner && t.form, JSON.stringify(t));

  // ---- Derek as a customer: header and banner at 390/360; his profile bar
  const d = await page("derek");
  await signIn(d, "Derek Hall");
  await go(d, "/customer/mechanics?repair=brakes&make=BMW");
  for (const w of [390, 360]) {
    await view(d, w);
    await d.reload({ waitUntil: "networkidle0" });
    const h = await d.evaluate(() => {
      const btn = [...document.querySelectorAll('button[aria-haspopup="menu"][aria-label^="Account"]')].find((x) => x.offsetParent);
      const header = btn.closest("header");
      const targets = [...header.querySelectorAll("a, button")].filter((x) => x.offsetParent).map((x) => Math.round(x.getBoundingClientRect().height));
      const banner = document.querySelector('[aria-label="Demo mode"]');
      const links = [...banner.querySelectorAll("a, button")].map((x) => ({ h: Math.round(x.getBoundingClientRect().height), clipped: x.scrollWidth > x.clientWidth + 1 }));
      return { text: btn.innerText.replace(/\s+/g, " "), clipped: [...btn.querySelectorAll("span")].some((x) => x.scrollWidth > x.clientWidth + 1), right: btn.getBoundingClientRect().right, vw: innerWidth, minTarget: Math.min(...targets), bannerH: banner.getBoundingClientRect().height, links };
    });
    ok(`header @${w}: "Customer" in full, every target ≥44px, fits`, /Customer/.test(h.text) && !h.clipped && h.right <= h.vw && h.minTarget >= 44 && (await over(d)) <= 0, JSON.stringify(h));
    ok(`demo banner @${w}: one line, links 44px and readable`, h.bannerH <= 48 && h.links.every((l) => l.h >= 44 && !l.clipped), JSON.stringify(h));
    await go(d, "/mechanics/derek-hall");
    const bar = await d.evaluate(() => {
      const bar = [...document.querySelectorAll("div")].find((x) => getComputedStyle(x).position === "fixed" && x.getBoundingClientRect().bottom >= innerHeight - 1 && /Request estimate/.test(x.innerText));
      const btn = [...bar.querySelectorAll("a")].find((a) => /Request estimate/.test(a.innerText)).getBoundingClientRect();
      return { ps: [...bar.querySelectorAll("p")].map((x) => ({ right: x.getBoundingClientRect().right, clipped: x.scrollWidth > x.clientWidth + 1 })), left: btn.left, h: btn.height };
    });
    ok(`profile bar @${w}: price and next opening beside the button, not under it`, bar.ps.every((p) => !p.clipped && p.right <= bar.left + 1) && bar.h >= 44, JSON.stringify(bar));
    await go(d, "/customer/mechanics?repair=brakes&make=BMW");
  }

  // ---- Maya: every estimate can be booked; the estimate page at 390 and desktop; request form step 2
  const m = await page("maya");
  await signIn(m, "Maya Chen");
  for (const w of [390, 1280]) {
    await view(m, w);
    await go(m, "/customer/requests/req-maya-bmw");
    t = await m.evaluate(() => document.querySelector("main").innerText);
    ok(`Maya's BMW request @${w}: Derek, Marcus and Samuel compared, none unbookable`, !/Can't be booked/.test(t) && /Marcus/.test(t) && /Samuel/.test(t), t.slice(0, 500));
    await go(m, "/customer/quotes/quote-samuel-bmw");
    const q = await m.evaluate(() => { const d = [...document.querySelectorAll("details")].find((x) => /Before you book/.test(x.querySelector("summary")?.innerText ?? "")); return { details: Boolean(d && d.offsetParent), open: d?.open ?? null, inDom: /If something goes wrong/.test(document.body.textContent), visible: /If something goes wrong/.test(document.body.innerText), action: [...document.querySelectorAll("a,button")].some((x) => /^(Review verification and book|Accept and book) Samuel/.test(x.innerText.trim()) && x.offsetParent) }; });
    ok(`estimate @${w}: ${w === 390 ? "policies behind 'Before you book'" : "policies open"}, action in view, nothing removed`, q.inDom && q.action && (w === 390 ? q.details && q.open === false && !q.visible : q.visible), JSON.stringify(q));
  }
  await view(m, 390);
  await go(m, "/customer/requests/new?new=1");
  await m.evaluate(() => [...document.querySelectorAll("button")].find((x) => /^Continue/.test(x.innerText.trim()) && x.offsetParent)?.click());
  await m.waitForFunction(() => document.body.innerText.includes("Step 2 of 4"), { timeout: 20000 }).catch(() => {});
  t = await m.evaluate(() => [...document.querySelectorAll("legend")].map((l) => l.innerText.replace(/\s+/g, " ")).join(" | ") + " || " + document.querySelector("main").innerText.slice(0, 600));
  ok("request step 2: both questions marked Required before Continue, with an example", /What is the car doing\? ?Required/i.test(t) && /Does it start and drive\? ?Required/i.test(t) && /For example: “Grinding from the front/.test(t), t);
  await m.screenshot({ path: `${OUT}request-step2-390.png`, fullPage: true });

  // ---- Marcus: onboarding's location step, picker and optional step; resume after leaving
  const mk = await page("marcus");
  await signIn(mk, "Marcus Webb");
  await view(mk, 390);
  await go(mk, "/mechanic/onboarding?edit=1");
  const clickText = (p, re) => p.evaluate((src) => [...document.querySelectorAll("button")].find((x) => new RegExp(src).test(x.innerText.trim()) && x.offsetParent)?.click(), re);
  await clickText(mk, "^Continue");
  await sleep(300);
  t = await mk.evaluate(() => ({ city: Boolean(document.querySelector('[name="city"]')), area: Boolean(document.querySelector('select[name="neighborhood"]')), text: document.body.textContent }));
  ok("onboarding location: one 'Where you start from' choice plus radius, no separate City", !t.city && t.area && /Where you start from/.test(t.text) && /How far you'll travel/.test(t.text));
  ok("onboarding preview never names a place twice", !/Inglewood, Inglewood|Long Beach, Long Beach|Pasadena, Pasadena/.test(t.text));
  await clickText(mk, "^Continue");
  await sleep(300);
  const picker = await mk.evaluate(() => {
    const labels = [...document.querySelectorAll('label:has(input[name="makes"]), label:has(input[name="categories"])')];
    return { visible: labels.filter((l) => !l.hidden && l.offsetParent).length, total: labels.length, summary: document.body.innerText.match(/\d+ repairs? · \d+ makes? selected/)?.[0] ?? "", search: Boolean(document.querySelector('input[type="search"]')), prices: Boolean(document.querySelector('[name="hourlyRate"]')?.offsetParent) };
  });
  ok(`services and makes: a summary, search, and ${picker.visible} of ${picker.total} choices shown at once; prices still visible`, picker.visible <= 18 && picker.total === 27 && Boolean(picker.summary) && picker.search && picker.prices, JSON.stringify(picker));
  await mk.type('input[type="search"]', "Sub");
  await sleep(200);
  const found = await mk.evaluate(() => [...document.querySelectorAll('label:has(input[name="makes"])')].filter((l) => !l.hidden).map((l) => l.innerText.trim()));
  ok(`make search finds Subaru (${found.join(", ")})`, found.includes("Subaru"));
  await mk.screenshot({ path: `${OUT}onboarding-services-390.png`, fullPage: true });
  await clickText(mk, "^Continue");
  await sleep(300);
  t = await mk.evaluate(() => document.body.innerText);
  ok("step 4 is marked optional with 'Do this later'", /Experience and first proof \(optional\)/.test(t) && /Do this later/.test(t));
  await go(mk, "/mechanic");
  await go(mk, "/mechanic/onboarding?edit=1");
  t = await mk.evaluate(() => document.body.innerText);
  ok("leaving and coming back resumes step 4", /Step 4 of 6/.test(t) && /Experience and first proof/.test(t), t.slice(0, 200));

  // ---- the readiness card for an incomplete profile (Marcus without a service area, as older data had)
  const [{ id: marcusId }] = await sql`select id from app_records where scope = 'demo' and collection = 'mechanics' and data->>'slug' = 'marcus-webb'`;
  await sql`update app_records set data = data - 'neighborhood' where scope = 'demo' and collection = 'mechanics' and id = ${marcusId}`;
  await sql`update app_meta set version = version + 1 where key = 'demo'`;
  for (const w of [390, 1280]) {
    await view(mk, w);
    await go(mk, "/mechanic");
    const r = await mk.evaluate(() => {
      const card = document.querySelector('[aria-labelledby="ready-title"]');
      const opt = card ? [...card.querySelectorAll("details")].find((x) => /Verification checks \(optional\)/.test(x.innerText)) : null;
      return { next: document.getElementById("ready-title")?.innerText ?? "", optClosed: opt ? !opt.open : false, earlier: /before this step was required/.test(card?.innerText ?? ""), deciding: /estimates?: waiting on the customer/.test(document.body.innerText) };
    });
    ok(`readiness @${w}: the next action leads, checks are separate and collapsed, older estimates explained`, r.next === "Add your service area to start receiving requests." && r.optClosed && r.earlier && !r.deciding, JSON.stringify(r));
    await mk.screenshot({ path: `${OUT}readiness-${w}.png`, fullPage: true });
  }
  await sql`update app_records set data = jsonb_set(data, '{neighborhood}', '"Inglewood"') where scope = 'demo' and collection = 'mechanics' and id = ${marcusId}`;
  await sql`update app_meta set version = version + 1 where key = 'demo'`;

  console.log(`\n[demo-ui] ${checks} checks, ${fails ? `${fails} FAILED` : "ALL PASSED"}`);
  await b.close();
  await sql.end({ timeout: 5 });
  return fails;
}
