import "server-only";
import type { MediaKind, MediaTag, RepairMedia } from "@/lib/domain/types";
import { getMediaBytes, getMediaMeta, persistent, putMediaBytes } from "../store";
import type { Scope } from "../scope";

/**
 * Uploaded files. With DATABASE_URL they're stored in Postgres (`app_media`);
 * otherwise in server memory. Callers only see RepairMedia records and URLs,
 * so moving the bytes to Supabase Storage later doesn't change them.
 */
type Stored = { meta: RepairMedia; ownerId: string; bytes: Uint8Array; scope: Scope };
const g = globalThis as unknown as { __clutchMedia?: Map<string, Stored> };
const store = (g.__clutchMedia ??= new Map());

/**
 * Store an upload that lib/media/policy.ts `checkUpload` has already accepted: the kind, type
 * and name come from that check (from the bytes), never from the browser.
 */
export async function putMedia(
  scope: Scope,
  ownerId: string,
  file: { displayName: string; contentType: string; kind: MediaKind; bytes: Uint8Array },
  tag: MediaTag,
  description?: string,
): Promise<RepairMedia> {
  const id = crypto.randomUUID();
  const meta: RepairMedia = {
    id,
    kind: file.kind,
    tag,
    name: file.displayName,
    contentType: file.contentType,
    size: file.bytes.byteLength,
    description,
    uploadedAt: new Date().toISOString(),
    url: `/api/media/${id}`,
  };
  if (persistent()) await putMediaBytes(scope, id, ownerId, meta, file.bytes);
  else store.set(id, { meta, ownerId, bytes: file.bytes, scope });
  return meta;
}

/** Metadata and owner only (for permission checks). Only files uploaded in the same scope. */
export async function getMedia(scope: Scope, id: string): Promise<{ meta: RepairMedia; ownerId: string } | undefined> {
  if (!persistent()) {
    const m = store.get(id);
    return m && m.scope === scope ? m : undefined;
  }
  const row = await getMediaMeta(scope, id);
  return row ? { meta: row.meta as RepairMedia, ownerId: row.owner_id } : undefined;
}

/** Metadata, owner and bytes (for serving the file). Only files uploaded in the same scope. */
export async function getMediaWithBytes(scope: Scope, id: string): Promise<Stored | undefined> {
  if (!persistent()) {
    const m = store.get(id);
    return m && m.scope === scope ? m : undefined;
  }
  const row = await getMediaBytes(scope, id);
  return row ? { meta: row.meta as RepairMedia, ownerId: row.owner_id, bytes: new Uint8Array(row.bytes), scope } : undefined;
}

/** Seeded, byte-less placeholders (demo requests) resolve to a metadata-only record. */
export function metaOnly(meta: Omit<RepairMedia, "url">): RepairMedia {
  return { ...meta };
}
