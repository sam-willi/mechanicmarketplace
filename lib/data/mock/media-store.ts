import "server-only";
import type { MediaKind, MediaTag, RepairMedia } from "@/lib/domain/types";
import { getMediaBytes, getMediaMeta, persistent, putMediaBytes } from "../store";

/**
 * Uploaded files. With DATABASE_URL they're stored in Postgres (`app_media`);
 * otherwise in server memory. Callers only see RepairMedia records and URLs,
 * so moving the bytes to Supabase Storage later doesn't change them.
 */
type Stored = { meta: RepairMedia; ownerId: string; bytes: Uint8Array };
const g = globalThis as unknown as { __clutchMedia?: Map<string, Stored> };
const store = (g.__clutchMedia ??= new Map());

export const MAX_MEDIA_BYTES = 40 * 1024 * 1024;

export function kindFor(contentType: string, name: string): MediaKind {
  if (contentType.startsWith("image/")) return "photo";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  if (/\.(heic|heif)$/i.test(name)) return "photo";
  return "document";
}

export async function putMedia(ownerId: string, file: { name: string; type: string; bytes: Uint8Array }, tag: MediaTag, description?: string): Promise<RepairMedia> {
  const id = crypto.randomUUID();
  const meta: RepairMedia = {
    id,
    kind: kindFor(file.type, file.name),
    tag,
    name: file.name || "upload",
    contentType: file.type || "application/octet-stream",
    size: file.bytes.byteLength,
    description,
    uploadedAt: new Date().toISOString(),
    url: `/api/media/${id}`,
  };
  if (persistent()) await putMediaBytes(id, ownerId, meta, file.bytes);
  else store.set(id, { meta, ownerId, bytes: file.bytes });
  return meta;
}

/** Metadata and owner only (for permission checks). */
export async function getMedia(id: string): Promise<{ meta: RepairMedia; ownerId: string } | undefined> {
  if (!persistent()) return store.get(id);
  const row = await getMediaMeta(id);
  return row ? { meta: row.meta as RepairMedia, ownerId: row.owner_id } : undefined;
}

/** Metadata, owner and bytes (for serving the file). */
export async function getMediaWithBytes(id: string): Promise<Stored | undefined> {
  if (!persistent()) return store.get(id);
  const row = await getMediaBytes(id);
  return row ? { meta: row.meta as RepairMedia, ownerId: row.owner_id, bytes: new Uint8Array(row.bytes) } : undefined;
}

/** Seeded, byte-less placeholders (demo requests) resolve to a metadata-only record. */
export function metaOnly(meta: Omit<RepairMedia, "url">): RepairMedia {
  return { ...meta };
}
