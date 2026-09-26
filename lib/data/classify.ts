import type { DB } from "./mock/seed";

/**
 * One-time split of a database created before data scopes existed, where the
 * fictional seed and real accounts shared one store.
 *
 * Deterministic: a record is demo when it is part of the seed (by collection
 * and id, never by name) or is owned by a demo record; everything else is
 * live. Relationships that crossed the two are made safe without deleting
 * anything:
 *  - list links to the other scope (e.g. a live request "matched" to a demo
 *    mechanic) are removed from the list and kept on the record under
 *    `crossScopeRefs`;
 *  - records that can't exist without the other scope (a demo mechanic's quote
 *    on a live request, a job or review built on one) move to quarantine.
 */

type Scope = "live" | "demo";
type Doc = Record<string, unknown> & { id?: string };
export type Quarantined = { collection: string; id: string; data: Doc; reason: string };

export interface SplitResult {
  live: DB;
  demo: DB;
  quarantine: Quarantined[];
  /** Records whose content changed (cross-scope list links moved to crossScopeRefs). */
  changed: { collection: string; id: string }[];
  /** Ids per entity kind that ended up demo, for classifying side tables (events, media). */
  demoIds: { users: Set<string>; customers: Set<string>; mechanics: Set<string> };
}

const LISTS = [
  "users", "mechanics", "customers", "vehicles", "screenings", "insurance", "credentials", "employment", "pastRepairs",
  "confirmations", "verifications", "requests", "quotes", "jobs", "reviews", "saved", "events", "notifications", "supportReports",
] as const;

const keyOf = (collection: string, d: Doc) => (collection === "saved" ? `${d.customerId}:${d.mechanicId}` : String(d.id));

function emptyDB(): DB {
  const db = { profileShares: {}, drafts: {}, customerNotes: {} } as unknown as Record<string, unknown>;
  for (const l of LISTS) db[l] = [];
  return db as unknown as DB;
}

