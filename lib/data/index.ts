import "server-only";
import { after } from "next/server";
import { headers } from "next/headers";
import { MockRepository } from "./mock/repository";
import { MUTATIONS, QUERIES, type Mutation, type Repository } from "./repository";
import { current, eventCounts, insertEvent, liveReadsTargeted, liveStore, persistent, ready, recentEvents, transact } from "./store";
import { requestScope, type Scope } from "./scope";
import type { AnalyticsEventName } from "@/lib/domain/types";
import type { DB } from "./mock/seed";
import { Slice } from "./normalized/slice";
import { Reader } from "./normalized/reader";
import { LiveNeeds, type Viewer } from "./normalized/needs";
import { LiveQueries } from "./normalized/queries";
import { PLANS } from "./normalized/plans";
import type { NormalizedLiveStore } from "./normalized/store";

export type { Scope } from "./scope";
export type { Viewer } from "./normalized/needs";

const mutations = new Set<string>(MUTATIONS);
const queries = new Set<string>(QUERIES);

/**
 * Data access for one scope (lib/data/scope.ts). A live repository cannot see, return or
 * link to a demo record, and vice versa: they are different stores.
 *
 * Live marketplace, normalized store, targeted reads (the default whenever
 * CLUTCH_LIVE_STORE=normalized): each request gets its own slice, filled only by the
 * `needs` its page asks for (lib/data/normalized/needs.ts), with the viewer's access
 * rules in the queries. Each write reads its own rows in its own transaction
 * (lib/data/normalized/plans.ts). Nothing is shared between requests or users.
 *
 * Everything else (the demo, the snapshot store, in-memory runs) keeps a whole scope in
 * memory, and `needs` is a no-op there.
 */
/** Where a repository's records live and how its writes commit. The default is this process's store for the scope. */
export interface RepoAdapter {
  current(): DB;
  transact<T>(fn: () => T | Promise<T>, call?: { method: Mutation; args: unknown[] }): Promise<T>;
  /** Async reads run as SQL (targeted live mode). */
  queries?: LiveQueries;
}

