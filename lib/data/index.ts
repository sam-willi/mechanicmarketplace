import "server-only";
import { after } from "next/server";
import { MockRepository } from "./mock/repository";
import { MUTATIONS, type Repository } from "./repository";
import { current, eventCounts, insertEvent, persistent, ready, recentEvents, transact } from "./store";
import type { AnalyticsEventName } from "@/lib/domain/types";

export { ready } from "./store";

const core = new MockRepository();
const mutations = new Set<string>(MUTATIONS);

/**
 * The app's data access. Reads run against the current snapshot (call
 * `await ready()` first in a request; getSession() does it for you). Writes
 * return a Promise that resolves once the change is committed.
 */
export const repo = new Proxy(core, {
  get(target, prop: string) {
    const value = (target as unknown as Record<string, unknown>)[prop];
    if (typeof value !== "function") return value;
    const fn = value as (...a: unknown[]) => unknown;
    if (mutations.has(prop)) return (...args: unknown[]) => transact(() => fn.apply(target, args));
    if (prop === "track")
      return (name: AnalyticsEventName, props: Record<string, string | number | boolean | undefined>) => {
        fn.call(target, name, props);
        if (!persistent()) return;
        const { mechanicId, actorId, variant, ...rest } = props;
        const e = { id: crypto.randomUUID(), name, mechanicId: mechanicId as string | undefined, actorId: actorId as string | undefined, variant: variant as string | undefined, props: rest, createdAt: new Date().toISOString() };
        // Analytics never block a page; written after the response is sent.
        after(() => insertEvent(e).catch((err) => console.error("[analytics] insert failed", err)));
      };
    if (prop === "analyticsSummary")
      return async (mechanicId: string) => {
        if (!persistent()) return fn.call(target, mechanicId);
        await ready();
        const base = fn.call(target, "__none__") as Record<string, number>;
        for (const r of await eventCounts(mechanicId)) if (r.name in base) base[r.name] = Number(r.n);
        base.profile_share += current().profileShares[mechanicId] ?? 0;
        base.profile_view_total = base.profile_view;
        return base;
      };
    if (prop === "listEvents")
      return async (limit = 50) => {
        if (!persistent()) return fn.call(target, limit);
        return (await recentEvents(limit)).map((e) => ({
          id: e.id,
          name: e.name,
          mechanicId: e.mechanic_id ?? undefined,
          actorId: e.actor_id ?? undefined,
          variant: e.variant ?? undefined,
          props: e.props,
          createdAt: e.created_at.toISOString(),
        }));
      };
    return fn.bind(target);
  },
}) as unknown as Repository;
