/**
 * What Clutch accepts as an upload, decided from the file's bytes, and how a stored file is served.
 *
 * Accepted (and nothing else):
 *   photos  JPEG, PNG, WebP                        up to 20 MB
 *   video   MP4, MOV (QuickTime), WebM, 3GP        up to 40 MB
 *   audio   M4A/MP4 audio, MP3, WAV, WebM, Ogg/Opus, AAC   up to 40 MB
 *   PDF     customers' request attachments only (e.g. another shop's estimate), up to 20 MB,
 *           always served as a download, never shown inline
 *
 * The browser's File.type and the file name are only cross-checked against what the bytes are:
 * a missing or unknown type, a name whose extension doesn't match, or a name that hides another
 * type ("estimate.html.pdf") is refused. SVG, HTML/XML, scripts, archives and executables are
 * never accepted. HEIC/HEIF is refused on purpose with instructions: most browsers can't display
 * it, and every place Clutch shows a photo is an <img>. (iPhones convert to JPEG when a photo is
 * picked from Photos; Settings › Camera › Formats › Most Compatible makes the camera save JPEG.)
 */
import type { MediaKind, MediaTag } from "@/lib/domain/types";
import { uploadLimits, type UploadLimits } from "./limits";
import { PREPARE_COPY } from "./prepare";

export type Detected = "jpeg" | "png" | "webp" | "heif" | "mp4" | "mov" | "3gp" | "webm" | "ogg" | "mp3" | "wav" | "aac" | "pdf" | "markup" | "gif" | "zip" | "exe" | "unknown";

