// Uploads in a browser, for the deployment's upload profile (lib/media/limits.ts): a typical
// 8–12 MB synthetic phone photo (generated in the page, never personal media) is shrunk in the
// browser, previewed, stored under the cap and viewable by its owner, at 1280 and 390 px; an
// oversized video gets useful guidance; on the hosted profile video/audio aren't offered.
import puppeteer from "puppeteer-core";
import postgres from "postgres";
import { mkdirSync } from "node:fs";

export async function run({ base, auth, db, chrome, out, profile = "full" }) {
  const OUT = out.endsWith("/") ? out : `${out}/`;
  mkdirSync(OUT, { recursive: true });
  const sql = postgres(db, { prepare: false, max: 2, onnotice: () => undefined });
  const RUN = Date.now().toString(36);
  const b = await puppeteer.launch({ executablePath: chrome, headless: true, protocolTimeout: 180000, args: process.platform === "linux" ? ["--no-sandbox"] : [] });
  let fails = 0, checks = 0;
  const ok = (l, c, x = "") => { checks++; if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"}  [uploads/${profile}] ${l}${!c && x ? `  [${String(x).replace(/\s+/g, " ").slice(0, 400)}]` : ""}`); return c; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const p = await (await b.createBrowserContext()).newPage();
  p.on("dialog", (d) => d.accept().catch(() => {}));
  p.on("pageerror", (e) => { fails++; console.log("PAGEERROR", e.message); });
  await p.setViewport({ width: 1280, height: 900 });
  p.setDefaultTimeout(30000);
  p.setDefaultNavigationTimeout(45000);
  (globalThis.__clutchTestPages ??= []).push({ label: "uploads", p });
  const go = (url) => p.goto(base + url, { waitUntil: "networkidle0" });
  const set = (sel, v) => p.$eval(sel, (el, v) => { const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, v);
  const click = async (re, sel = "button, a, label") => { const h = await p.evaluateHandle((s, f, sel) => [...document.querySelectorAll(sel)].find((x) => new RegExp(s, f).test(x.innerText.trim()) && x.offsetParent) ?? null, re.source, re.flags, sel); if (!(await h.evaluate((x) => Boolean(x)))) throw new Error(`no ${re} on ${p.url()}`); await h.click(); };
  const text = () => p.evaluate(() => document.body.innerText);

  // A customer with a car, through the real sign-up path (local auth fixture mailbox).
  const email = `uploads.${RUN}@example.test`;
  await go("/signup?role=customer");
  await set('form input[name="name"]', "Uma Uploads");
  await set('form input[name="email"]', email);
  await set('form input[name="password"]', `Fixture-${RUN}-u1`);
  await p.evaluate(() => { const d = document.querySelector("form details"); if (d) d.open = true; });
  await set('form select[name="year"]', "2016");
  await set('form select[name="make"]', "BMW");
  await set('form input[name="model"]', "328i");
  await set('form input[name="mileage"]', "71000"); // the request form requires mileage
  await Promise.all([p.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}), click(/^Create account$/, "button")]);
  const box = await (await fetch(`${auth}/__local/mailbox?email=${encodeURIComponent(email)}`)).json();
  await p.goto(box[0].link, { waitUntil: "networkidle0" });
  ok("signed in as a new customer", new URL(p.url()).pathname.startsWith("/customer"), p.url());

  // To the photos step of a request.
  await go("/customer/requests/new?repair=brakes&make=BMW&area=mid-city");
  const stepTo = (n) => p.waitForFunction((n) => document.body.innerText.includes(`Step ${n} of 4`), { timeout: 20000 }, n);
  await click(/^Continue/, "button"); await stepTo(2);
  await p.type("textarea", "Squeal from the front when braking.");
  await click(/^Starts normally/, "label"); await sleep(200);
  await click(/^Continue/, "button"); await stepTo(3);
  const t3 = await text();
  if (profile === "hosted") {
    ok("hosted: video and audio aren't offered, and the page says so", !/Record video|Record audio/.test(t3) && /Video and audio can't be uploaded on this version of Clutch yet; photos can\./.test(t3), t3.slice(0, 600));
  } else ok("full: video and audio are offered", /Record video/.test(t3) && /Record audio/.test(t3));

  /** Put a File made in the page onto the "Upload" picker, as choosing it would. */
  const choose = (make) => p.evaluate(async (makeSrc) => {
    const file = await (0, eval)(makeSrc)();
    const input = document.querySelector('input[type="file"][accept*="application/pdf"]');
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { name: file.name, type: file.type, size: file.size };
  }, make.toString());
  /** A 4032×3024 noisy photo, re-encoded until it's a typical 8–12 MB phone JPEG. */
  const bigPhoto = async () => {
    const c = document.createElement("canvas");
    c.width = 4032;
    c.height = 3024;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(c.width, c.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = (Math.random() * 255) | 0; d[i] = v; d[i + 1] = (v + ((i >> 10) & 63)) & 255; d[i + 2] = 255 - v; d[i + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = "#b00"; ctx.fillRect(0, 0, 400, 300); // a marker in the top-left corner
    for (const q of [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3]) {
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", q));
      if (blob.size <= 12e6) return new File([blob], "IMG_4521.JPG", { type: "image/jpeg" });
    }
    throw new Error("couldn't make the fixture");
  };
  const alerts = () => p.evaluate(() => [...document.querySelectorAll('[role="alert"]')].map((x) => x.innerText).join(" | "));
  const statusText = () => p.evaluate(() => [...document.querySelectorAll('[role="status"]')].map((x) => x.innerText).join(" | "));

  for (const width of [1280, 390]) {
    await p.setViewport(width === 390 ? { width: 390, height: 844, isMobile: true, hasTouch: true } : { width: 1280, height: 900 });
    const before = await p.evaluate(() => document.querySelectorAll('[aria-label="Attached files"] img').length);
    const chosen = await choose(bigPhoto);
    ok(`@${width} fixture is a typical phone photo (${(chosen.size / 1e6).toFixed(1)} MB)`, chosen.size >= 8e6 && chosen.size <= 12e6);
    await p.waitForFunction((n) => document.querySelectorAll('[aria-label="Attached files"] img').length > n || document.querySelector('[role="alert"]'), { timeout: 60000 }, before).catch(() => {});
    await p.waitForNetworkIdle({ idleTime: 800 }).catch(() => {});
    const st = await statusText();
    ok(`@${width} shrunk in the browser, with a note`, /Resized from \d+(\.\d)? MB to \d(\.\d)? MB/.test(st) && !(await alerts()), `${st} | ${await alerts()}`);
    const tile = await p.evaluate(() => { const imgs = [...document.querySelectorAll('[aria-label="Attached files"] img')]; const i = imgs.at(-1); return i ? { src: i.getAttribute("src"), w: i.naturalWidth, h: i.naturalHeight } : null; });
    ok(`@${width} preview shows the uploaded photo`, tile && tile.w > 0 && tile.h > 0, JSON.stringify(tile));
    const id = tile?.src?.split("/").pop();
    const [row] = await sql`select octet_length(bytes) as n, meta from app_media where id = ${id ?? ""}`;
    ok(`@${width} stored under the cap as a JPEG (${row ? (row.n / 1e6).toFixed(2) : "?"} MB), long edge ≤ 3000`, row && row.n < 4e6 && row.meta.contentType === "image/jpeg" && row.meta.name === "IMG_4521.jpg", JSON.stringify(row?.meta));
    const dims = await p.evaluate(async (src) => { const im = new Image(); im.src = src; await im.decode(); return [im.naturalWidth, im.naturalHeight]; }, tile.src);
    ok(`@${width} kept the 4:3 shape (${dims.join("×")})`, Math.max(...dims) <= 3000 && Math.abs(dims[0] / dims[1] - 4 / 3) < 0.01);
    const view = await p.evaluate(async (src) => { const r = await fetch(src); return { status: r.status, type: r.headers.get("content-type"), nosniff: r.headers.get("x-content-type-options") }; }, tile.src);
    ok(`@${width} the owner can open it, served inert`, view.status === 200 && view.type === "image/jpeg" && view.nosniff === "nosniff", JSON.stringify(view));
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(`@${width} page fits`, over <= 0);
    await p.screenshot({ path: `${OUT}uploads-${profile}-photo-${width}.png`, fullPage: true });

    // An oversized video.
    await choose(() => { const b = new Uint8Array(48e6); b.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20]); return new File([b], "brakes.mov", { type: "video/quicktime" }); });
    await p.waitForFunction(() => document.querySelector('[role="alert"]'), { timeout: 20000 }).catch(() => {});
    const a = await alerts();
    ok(`@${width} oversized video: useful guidance, nothing sent`, profile === "hosted" ? /Video uploads aren't available on this version of Clutch yet\. Describe what happens in words, or add a photo instead\./.test(a) : /This clip is 48 MB; the most Clutch can take is 40 MB\. Record a shorter clip/.test(a), a);
    await p.screenshot({ path: `${OUT}uploads-${profile}-video-${width}.png`, fullPage: true });
  }
  // Someone else can't open it.
  const other = await (await b.createBrowserContext()).newPage();
  await other.goto(base + "/", { waitUntil: "networkidle0" });
  const firstId = (await sql`select id from app_media where meta->>'name' = 'IMG_4521.jpg' order by id limit 1`)[0]?.id;
  const guest = await other.evaluate(async (u) => (await fetch(u)).status, `/api/media/${firstId}`);
  ok("a signed-out visitor can't open it", guest === 401, String(guest));

  console.log(`\n[uploads/${profile}] ${checks} checks, ${fails ? `${fails} FAILED` : "ALL PASSED"}`);
  await b.close();
  await sql.end({ timeout: 5 });
  return fails;
}
