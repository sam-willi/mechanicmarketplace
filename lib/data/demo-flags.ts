import type { DB } from "./mock/seed";

/**
 * Demo-only flags that a real (live) record must never carry.
 *
 * Before 2026-09-26 15:07 PT (commit a8baa5b) onboarding created every new mechanic with
 * `isDemo: true`, a name-based id (`mech-<slug>`) and a default map position, and editing a
 * profile never removed the flag. Real accounts made in that window kept it after the data
 * scopes were split. Nothing reads the flag, but a live record must not look like demo data.
 */

type Doc = Record<string, unknown> & { id?: string };
export type InheritedFlag = { collection: "mechanics"; id: string; userId: string; reason: string };

/**
 * Live mechanics whose `isDemo: true` is provably wrong: the record is not part of the demo
 * seed (by id), and it belongs to a live account that is itself not a demo account (no demo
 * flag, not a seed user, no @clutch.demo address). Anything else (a seed record found in the
 * live scope, or a mechanic owned by a demo account) is a leak, not an inherited flag, and is
 * left alone for the scope checks to report.
 */
export function inheritedDemoFlags(live: Pick<DB, "mechanics" | "users">, seed: Pick<DB, "mechanics" | "users">): InheritedFlag[] {
  const seedMechanics = new Set(seed.mechanics.map((m) => m.id));
  const seedUsers = new Set(seed.users.map((u) => u.id));
  const users = new Map((live.users as unknown as Doc[]).map((u) => [String(u.id), u]));
  const out: InheritedFlag[] = [];
  for (const m of live.mechanics as unknown as Doc[]) {
    if (m.isDemo !== true) continue;
    const id = String(m.id);
    const userId = String(m.userId ?? "");
    const u = users.get(userId);
    if (seedMechanics.has(id) || !u || seedUsers.has(userId) || u.demo === true || String(u.email ?? "").toLowerCase().endsWith("@clutch.demo")) continue;
    out.push({ collection: "mechanics", id, userId, reason: "created by pre-a8baa5b onboarding, which flagged every new mechanic as demo; owned by a real account" });
  }
  return out;
}