export function splitByScope(mixed: DB, seed: DB): SplitResult {
  const seedKeys = new Set<string>();
  for (const l of LISTS) for (const d of (seed[l] ?? []) as unknown as Doc[]) seedKeys.add(`${l}\u0000${keyOf(l, d)}`);
  const isSeed = (l: string, d: Doc) => seedKeys.has(`${l}\u0000${keyOf(l, d)}`);

  const live = emptyDB();
  const demo = emptyDB();
  const quarantine: Quarantined[] = [];
  const changed: SplitResult["changed"] = [];
  const scopeOf: Record<string, Map<string, Scope>> = {};
  const quarantined = new Set<string>();
  const put = (l: (typeof LISTS)[number], d: Doc, s: Scope) => {
    ((s === "live" ? live : demo)[l] as unknown as Doc[]).push(d);
    (scopeOf[l] ??= new Map()).set(keyOf(l, d), s);
  };
  const sc = (l: string, id: unknown) => (typeof id === "string" ? scopeOf[l]?.get(id) : undefined);
  const q = (l: string, d: Doc, reason: string) => {
    quarantine.push({ collection: l, id: keyOf(l, d), data: d, reason });
    quarantined.add(`${l}\u0000${keyOf(l, d)}`);
  };
  const isQ = (l: string, id: unknown) => typeof id === "string" && quarantined.has(`${l}\u0000${id}`);
  const list = <T extends Doc>(l: (typeof LISTS)[number]) => ((mixed[l] ?? []) as unknown as T[]);

  // Owners first: accounts, then profiles.
  for (const u of list("users")) put("users", u, u.demo === true || isSeed("users", u) ? "demo" : "live");
  for (const c of list("customers")) put("customers", c, isSeed("customers", c) || sc("users", c.userId) === "demo" ? "demo" : "live");
  for (const m of list("mechanics")) put("mechanics", m, isSeed("mechanics", m) || sc("users", m.userId) === "demo" ? "demo" : "live");

  const owned = (l: (typeof LISTS)[number], owner: string, field: string) => {
    for (const d of list(l)) put(l, d, isSeed(l, d) || sc(owner, d[field]) === "demo" ? "demo" : "live");
  };
  owned("vehicles", "customers", "customerId");
  for (const l of ["screenings", "insurance", "credentials", "employment", "pastRepairs"] as const) owned(l, "mechanics", "mechanicId");
  owned("verifications", "mechanics", "mechanicId");
  for (const d of list("confirmations")) {
    const repairScope = sc("pastRepairs", d.pastRepairId);
    put("confirmations", d, isSeed("confirmations", d) || repairScope === "demo" ? "demo" : "live");
  }

  // Requests belong to their customer; mechanic lists that point across are moved aside.
  for (const r of list("requests")) {
    const s: Scope = isSeed("requests", r) || sc("customers", r.customerId) === "demo" ? "demo" : "live";
    const other = (id: unknown) => typeof id === "string" && sc("mechanics", id) !== undefined && sc("mechanics", id) !== s;
    const cross: Record<string, unknown> = {};
    const keep = (field: string, pick: (x: unknown) => unknown = (x) => x) => {
      const arr = Array.isArray(r[field]) ? (r[field] as unknown[]) : [];
      const bad = arr.filter((x) => other(pick(x)));
      if (bad.length) {
        cross[field] = bad;
        r[field] = arr.filter((x) => !other(pick(x)));
      }
    };
    keep("matchedMechanicIds");
    keep("declinedBy");
    keep("interested", (x) => (x as { mechanicId?: string }).mechanicId);
    keep("questions", (x) => (x as { mechanicId?: string }).mechanicId);
    keep("declines", (x) => (x as { mechanicId?: string }).mechanicId);
    for (const f of ["requestedMechanicId", "rebookOf"]) {
      if (!other(r[f])) continue;
      cross[f] = r[f];
      delete r[f];
    }
    if (Object.keys(cross).length) {
      r.crossScopeRefs = { ...(r.crossScopeRefs as object | undefined), ...cross };
      changed.push({ collection: "requests", id: String(r.id) });
    }
    put("requests", r, s);
  }

  // A quote needs its mechanic and its request in the same scope.
  for (const d of list("quotes")) {
    const m = sc("mechanics", d.mechanicId);
    const r = sc("requests", d.requestId);
    if (m && r && m !== r) q("quotes", d, "mechanic and request are in different scopes");
    else put("quotes", d, isSeed("quotes", d) || (r ?? m) === "demo" ? "demo" : "live");
  }
  for (const d of list("jobs")) {
    const parts = [sc("mechanics", d.mechanicId), sc("customers", d.customerId), sc("requests", d.requestId), sc("quotes", d.quoteId)].filter(Boolean);
    if (isQ("quotes", d.quoteId) || new Set(parts).size > 1) q("jobs", d, "built on records from both scopes");
    else put("jobs", d, isSeed("jobs", d) || parts[0] === "demo" ? "demo" : "live");
  }
  for (const d of list("reviews")) {
    const m = sc("mechanics", d.mechanicId);
    const j = d.jobId ? sc("jobs", d.jobId) : undefined;
    if (isQ("jobs", d.jobId) || (j && m && j !== m)) q("reviews", d, "reviews a job from the other scope");
    else put("reviews", d, isSeed("reviews", d) || (m ?? j) === "demo" ? "demo" : "live");
  }
  for (const d of list("saved")) {
    const c = sc("customers", d.customerId);
    const m = sc("mechanics", d.mechanicId);
    if (c && m && c !== m) q("saved", d, "customer and mechanic are in different scopes");
    else put("saved", d, isSeed("saved", d) || (c ?? m) === "demo" ? "demo" : "live");
  }
  owned("notifications", "users", "userId");
  owned("supportReports", "users", "userId");
  for (const e of list("events")) {
    const s = isSeed("events", e) || sc("mechanics", e.mechanicId) === "demo" || sc("users", e.actorId) === "demo" || sc("customers", e.actorId) === "demo" ? "demo" : "live";
    put("events", e, s);
  }

  // Maps: split entries by the scope of their key.
  for (const [mid, n] of Object.entries(mixed.profileShares ?? {})) (sc("mechanics", mid) === "demo" ? demo : live).profileShares[mid] = n;
  for (const [cid, draft] of Object.entries(mixed.drafts ?? {})) (sc("customers", cid) === "demo" ? demo : live).drafts[cid] = draft;
  for (const [mid, notes] of Object.entries(mixed.customerNotes ?? {})) {
    const s = sc("mechanics", mid) === "demo" ? "demo" : "live";
    for (const [cid, note] of Object.entries(notes)) {
      if (sc("customers", cid) && sc("customers", cid) !== s) {
        quarantine.push({ collection: "customerNotes", id: `${mid}:${cid}`, data: { mechanicId: mid, customerId: cid, note }, reason: "note about a customer in the other scope" });
        continue;
      }
      ((s === "demo" ? demo : live).customerNotes[mid] ??= {})[cid] = note;
    }
  }

  // Anything the ownership rules kept that still points across (e.g. a real user's
  // notification about a demo job) is caught by the general link check.
  for (const [mine, theirs] of [[live, demo], [demo, live]] as const) {
    const leaks = crossScopeLeaks(mine, theirs);
    quarantine.push(...leaks.quarantine);
    for (const c of leaks.changed) if (!changed.some((x) => x.collection === c.collection && x.id === c.id)) changed.push(c);
  }

  const ids = (l: string) => new Set([...(scopeOf[l] ?? new Map()).entries()].filter(([, s]) => s === "demo").map(([id]) => id));
  return { live, demo, quarantine, changed, demoIds: { users: ids("users"), customers: ids("customers"), mechanics: ids("mechanics") } };
}

