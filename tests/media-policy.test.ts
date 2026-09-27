import { test } from "node:test";
import assert from "node:assert/strict";
import { checkUpload, COPY, serveHeaders, sniff, type Upload } from "@/lib/media/policy";

/**
 * Uploads are accepted from what their bytes are, never from the browser's type or the name, and
 * stored files are served so nothing can run from the Clutch origin. Fixtures are tiny synthetic
 * byte strings with real signatures.
 */

const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...parts: (Uint8Array | number[] | string)[]) => {
  const arrs = parts.map((p) => (typeof p === "string" ? enc(p) : p instanceof Uint8Array ? p : new Uint8Array(p)));
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
};
const pad = (b: Uint8Array, n = 64) => cat(b, new Uint8Array(n));
const ftyp = (brand: string) => pad(cat([0, 0, 0, 0x18], "ftyp", brand, [0, 0, 0, 0], brand));
const F = {
  jpeg: pad(cat([0xff, 0xd8, 0xff, 0xe0, 0, 0x10], "JFIF")),
  png: pad(cat([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a])),
  webp: pad(cat("RIFF", [0, 0, 0, 0], "WEBPVP8 ")),
  wav: pad(cat("RIFF", [0, 0, 0, 0], "WAVEfmt ")),
  gif: pad(cat("GIF89a")),
  pdf: pad(cat("%PDF-1.7\n")),
  ogg: pad(cat("OggS", [0])),
  webm: pad(cat([0x1a, 0x45, 0xdf, 0xa3], "webm")),
  mp4: ftyp("isom"),
  m4a: ftyp("M4A "),
  mov: ftyp("qt  "),
  gp3: ftyp("3gp5"),
  heic: ftyp("heic"),
  mp3: pad(cat("ID3", [4, 0])),
  mp3frame: pad(cat([0xff, 0xfb, 0x90, 0x64])),
  aac: pad(cat([0xff, 0xf1, 0x50, 0x80])),
  svg: enc('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  svgXml: enc('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'),
  html: enc("﻿   <!DOCTYPE html><html><body><script>fetch('/api/…')</script></body></html>"),
  exe: pad(cat("MZ", [0x90, 0])),
  elf: pad(cat([0x7f], "ELF", [2, 1])),
  zip: pad(cat("PK", [3, 4])),
};
const up = (bytes: Uint8Array, name: string, declaredType: string, extra: Partial<Upload> = {}): Upload => ({ bytes, name, declaredType, tag: "issue", role: "customer", ...extra });
const accepted = (u: Upload) => {
  const r = checkUpload(u);
  assert.ok(r.ok, `${u.name} (${u.declaredType}) should be accepted: ${!r.ok ? r.error : ""}`);
  return r;
};
const refused = (u: Upload, error: string, status?: number) => {
  const r = checkUpload(u);
  assert.ok(!r.ok, `${u.name} (${u.declaredType}) should be refused`);
  assert.equal(r.error, error, u.name);
  if (status) assert.equal(r.status, status, u.name);
};

test("signatures are read from the bytes", () => {
  const cases: [keyof typeof F, string][] = [["jpeg", "jpeg"], ["png", "png"], ["webp", "webp"], ["wav", "wav"], ["gif", "gif"], ["pdf", "pdf"], ["ogg", "ogg"], ["webm", "webm"], ["mp4", "mp4"], ["m4a", "mp4"], ["mov", "mov"], ["gp3", "3gp"], ["heic", "heif"], ["mp3", "mp3"], ["mp3frame", "mp3"], ["aac", "aac"], ["svg", "markup"], ["svgXml", "markup"], ["html", "markup"], ["exe", "exe"], ["elf", "exe"], ["zip", "zip"]];
  for (const [k, want] of cases) assert.equal(sniff(F[k]), want, k);
  assert.equal(sniff(enc("just some text")), "unknown");
  assert.equal(sniff(new Uint8Array([1, 2])), "unknown");
});

test("accepted formats, each stored with a canonical type, kind and extension", () => {
  const rows: [Uint8Array, string, string, string, string][] = [
    [F.jpeg, "IMG_1042.JPG", "image/jpeg", "image/jpeg", "photo"],
    [F.jpeg, "dash.jpeg", "image/pjpeg", "image/jpeg", "photo"],
    [F.png, "screenshot.png", "image/png", "image/png", "photo"],
    [F.webp, "leak.webp", "image/webp", "image/webp", "photo"],
    [F.mp4, "noise.mp4", "video/mp4", "video/mp4", "video"],
    [F.mov, "IMG_2210.MOV", "video/quicktime", "video/quicktime", "video"],
    [F.webm, "clip.webm", "video/webm", "video/webm", "video"],
    [F.gp3, "old-phone.3gp", "video/3gpp", "video/3gpp", "video"],
    [F.m4a, "knock.m4a", "audio/x-m4a", "audio/mp4", "audio"],
    [F.webm, "recording.webm", "audio/webm", "audio/webm", "audio"],
    [F.ogg, "rattle.ogg", "audio/ogg", "audio/ogg", "audio"],
    [F.mp3, "squeal.mp3", "audio/mpeg", "audio/mpeg", "audio"],
    [F.wav, "hum.wav", "audio/wav", "audio/wav", "audio"],
    [F.aac, "tick.aac", "audio/aac", "audio/aac", "audio"],
    [F.pdf, "Shop estimate (March).pdf", "application/pdf", "application/pdf", "document"],
  ];
  for (const [bytes, name, type, contentType, kind] of rows) {
    const r = accepted(up(bytes, name, type, { tag: kind === "document" ? "prior_estimate" : "issue" }));
    assert.equal(r.contentType, contentType, name);
    assert.equal(r.kind, kind, name);
  }
  assert.equal(accepted(up(F.jpeg, "IMG_1042.JPG", "image/jpeg")).displayName, "IMG_1042.jpg");
});

test("spoofed types: the browser's type and the name must match the bytes", () => {
  refused(up(F.png, "photo.jpg", "image/jpeg"), COPY.mismatch);
  refused(up(F.jpeg, "photo.jpg", "image/png"), COPY.mismatch);
  refused(up(F.jpeg, "photo.png", "image/jpeg"), COPY.mismatch);
  refused(up(F.pdf, "estimate.pdf", "image/jpeg"), COPY.mismatch);
  refused(up(F.mp4, "clip.mp4", "application/pdf"), COPY.mismatch);
  refused(up(F.jpeg, "photo.jpg", "text/html"), COPY.mismatch);
  // No extension (some Android pickers) is accepted when the bytes and declared type agree; the name is generated.
  assert.equal(accepted(up(F.jpeg, "1000012345", "image/jpeg")).displayName, "1000012345.jpg");
  refused(up(F.png, "1000012345", "image/jpeg"), COPY.mismatch);
  refused(up(F.jpeg, "photo.jpg", ""), COPY.noType);
  refused(up(F.jpeg, "photo.jpg", "application/octet-stream"), COPY.noType);
  refused(up(enc("plain words, nothing else"), "notes.jpg", "image/jpeg"), COPY.unsupported);
});

test("SVG, HTML, XML and scripts are refused, whatever they're called", () => {
  refused(up(F.svg, "diagram.svg", "image/svg+xml"), COPY.markup);
  refused(up(F.svg, "photo.png", "image/png"), COPY.markup);
  refused(up(F.svgXml, "photo.jpg", "image/jpeg"), COPY.markup);
  refused(up(F.html, "estimate.pdf", "application/pdf"), COPY.markup);
  refused(up(F.html, "page.html", "text/html"), COPY.markup);
  refused(up(F.jpeg, "photo.svg", "image/svg+xml"), COPY.markup);
  refused(up(enc("alert(document.cookie)"), "x.js", "text/javascript"), COPY.markup);
});

test("double extensions and hidden types are refused", () => {
  refused(up(F.jpeg, "photo.html.jpg", "image/jpeg"), COPY.markup);
  refused(up(F.pdf, "invoice.exe.pdf", "application/pdf", { tag: "prior_estimate" }), COPY.executable);
  refused(up(F.jpeg, "photo.pdf.jpg", "image/jpeg"), COPY.hiddenType);
  refused(up(F.jpeg, "photo.jpg\u0000.html", "image/jpeg"), COPY.hiddenType);
  accepted(up(F.jpeg, "2016.bmw.front-left.jpg", "image/jpeg"));
});

test("programs, archives, GIFs and HEIC are refused with specific instructions", () => {
  refused(up(F.exe, "setup.jpg", "image/jpeg"), COPY.executable);
  refused(up(F.elf, "run.pdf", "application/pdf"), COPY.executable);
  refused(up(F.zip, "photos.zip", "application/zip"), COPY.executable);
  refused(up(F.jpeg, "photo.exe", "image/jpeg"), COPY.executable);
  refused(up(F.gif, "funny.gif", "image/gif"), COPY.gif);
  refused(up(F.heic, "IMG_0001.HEIC", "image/heic"), COPY.heif);
  refused(up(F.jpeg, "IMG_0001.heic", "image/jpeg"), COPY.heif);
});

test("polyglot-like files: a real signature with script behind it is stored as that type and served inert", () => {
  const jpegWithScript = cat(F.jpeg, "<script>alert(1)</script><svg onload=alert(1)>");
  const r = accepted(up(jpegWithScript, "photo.jpg", "image/jpeg"));
  assert.equal(r.contentType, "image/jpeg");
  const h = serveHeaders("abcd1234-xyz", { contentType: r.contentType }, jpegWithScript);
  assert.equal(h["Content-Type"], "image/jpeg");
  assert.equal(h["X-Content-Type-Options"], "nosniff");
  assert.match(h["Content-Security-Policy"], /default-src 'none'.*sandbox/);
  // GIF + zip ("GIFAR") is a GIF: refused. PDF with HTML inside is a PDF: only ever a download.
  refused(up(cat(F.gif, F.zip), "x.gif", "image/gif"), COPY.gif);
  const pdfHtml = cat(F.pdf, "<html><script>alert(1)</script></html>");
  accepted(up(pdfHtml, "estimate.pdf", "application/pdf", { tag: "prior_estimate" }));
  assert.match(serveHeaders("id", { contentType: "application/pdf" }, pdfHtml)["Content-Disposition"], /^attachment;/);
});

test("size limits per kind, and empty files", () => {
  const big = (b: Uint8Array, mb: number) => cat(b, new Uint8Array(mb * 1024 * 1024));
  refused(up(big(F.jpeg, 21), "huge.jpg", "image/jpeg"), COPY.tooBig("photo", 20 * 1024 * 1024), 413);
  refused(up(big(F.pdf, 21), "huge.pdf", "application/pdf", { tag: "prior_estimate" }), COPY.tooBig("document", 20 * 1024 * 1024), 413);
  accepted(up(big(F.mp4, 30), "long.mp4", "video/mp4"));
  refused(up(new Uint8Array(0), "empty.jpg", "image/jpeg"), COPY.empty, 400);
});

test("where each kind may go: photos only for portraits and car photos; mechanics upload photos and video only", () => {
  refused(up(F.mp4, "me.mp4", "video/mp4", { tag: "portrait", role: "mechanic" }), COPY.photoOnly);
  refused(up(F.pdf, "car.pdf", "application/pdf", { tag: "vehicle" }), COPY.photoOnly);
  refused(up(F.pdf, "invoice.pdf", "application/pdf", { tag: "completed", role: "mechanic" }), COPY.mechanicMedia, 403);
  refused(up(F.jpeg, "x.jpg", "image/jpeg", { tag: "issue", role: "mechanic" }), COPY.mechanicMedia, 403);
  refused(up(F.m4a, "x.m4a", "audio/mp4", { tag: "diagnostic", role: "mechanic" }), COPY.mechanicMedia, 403);
  accepted(up(F.jpeg, "me.jpg", "image/jpeg", { tag: "portrait", role: "mechanic" }));
  accepted(up(F.mov, "brakes.mov", "video/quicktime", { tag: "after", role: "mechanic" }));
});

test("names are made safe for display and never reach a header", () => {
  const r = accepted(up(F.jpeg, '../../etc/passwd"; x=<script>.jpg', "image/jpeg"));
  assert.doesNotMatch(r.displayName, /[<>"/\\;]/);
  assert.match(r.displayName, /\.jpg$/);
  assert.equal(accepted(up(F.jpeg, "Façade – ボンネット.jpg", "image/jpeg")).displayName, "Façade ボンネット.jpg");
  assert.equal(accepted(up(F.jpeg, ".jpg", "image/jpeg")).displayName, "photo.jpg");
  const h = serveHeaders('bad"id\r\nx', { contentType: "image/jpeg" }, F.jpeg);
  assert.match(h["Content-Disposition"], /^inline; filename="clutch-photo-[a-zA-Z0-9]{1,8}\.jpg"$/);
});

test("serving: photos, video and audio inline and inert; PDFs and anything unrecognised as downloads", () => {
  const base = { "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" };
  for (const [bytes, stored, type, disp] of [
    [F.jpeg, "image/jpeg", "image/jpeg", "inline"],
    [F.mp4, "video/mp4", "video/mp4", "inline"],
    [F.m4a, "audio/mp4", "audio/mp4", "inline"],
    [F.pdf, "application/pdf", "application/pdf", "attachment"],
    // Files stored before this check existed are re-checked from their bytes.
    [F.html, "text/html", "application/octet-stream", "attachment"],
    [F.svg, "image/svg+xml", "application/octet-stream", "attachment"],
    [F.jpeg, "text/html", "image/jpeg", "inline"],
    [F.heic, "image/heic", "application/octet-stream", "attachment"],
  ] as const) {
    const h = serveHeaders("0f1e2d3c-aaaa", { contentType: stored }, bytes);
    assert.equal(h["Content-Type"], type, stored);
    assert.ok(h["Content-Disposition"].startsWith(`${disp};`), `${stored}: ${h["Content-Disposition"]}`);
    for (const [k, v] of Object.entries(base)) assert.equal(h[k], v);
    assert.match(h["Content-Security-Policy"], /sandbox/);
  }
});