function createRepo(scope: Scope, adapter?: RepoAdapter): Repository {
  const core = new MockRepository(scope, adapter ? () => adapter.current() : undefined);
  const commit = <T>(method: Mutation, args: unknown[], fn: () => T | Promise<T>) => (adapter ? adapter.transact(fn, { method, args }) : transact(scope, fn));
  return new Proxy(core, {
    get(target, prop: string) {
      const value = (target as unknown as Record<string, unknown>)[prop];
      if (typeof value !== "function") return value;
      const fn = value as (...a: unknown[]) => unknown;
      if (mutations.has(prop)) return (...args: unknown[]) => commit(prop as Mutation, args, () => fn.apply(target, args));
      if (prop === "track")
        return (name: AnalyticsEventName, props: Record<string, string | number | boolean | undefined>) => {
          fn.call(target, name, props);
          if (!persistent()) return;
          const { mechanicId, actorId, variant, ...rest } = props;
          const e = { id: crypto.randomUUID(), name, mechanicId: mechanicId as string | undefined, actorId: actorId as string | undefined, variant: variant as string | undefined, props: rest, createdAt: new Date().toISOString() };
          // Analytics never block a page; written after the response is sent.
          after(() => insertEvent(scope, e).catch((err) => console.error("[analytics] insert failed", err)));
        };
      if (prop === "analyticsSummary")
        return async (mechanicId: string) => {
          if (!persistent()) return fn.call(target, mechanicId);
          if (!adapter?.queries) await ready(scope);
          const base = fn.call(target, "__none__") as Record<string, number>;
          for (const r of await eventCounts(scope, mechanicId)) if (r.name in base) base[r.name] = Number(r.n);
          base.profile_share += (adapter ? adapter.current() : current(scope)).profileShares[mechanicId] ?? 0;
          base.profile_view_total = base.profile_view;
          return base;
        };
      if (prop === "listEvents")
        return async (limit = 50) => {
          if (!persistent()) return fn.call(target, limit);
          return (await recentEvents(scope, limit)).map((e) => ({
            id: e.id,
            name: e.name,
            mechanicId: e.mechanic_id ?? undefined,
            actorId: e.actor_id ?? undefined,
            variant: e.variant ?? undefined,
            props: e.props,
            createdAt: e.created_at.toISOString(),
          }));
        };
      if (queries.has(prop)) {
        const sqlImpl = adapter?.queries ? (adapter.queries as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[prop] : undefined;
        return async (...args: unknown[]) => (sqlImpl ? sqlImpl.apply(adapter!.queries, args) : fn.apply(target, args));
      }
      return fn.bind(target);
    },
  }) as unknown as Repository;
}

// Per module instance (not globalThis): the data lives in the shared store; these are thin
// views over it, rebuilt when the code reloads so they always have the current methods.
const repos: Partial<Record<Scope, Repository>> = {};

/** A specific scope's whole-store repository (demo, in-memory, snapshot mode). Not for targeted live reads. */
export function repoFor(scope: Scope): Repository {
  return (repos[scope] ??= createRepo(scope));
}

/**
 * A repository over a specific store instance in SNAPSHOT mode (e.g. a second store with its
 * own connection and cache), used to prove behavior across independent server instances.
 */
export function repoOver(scope: Scope, adapter: RepoAdapter & { targeted?: boolean }): Repository {
  if (adapter.targeted) throw new Error("A targeted live store is read through slices: use liveSlice(store).");
  return createRepo(scope, adapter);
}

/** One request's (or one test's) view of the targeted live store. */
export interface LiveContext {
  repo: Repository;
  slice: Slice;
  reader: Reader;
  /** Loaders for a viewer; access rules are applied in the queries. */
  needs(viewer: Viewer): LiveNeeds;
}

/**
 * A fresh slice over a targeted live store: a repository that reads only what `needs`
 * loaded, and whose writes run as planned transactions (and fold what they committed back
 * into this slice, so the same request reads its own writes).
 */
export function liveSlice(store: NormalizedLiveStore): LiveContext {
  const slice = new Slice();
  const reader = new Reader(store.sql, slice);
  const adapter: RepoAdapter = {
    current: () => store.txDb() ?? slice.db,
    async transact(fn, call) {
      const plan = call ? PLANS[call.method] : undefined;
      if (!plan) throw new Error(`No read plan for ${call?.method ?? "this write"}.`);
      const { result, committed, returned } = await store.transactPlanned((r) => plan(r, call!.args), fn);
      if (committed) slice.merge(committed.written, committed.removed);
      // An idempotent write (a retried submit, a second accept) returns what already existed: readable too.
      if (returned) slice.merge([returned], []);
      return result as never;
    },
    queries: new LiveQueries(reader),
  };
  return { repo: createRepo("live", adapter), slice, reader, needs: (viewer) => new LiveNeeds(reader, viewer) };
}

// One LiveContext per incoming request, keyed by that request's own headers object (the same
// object for every headers() call in one request, and never shared between requests).
const g = globalThis as unknown as { __clutchLiveCtx?: WeakMap<object, LiveContext> };
const contexts = (g.__clutchLiveCtx ??= new WeakMap<object, LiveContext>());

async function requestContext(): Promise<LiveContext> {
  let key: object | undefined;
  try {
    key = (await headers()) as unknown as object;
  } catch {
    key = undefined; // outside a request (scripts): a one-off slice
  }
  if (!key) return liveSlice(liveStore());
  let ctx = contexts.get(key);
  if (!ctx) contexts.set(key, (ctx = liveSlice(liveStore())));
  return ctx;
}

/** Is this scope read through per-request slices? */
export function targetedScope(scope: Scope) {
  return scope === "live" && liveReadsTargeted();
}

/** This request's data: decides the scope from the session, loads it, and returns its repository. */
export async function getRepo(): Promise<Repository> {
  const scope = await requestScope();
  if (targetedScope(scope)) {
    await liveStore().ensureSchema();
    return (await requestContext()).repo;
  }
  await ready(scope);
  return repoFor(scope);
}

/** A scope's repository, loaded and ready. For "live" in targeted mode: this request's slice repository. */
export async function readyRepo(scope: Scope): Promise<Repository> {
  if (targetedScope(scope)) {
    await liveStore().ensureSchema();
    return (await requestContext()).repo;
  }
  await ready(scope);
  return repoFor(scope);
}

/** The display name of an account, for server-to-server work with no session (provider webhooks). */
export async function accountName(scope: Scope, userId: string): Promise<string | undefined> {
  const repo = await readyRepo(scope);
  if (targetedScope(scope)) await (await requestContext()).reader.user(userId);
  return repo.getUser(userId)?.name;
}

/** No-op loaders, for stores that already hold the whole scope in memory. */
const NOOP = new Proxy({}, { get: (_t, prop) => (prop === "then" ? undefined : async () => undefined) }) as LiveNeeds;

/**
 * What this request's page or action needs from the live marketplace, for this viewer.
 * In targeted live mode each call runs the scoped queries into the request's slice; for
 * the demo and in-memory stores it does nothing (they already hold the whole scope).
 */
export async function needsFor(viewer: Viewer): Promise<LiveNeeds> {
  const scope = await requestScope();
  if (!targetedScope(scope)) return NOOP;
  return (await requestContext()).needs(viewer);
}

/** Loaders for a named scope, whatever this request's scope cookie says (real Supabase accounts are always live). */
export async function needsIn(scope: Scope, viewer: Viewer): Promise<LiveNeeds> {
  if (!targetedScope(scope)) return NOOP;
  return (await requestContext()).needs(viewer);
}

export { requestScope };