export interface LeakResult {
  /** Records that only make sense with the other scope's records. */
  quarantine: Quarantined[];
  /** Records kept, with list links to the other scope moved to `crossScopeRefs` (mutated in place). */
  changed: { collection: string; id: string }[];
}

/** App paths that name a record: /customer/requests/:id, /mechanic/jobs/:id, /mechanics/:slug, … */
const HREF_REFS: [RegExp, string, "id" | "slug"][] = [
  [/\/requests\/([^/?#]+)/, "requests", "id"],
  [/\/jobs\/([^/?#]+)/, "jobs", "id"],
  [/\/quotes\/([^/?#]+)/, "quotes", "id"],
  [/\/vehicles\/([^/?#]+)/, "vehicles", "id"],
  [/\/admin\/reviews\/([^/?#]+)/, "verifications", "id"],
  [/^\/mechanics\/([^/?#]+)/, "mechanics", "slug"],
];

/**
 * The scope invariant: every link a record holds resolves in its own scope.
 * Finds records in `db` that point at something that exists only in `other`
 * (a live notification about a demo job, a live request matched to a demo
 * mechanic, …). Links that resolve nowhere are left alone. Used after the
 * one-time split and as a standing check, so fixes are deterministic and never
 * rely on names.
 */
export function crossScopeLeaks(db: DB, other: DB): LeakResult {
  const idx = (d: DB, l: string, field = "id") => new Set(((d as unknown as Record<string, Doc[]>)[l] ?? []).map((x) => String(x[field])));
  const cache = new Map<string, [Set<string>, Set<string>]>();
  const sets = (l: string, field = "id") => {
    const k = `${l}.${field}`;
    if (!cache.has(k)) cache.set(k, [idx(db, l, field), idx(other, l, field)]);
    return cache.get(k)!;
  };
  /** True when `id` is a record of `l` only in the other scope. */
  const foreign = (l: string, id: unknown, field = "id") => {
    if (typeof id !== "string" || !id) return false;
    const [mine, theirs] = sets(l, field);
    return !mine.has(id) && theirs.has(id);
  };
  const quarantine: Quarantined[] = [];
  const changed: LeakResult["changed"] = [];
  const kept = <T extends Doc>(l: string, check: (d: T) => string | undefined) => {
    const list = (db as unknown as Record<string, T[]>)[l] ?? [];
    const keep: T[] = [];
    for (const d of list) {
      const reason = check(d);
      if (reason) quarantine.push({ collection: l, id: keyOf(l, d), data: d, reason });
      else keep.push(d);
    }
    (db as unknown as Record<string, T[]>)[l] = keep;
  };

  kept("customers", (d) => (foreign("users", d.userId) ? "account is in the other scope" : undefined));
  kept("mechanics", (d) => (foreign("users", d.userId) ? "account is in the other scope" : undefined));
  kept("vehicles", (d) => (foreign("customers", d.customerId) ? "owner is in the other scope" : undefined));
  for (const l of ["screenings", "insurance", "credentials", "employment", "pastRepairs", "verifications"]) {
    kept(l, (d) => (foreign("mechanics", d.mechanicId) ? "mechanic is in the other scope" : undefined));
  }
  kept("confirmations", (d) => (foreign("pastRepairs", d.pastRepairId) ? "repair record is in the other scope" : undefined));
  kept("requests", (d) => (foreign("customers", d.customerId) || foreign("vehicles", d.vehicleId) ? "customer or car is in the other scope" : undefined));
  for (const r of db.requests as unknown as Doc[]) {
    const cross: Record<string, unknown> = {};
    const strip = (field: string, pick: (x: unknown) => unknown = (x) => x) => {
      if (!Array.isArray(r[field])) return;
      const arr = r[field] as unknown[];
      const bad = arr.filter((x) => foreign("mechanics", pick(x)));
      if (!bad.length) return;
      cross[field] = bad;
      r[field] = arr.filter((x) => !foreign("mechanics", pick(x)));
    };
    strip("matchedMechanicIds");
    strip("declinedBy");
    strip("interested", (x) => (x as Doc).mechanicId);
    strip("questions", (x) => (x as Doc).mechanicId);
    strip("declines", (x) => (x as Doc).mechanicId);
    for (const f of ["requestedMechanicId", "rebookOf"]) {
      if (!foreign("mechanics", r[f])) continue;
      cross[f] = r[f];
      delete r[f];
    }
    if (Object.keys(cross).length) {
      r.crossScopeRefs = { ...(r.crossScopeRefs as object | undefined), ...cross };
      changed.push({ collection: "requests", id: String(r.id) });
    }
  }
  kept("quotes", (d) => (foreign("requests", d.requestId) || foreign("mechanics", d.mechanicId) ? "request or mechanic is in the other scope" : undefined));
  kept("jobs", (d) =>
    ["requests:requestId", "quotes:quoteId", "mechanics:mechanicId", "customers:customerId", "vehicles:vehicleId"].some((p) => {
      const [l, f] = p.split(":");
      return foreign(l, d[f]);
    })
      ? "built on records in the other scope"
      : undefined,
  );
  kept("reviews", (d) => (foreign("mechanics", d.mechanicId) || foreign("jobs", d.jobId) ? "reviews a mechanic or job in the other scope" : undefined));
  kept("saved", (d) => (foreign("customers", d.customerId) || foreign("mechanics", d.mechanicId) ? "customer or mechanic is in the other scope" : undefined));
  const hrefLeak = (href: unknown) => {
    if (typeof href !== "string") return false;
    return HREF_REFS.some(([re, l, field]) => {
      const m = href.match(re);
      return Boolean(m && foreign(l, decodeURIComponent(m[1]), field));
    });
  };
  kept("notifications", (d) => (foreign("users", d.userId) ? "account is in the other scope" : hrefLeak(d.href) ? "links to a record in the other scope" : undefined));
  kept("supportReports", (d) => (foreign("users", d.userId) || foreign("jobs", d.jobId) || foreign("requests", d.requestId) ? "about records in the other scope" : undefined));

  // Maps keyed by record ids.
  for (const [mid, notes] of Object.entries(db.customerNotes ?? {})) {
    for (const cid of Object.keys(notes)) {
      if (foreign("mechanics", mid) || foreign("customers", cid)) {
        quarantine.push({ collection: "customerNotes", id: `${mid}:${cid}`, data: { mechanicId: mid, customerId: cid, note: notes[cid] }, reason: "note links the other scope" });
        delete notes[cid];
      }
    }
  }
  for (const cid of Object.keys(db.drafts ?? {})) if (foreign("customers", cid)) delete db.drafts[cid];
  for (const mid of Object.keys(db.profileShares ?? {})) if (foreign("mechanics", mid)) delete db.profileShares[mid];
  return { quarantine, changed };
}
