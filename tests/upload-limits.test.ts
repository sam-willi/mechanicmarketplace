import { test } from "node:test";
import assert from "node:assert/strict";
import { currentProfile, HOSTED_MAX_BYTES, uploadLimits } from "@/lib/media/limits";
import { fitWithin, jpegName, planUpload, PREPARE_COPY, shrinkTarget, SHRINK_STEPS } from "@/lib/media/prepare";
import { checkUpload, COPY } from "@/lib/media/policy";

/**
 * Upload size and format limits per deployment: on serverless hosting (Vercel refuses bodies over
 * ~4.5 MB before the app runs) photos are shrunk in the browser to fit, PDFs must fit, and video
 * and audio are off; a normal server takes up to 40 MB and video/audio. The browser plan and the
 * server check share the same limits.
 */

const MB = 1024 * 1024;
const hosted = uploadLimits("hosted");
const full = uploadLimits("full");
const file = (name: string, type: string, size: number) => ({ name, type, size });
const jpegBytes = (size: number) => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  return b;
};
const mp4Bytes = (size: number) => {
  const b = new Uint8Array(size);
  b.set([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypisom")]);
  return b;
};

test("the profile comes from the build (CLUTCH_UPLOAD_PROFILE); hosted means 4 MB, no video or audio", () => {
  const before = process.env.CLUTCH_UPLOAD_PROFILE;
  try {
    process.env.CLUTCH_UPLOAD_PROFILE = "hosted";
    assert.equal(currentProfile(), "hosted");
    assert.deepEqual({ max: uploadLimits().maxBytes, video: uploadLimits().video, audio: uploadLimits().audio }, { max: HOSTED_MAX_BYTES, video: false, audio: false });
    delete process.env.CLUTCH_UPLOAD_PROFILE;
    assert.equal(currentProfile(), "full");
    assert.equal(uploadLimits().maxBytes, 40_000_000);
  } finally {
    if (before === undefined) delete process.env.CLUTCH_UPLOAD_PROFILE;
    else process.env.CLUTCH_UPLOAD_PROFILE = before;
  }
  // The shrink target leaves room under the host's ~4.5 MB body limit for the form overhead.
  assert.ok(shrinkTarget(hosted) <= HOSTED_MAX_BYTES && HOSTED_MAX_BYTES < 4.5 * 1000 * 1000);
});

test("compression decisions: small photos go as they are; big photos and HEIC are shrunk to JPEG first", () => {
  assert.deepEqual(planUpload(file("IMG_1.jpg", "image/jpeg", 2 * MB), hosted), { action: "upload" });
  assert.deepEqual(planUpload(file("shot.png", "image/png", 3.3 * MB), hosted), { action: "upload" });
  for (const [f, reason] of [
    [file("IMG_2.jpg", "image/jpeg", 9.6 * MB), "too_big"],
    [file("IMG_3.jpg", "image/jpeg", 12 * MB), "too_big"],
    [file("pano.webp", "image/webp", 5 * MB), "too_big"],
    [file("IMG_4.HEIC", "image/heic", 1.8 * MB), "heic"],
    [file("IMG_5.heic", "", 2 * MB), "heic"],
  ] as const) {
    const p = planUpload(f, hosted);
    assert.equal(p.action, "shrink", f.name);
    assert.equal(p.action === "shrink" && p.reason, reason, f.name);
    assert.deepEqual(p.action === "shrink" && p.steps, SHRINK_STEPS);
  }
  // The same big photo is shrunk on a full server too (quicker uploads), but video is fine there.
  assert.equal(planUpload(file("IMG_2.jpg", "image/jpeg", 9.6 * MB), full).action, "shrink");
  assert.deepEqual(planUpload(file("brakes.mp4", "video/mp4", 30 * MB), full), { action: "upload" });
  assert.deepEqual(planUpload(file("long.mov", "video/quicktime", 48 * MB), full), { action: "refuse", error: PREPARE_COPY.clipTooBig(48 * MB, 40_000_000) });
  assert.match(PREPARE_COPY.clipTooBig(48 * MB, 40_000_000), /50 MB.*40 MB.*shorter clip/);
});

test("hosted: video and audio are refused before upload with honest guidance; PDFs must fit", () => {
  assert.deepEqual(planUpload(file("brakes.mov", "video/quicktime", 48 * MB), hosted), { action: "refuse", error: PREPARE_COPY.noVideo });
  assert.deepEqual(planUpload(file("clip.mp4", "video/mp4", 1 * MB), hosted), { action: "refuse", error: PREPARE_COPY.noVideo });
  assert.deepEqual(planUpload(file("knock.m4a", "audio/x-m4a", 1 * MB), hosted), { action: "refuse", error: PREPARE_COPY.noAudio });
  assert.deepEqual(planUpload(file("rec.webm", "audio/webm", 1 * MB), hosted), { action: "refuse", error: PREPARE_COPY.noAudio });
  assert.deepEqual(planUpload(file("estimate.pdf", "application/pdf", 5 * MB), hosted), { action: "refuse", error: PREPARE_COPY.documentTooBig(5 * MB, HOSTED_MAX_BYTES) });
  assert.deepEqual(planUpload(file("estimate.pdf", "application/pdf", 1 * MB), hosted), { action: "upload" });
  assert.deepEqual(planUpload(file("mystery.bin", "application/octet-stream", 6 * MB), hosted), { action: "refuse", error: PREPARE_COPY.hostRefused(HOSTED_MAX_BYTES) });
  // The copy says what to do instead, and never promises a format that won't work.
  assert.match(PREPARE_COPY.noVideo, /Describe .* in words|add a photo/);
  assert.match(PREPARE_COPY.heicUnreadable, /screenshot/);
  assert.match(PREPARE_COPY.documentTooBig(5 * MB, HOSTED_MAX_BYTES), /5\.2 MB.*4\.0 MB/);
});

test("resizing math keeps the aspect ratio, never enlarges, and names the result .jpg", () => {
  assert.deepEqual(fitWithin(4032, 3024, 2560), { width: 2560, height: 1920 });
  assert.deepEqual(fitWithin(3024, 4032, 2560), { width: 1920, height: 2560 });
  assert.deepEqual(fitWithin(800, 600, 2560), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(10000, 1, 1280), { width: 1280, height: 1 });
  assert.equal(jpegName("IMG_7788.HEIC"), "IMG_7788.jpg");
  assert.equal(jpegName("screen shot.png"), "screen shot.jpg");
  assert.equal(jpegName(".png"), "photo.jpg");
  // Each step is smaller or lower quality than the last.
  for (let i = 1; i < SHRINK_STEPS.length; i++) assert.ok(SHRINK_STEPS[i].maxEdge <= SHRINK_STEPS[i - 1].maxEdge && SHRINK_STEPS[i].quality <= SHRINK_STEPS[i - 1].quality);
});

test("server: the hosted cap is enforced from the bytes whatever the browser did, with the same copy", () => {
  const up = (bytes: Uint8Array, name: string, declaredType: string, tag = "damage" as const) => ({ bytes, name, declaredType, tag, role: "customer" as const });
  assert.ok(checkUpload(up(jpegBytes(3.9 * 1000 * 1000), "ok.jpg", "image/jpeg"), hosted).ok, "just under the cap");
  const over = checkUpload(up(jpegBytes(HOSTED_MAX_BYTES + 1), "big.jpg", "image/jpeg"), hosted);
  assert.deepEqual(over, { ok: false, status: 413, error: PREPARE_COPY.hostRefused(HOSTED_MAX_BYTES) });
  assert.deepEqual(checkUpload(up(mp4Bytes(1024), "clip.mp4", "video/mp4"), hosted), { ok: false, status: 415, error: PREPARE_COPY.noVideo });
  assert.deepEqual(checkUpload(up(mp4Bytes(1024), "knock.m4a", "audio/mp4"), hosted), { ok: false, status: 415, error: PREPARE_COPY.noAudio });
  // A full server still takes them, and its own limits apply.
  assert.ok(checkUpload(up(mp4Bytes(30 * MB), "clip.mp4", "video/mp4"), full).ok);
  assert.deepEqual(checkUpload(up(jpegBytes(21 * MB), "huge.jpg", "image/jpeg"), full), { ok: false, status: 413, error: COPY.tooBig("photo", 20 * MB) });
});

test("server: malicious and spoofed inputs are refused under the hosted profile too", () => {
  const up = (bytes: Uint8Array, name: string, declaredType: string) => ({ bytes, name, declaredType, tag: "damage" as const, role: "customer" as const });
  const enc = (s: string) => new TextEncoder().encode(s);
  assert.equal((checkUpload(up(enc("<!doctype html><script>alert(1)</script>"), "shrunk.jpg", "image/jpeg"), hosted) as { error: string }).error, COPY.markup);
  assert.equal((checkUpload(up(enc('<svg xmlns="http://www.w3.org/2000/svg"/>'), "photo.jpg", "image/jpeg"), hosted) as { error: string }).error, COPY.markup);
  assert.equal((checkUpload(up(jpegBytes(2048), "photo.jpg", "image/png"), hosted) as { error: string }).error, COPY.mismatch);
  // A "video" disguised as a photo is judged by its bytes: it's a video, and video is off here.
  assert.equal((checkUpload(up(mp4Bytes(2048), "photo.jpg", "image/jpeg"), hosted) as { error: string }).error, COPY.mismatch);
});
