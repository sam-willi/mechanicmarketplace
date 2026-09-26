import type { DB } from "../mock/seed";
import { putRecord, SPECS, type Spec } from "./spec";

type Doc = Record<string, unknown>;

/**
 * How much of a record was read. "public" rows had private fields removed in the query
 * (screening references, policy numbers, reviewer notes…; see reader.ts `PUBLIC_STRIP`);
 * "full" rows are the whole record. A full read always replaces a public one.
 */
export type Level = "public" | "full";

const specOf = new Map(SPECS.map((s) => [s.collection as string, s]));
export const keyOf = (collection: string, id: string) => `${collection}\u0000${id}`;

export function emptyDB(): DB {
  const db = { profileShares: {}, drafts: {}, customerNotes: {}, events: [] } as unknown as Record<string, unknown>;
  for (const spec of SPECS) if (!spec.map) db[spec.collection] = [];
  return db as unknown as DB;
}

/**
 * The part of the live marketplace one request (or one write transaction) has read: a
 * `DB` holding only those records, so the domain logic runs on it unchanged. Nothing
 * outside the slice exists as far as that request can tell, which is what makes an
 * unauthorized id read as "not found".
 *
 * Lists keep a canonical order (row created_at, then id) whatever order the queries
 * arrived in, so every read path orders ties the same way.
 */
export class Slice {
  readonly db: DB = emptyDB();
  /** JSON of each record as read (the base a write transaction diffs against). */
  readonly persisted = new Map<string, string>();
  /** Row version of each record as read (compare-and-swap on write). */
  readonly versions = new Map<string, number>();
  private readonly levels = new Map<string, Level>();
  private readonly sortKey = new Map<string, string>();
  private dirty = new Set<string>();
  /** Rows and queries this slice has taken from the database (tests and diagnostics). */
  readonly stats = { rows: 0, queries: 0 };

  has(collection: string, id: string, level: Level = "public") {
    const l = this.levels.get(keyOf(collection, id));
    return l === "full" || (l === "public" && level === "public");
  }

  /** Add one row as read. A public row never replaces a full one. */
  add(spec: Spec, data: Doc, version: number, createdAt: string, level: Level) {
    const id = spec.id(data);
    const key = keyOf(spec.collection, id);
    const had = this.levels.get(key);
    if (had === "full" && level === "public") return;
    if (had === level && this.versions.get(key) !== undefined && (this.versions.get(key) ?? 0) >= version) return;
    putRecord(this.db, spec, data);
    this.persisted.set(key, JSON.stringify(data));
    this.versions.set(key, version);
    this.levels.set(key, level);
    this.sortKey.set(key, `${createdAt}\u0000${id}`);
    this.dirty.add(spec.collection);
  }

  /** Records a write transaction committed: newer versions replace what this slice holds. */
  merge(written: { key: string; spec: Spec; doc: Doc; version: number }[], removed: { key: string; spec: Spec; id: string }[]) {
    for (const w of written) {
      if ((this.versions.get(w.key) ?? 0) >= w.version && this.levels.get(w.key) === "full") continue;
      putRecord(this.db, w.spec, w.doc);
      this.persisted.set(w.key, JSON.stringify(w.doc));
      this.versions.set(w.key, w.version);
      this.levels.set(w.key, "full");
      if (!this.sortKey.has(w.key)) this.sortKey.set(w.key, `${new Date().toISOString()}\u0000${w.spec.id(w.doc)}`);
      this.dirty.add(w.spec.collection);
    }
    for (const r of removed) {
      const list = this.db[r.spec.collection] as unknown;
      if (Array.isArray(list)) {
        const i = list.findIndex((x: Doc) => r.spec.id(x) === r.id);
        if (i >= 0) list.splice(i, 1);
      }
      this.persisted.delete(r.key);
      this.versions.delete(r.key);
      this.levels.delete(r.key);
    }
    this.settle();
  }

  /** Put every list touched since the last call back in canonical order. */
  settle() {
    for (const collection of this.dirty) {
      const spec = specOf.get(collection);
      if (!spec || spec.map) continue;
      const list = this.db[spec.collection] as unknown as Doc[];
      const k = (d: Doc) => this.sortKey.get(keyOf(collection, spec.id(d))) ?? "￿";
      list.sort((a, b) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0));
    }
    this.dirty.clear();
  }

  /** How many records of each collection this slice holds. */
  size() {
    const out: Record<string, number> = {};
    for (const spec of SPECS) {
      const v = this.db[spec.collection] as unknown;
      out[spec.collection] = Array.isArray(v) ? v.length : Object.keys(v as object).length;
    }
    return out;
  }
}