type Format = { kind: MediaKind; exts: string[]; declared: string[]; contentType: (declared: string) => string; maxBytes: number };
const MB = 1024 * 1024;
const FORMATS: Partial<Record<Detected, Format>> = {
  jpeg: { kind: "photo", exts: ["jpg", "jpeg", "jfif"], declared: ["image/jpeg", "image/jpg", "image/pjpeg"], contentType: () => "image/jpeg", maxBytes: 20 * MB },
  png: { kind: "photo", exts: ["png"], declared: ["image/png"], contentType: () => "image/png", maxBytes: 20 * MB },
  webp: { kind: "photo", exts: ["webp"], declared: ["image/webp"], contentType: () => "image/webp", maxBytes: 20 * MB },
  // One container, video or sound: the declared family decides which (both are safe to play).
  mp4: {
    kind: "video",
    exts: ["mp4", "m4v", "m4a"],
    declared: ["video/mp4", "video/x-m4v", "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac"],
    contentType: (d) => (d.startsWith("audio/") ? "audio/mp4" : "video/mp4"),
    maxBytes: 40 * MB,
  },
  mov: { kind: "video", exts: ["mov", "qt"], declared: ["video/quicktime"], contentType: () => "video/quicktime", maxBytes: 40 * MB },
  "3gp": { kind: "video", exts: ["3gp", "3gpp", "3g2"], declared: ["video/3gpp", "video/3gpp2", "audio/3gpp", "audio/3gpp2"], contentType: (d) => (d.startsWith("audio/") ? "audio/3gpp" : "video/3gpp"), maxBytes: 40 * MB },
  webm: { kind: "video", exts: ["webm", "weba"], declared: ["video/webm", "audio/webm"], contentType: (d) => (d.startsWith("audio/") ? "audio/webm" : "video/webm"), maxBytes: 40 * MB },
  ogg: { kind: "audio", exts: ["ogg", "oga", "opus"], declared: ["audio/ogg", "audio/opus", "application/ogg"], contentType: () => "audio/ogg", maxBytes: 40 * MB },
  mp3: { kind: "audio", exts: ["mp3"], declared: ["audio/mpeg", "audio/mp3", "audio/mpeg3", "audio/x-mpeg-3"], contentType: () => "audio/mpeg", maxBytes: 40 * MB },
  wav: { kind: "audio", exts: ["wav", "wave"], declared: ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"], contentType: () => "audio/wav", maxBytes: 40 * MB },
  aac: { kind: "audio", exts: ["aac"], declared: ["audio/aac", "audio/x-aac", "audio/aacp"], contentType: () => "audio/aac", maxBytes: 40 * MB },
  pdf: { kind: "document", exts: ["pdf"], declared: ["application/pdf", "application/x-pdf"], contentType: () => "application/pdf", maxBytes: 20 * MB },
};

/** Where each kind of file may be attached. */
const PHOTO_ONLY: MediaTag[] = ["portrait", "vehicle"];
const MECHANIC_TAGS: MediaTag[] = ["portrait", "before", "after", "parts", "completed", "diagnostic", "vehicle"];

/** Extensions that must never appear anywhere in a name (they'd hide another type behind the last one). */
const DANGEROUS = new Set([
  "html", "htm", "xhtml", "shtml", "mht", "mhtml", "svg", "svgz", "xml", "xsl", "xslt", "js", "mjs", "cjs", "jsx", "ts", "tsx", "json", "css", "php", "phtml", "asp", "aspx", "jsp", "cgi", "pl", "py", "rb", "sh", "bash", "zsh", "ps1", "psm1", "bat", "cmd", "com", "exe", "dll", "msi", "msp", "scr", "pif", "cpl", "vbs", "vbe", "wsf", "wsh", "hta", "jar", "apk", "app", "dmg", "pkg", "deb", "rpm", "iso", "img", "zip", "rar", "7z", "gz", "tgz", "bz2", "xz", "tar", "swf", "lnk", "url", "desktop", "reg", "chm",
]);

const ascii = (b: Uint8Array, from: number, len: number) => String.fromCharCode(...b.subarray(from, from + len));

/** What the bytes are, from their signature. Never the name or the browser's claim. */
export function sniff(b: Uint8Array): Detected {
  if (b.length < 4) return "unknown";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE") return "wav";
  if (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a") return "gif";
  if (ascii(b, 0, 5) === "%PDF-") return "pdf";
  if (ascii(b, 0, 4) === "OggS") return "ogg";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
  if (ascii(b, 4, 4) === "ftyp") {
    const brand = ascii(b, 8, 4);
    if (/^(heic|heix|heim|heis|hevc|hevx|mif1|msf1|avif|avis)$/.test(brand)) return "heif";
    if (brand === "qt  ") return "mov";
    if (/^3g/.test(brand)) return "3gp";
    if (/^(isom|iso[2-9]|mp41|mp42|mp71|avc1|dash|M4V |M4VH|M4VP|M4A |M4B |f4v |MSNV|NDAS)$/.test(brand)) return "mp4";
    return "unknown";
  }
  // Older QuickTime files start straight with an atom.
  if (/^(moov|mdat|wide|free|skip|pnot)$/.test(ascii(b, 4, 4)) && b[0] === 0) return "mov";
  if (ascii(b, 0, 3) === "ID3") return "mp3";
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return "aac"; // ADTS
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "mp3"; // MPEG audio frame
  if (ascii(b, 0, 2) === "PK") return "zip";
  if (ascii(b, 0, 2) === "MZ" || (b[0] === 0x7f && ascii(b, 1, 3) === "ELF") || [0xfeedface, 0xfeedfacf, 0xcafebabe, 0xcefaedfe, 0xcffaedfe].includes(((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0)) return "exe";
  // Text that a browser could treat as a page, an image with script, or code.
  const head = new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, 1024)).replace(/^﻿/, "").trimStart().toLowerCase();
  if (/^<(\?xml|!doctype|html|svg|script|head|body|iframe|!--|[a-z])/.test(head) || /<svg[\s>]|<script[\s>]|<html[\s>]/.test(head)) return "markup";
  return "unknown";
}

export type Upload = { name: string; declaredType: string; bytes: Uint8Array; tag: MediaTag; role: "customer" | "mechanic" };
export type Accepted = { ok: true; kind: MediaKind; contentType: string; ext: string; displayName: string };
export type Refused = { ok: false; status: number; error: string };

export const COPY = {
  empty: "That file is empty. Choose it again.",
  unsupported: "Clutch accepts photos (JPEG, PNG or WebP), videos (MP4, MOV or WebM), audio recordings (M4A, MP3, WAV, WebM or Ogg) and PDF documents. This file isn't one of those.",
  markup: "Clutch doesn't accept web pages, SVG images or scripts. Upload a photo (JPEG, PNG or WebP), a video, a recording or a PDF instead.",
  executable: "Clutch doesn't accept programs, archives or installers. Upload a photo, a video, a recording or a PDF instead.",
  heif: "HEIC photos can't be shown in most browsers. On iPhone, pick the photo from Photos (it's converted to JPEG automatically), or set Settings › Camera › Formats to Most Compatible, then try again.",
  gif: "GIFs aren't accepted. Upload a photo (JPEG, PNG or WebP) or a video instead.",
  mismatch: "This file's name or type doesn't match what's inside it. Export it again as a real photo, video, recording or PDF, then upload that.",
  hiddenType: "That file name hides another file type. Rename the file (one extension only, like photo.jpg) or export it again.",
  noType: "Your browser didn't say what kind of file this is. Export it again as a photo, video, recording or PDF, then upload that.",
  photoOnly: "This has to be a photo: a JPEG, PNG or WebP image.",
  mechanicMedia: "Mechanics can upload repair photos and videos only.",
  tooBig: (kind: MediaKind, limit: number) => `That ${kind === "document" ? "document" : kind === "photo" ? "photo" : kind === "audio" ? "recording" : "video"} is over ${Math.round(limit / MB)} MB. ${kind === "video" || kind === "audio" ? "Try a shorter clip." : "Try a smaller file."}`,
} as const;

/** The name shown in Clutch: the original's base name made safe, with the real extension. Never used in headers. */
export function displayName(original: string, ext: string, kind: MediaKind) {
  const base = (original.split(/[\\/]/).pop() ?? "")
    .replace(/\.[^.]*$/, "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} ()_\-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return `${base || (kind === "document" ? "document" : kind)}.${ext}`;
}

/** Decide whether an upload is accepted and how it will be stored, within this deployment's limits (lib/media/limits.ts). */
export function checkUpload(u: Upload, limits: UploadLimits = uploadLimits()): Accepted | Refused {
  const refuse = (error: string, status = 415): Refused => ({ ok: false, status, error });
  if (u.bytes.byteLength === 0) return refuse(COPY.empty, 400);
  const detected = sniff(u.bytes);
  const name = (u.name ?? "").split(/[\\/]/).pop() ?? "";
  if (/[\u0000-\u001f\u007f]/.test(name)) return refuse(COPY.hiddenType);
  const parts = name.toLowerCase().split(".").slice(1).map((p) => p.trim());
  const ext = parts.at(-1) ?? "";
  if (detected === "markup" || parts.some((p) => ["html", "htm", "xhtml", "svg", "svgz", "xml", "js", "mjs"].includes(p))) return refuse(COPY.markup);
  if (detected === "exe" || detected === "zip") return refuse(COPY.executable);
  if (detected === "heif" || ["heic", "heif", "hif", "avif"].includes(ext)) return refuse(COPY.heif);
  if (detected === "gif") return refuse(COPY.gif);
  if (parts.some((p) => DANGEROUS.has(p))) return refuse(COPY.executable);
  const f = FORMATS[detected];
  if (!f) return refuse(COPY.unsupported);
  const declared = (u.declaredType ?? "").toLowerCase().split(";")[0].trim();
  if (!declared || declared === "application/octet-stream") return refuse(COPY.noType);
  if (!f.declared.includes(declared)) return refuse(COPY.mismatch);
  // No extension at all (some Android pickers) is fine: the stored name is generated. A wrong one isn't.
  if (ext && !f.exts.includes(ext)) return refuse(COPY.mismatch);
  // Every extension before the last must not be a known type either ("photo.pdf.jpg").
  if (parts.length > 1 && parts.slice(0, -1).some((p) => Object.values(FORMATS).some((x) => x!.exts.includes(p)))) return refuse(COPY.hiddenType);
  const contentType = f.contentType(declared);
  const kind: MediaKind = contentType.startsWith("audio/") ? "audio" : f.kind;
  if (kind === "video" && !limits.video) return refuse(PREPARE_COPY.noVideo);
  if (kind === "audio" && !limits.audio) return refuse(PREPARE_COPY.noAudio);
  const max = Math.min(f.maxBytes, limits.maxBytes);
  if (u.bytes.byteLength > max) return refuse(limits.profile === "hosted" ? PREPARE_COPY.hostRefused(max) : COPY.tooBig(kind, max), 413);
  if (PHOTO_ONLY.includes(u.tag) && kind !== "photo") return refuse(COPY.photoOnly);
  if (u.role === "mechanic" && (!MECHANIC_TAGS.includes(u.tag) || (kind !== "photo" && kind !== "video"))) return refuse(COPY.mechanicMedia, 403);
  const canonicalExt = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "audio/mp4": "m4a", "video/quicktime": "mov", "video/3gpp": "3gp", "audio/3gpp": "3gp", "video/webm": "webm", "audio/webm": "webm", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/aac": "aac", "application/pdf": "pdf" }[contentType]!;
  return { ok: true, kind, contentType, ext: canonicalExt, displayName: displayName(name, canonicalExt, kind) };
}

/**
 * Headers for serving a stored file from the Clutch origin. The type is re-derived from the
 * bytes: anything that isn't an accepted photo, video or recording (including files stored
 * before this check existed) is sent as an inert download.
 */
export function serveHeaders(id: string, stored: { contentType?: string; kind?: MediaKind }, bytes: Uint8Array) {
  const detected = sniff(bytes.subarray(0, 4096));
  const f = FORMATS[detected];
  const storedType = String(stored.contentType ?? "").toLowerCase();
  // The stored type only chooses between the video/audio flavours of the same container.
  const type = f ? f.contentType(storedType) : "application/octet-stream";
  const inline = Boolean(f) && (type.startsWith("image/") || type.startsWith("video/") || type.startsWith("audio/"));
  const safeId = id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "file";
  const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "audio/mp4": "m4a", "video/quicktime": "mov", "video/3gpp": "3gp", "audio/3gpp": "3gp", "video/webm": "webm", "audio/webm": "webm", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/aac": "aac", "application/pdf": "pdf" } as Record<string, string>)[type] ?? "bin";
  const label = type.startsWith("image/") ? "photo" : type.startsWith("video/") ? "video" : type.startsWith("audio/") ? "recording" : type === "application/pdf" ? "document" : "file";
  return {
    "Content-Type": type,
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="clutch-${label}-${safeId}.${ext}"`,
    "X-Content-Type-Options": "nosniff",
    // Opened directly, the file is a sandboxed document that can run nothing and load nothing else.
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "private, max-age=3600",
    "Accept-Ranges": "bytes",
  } as Record<string, string>;
}
