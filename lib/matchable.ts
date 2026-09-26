import "server-only";
import type { Repository } from "@/lib/data/repository";
import type { MechanicProfile } from "@/lib/domain/types";
import { toPublicProfile } from "@/lib/domain/public-profile";
import { eligibility, screeningItems } from "@/lib/domain/eligibility";
import { AREAS, findArea, serves } from "@/lib/domain/areas";
import { isWaitingForMatch } from "@/lib/domain/status";
import { screeningOpen } from "@/lib/verification/providers/registry";
import type { ScreeningKind } from "@/lib/domain/types";

export type ReadinessStep = {
  key: string;
  label: string;
  done: boolean;
  detail: string;
  href: string;
  cta: string;
  /** Can't be done yet for reasons outside the mechanic's control (no screening provider connected). */
  waiting?: boolean;
  /** Improves trust and ranking; not needed to receive requests or be booked. */
  optional?: boolean;
};

/**
 * What stands between a mechanic and being sent requests, in the order to do it. Mirrors the
 * matching rule (lib/data/mock/repository.ts `qualifiedMechanics`): a base area and radius,
 * repair types, pricing and availability. The four verification checks follow as optional
 * steps: customers see each one's status, and verified checks improve ranking, but none is
 * required to receive requests or be booked (policy of 2026-09-26).
 */
export function matchReadiness(repo: Repository, m: MechanicProfile) {
  const p = toPublicProfile(repo.getMechanicSources(m.id));
  const based = AREAS.some((a) => a.label === m.neighborhood);
  const items = screeningItems(p);
  // A real mechanic's checks can't run until Clutch connects a real screening provider.
  const closed = (key: string) => key !== "insurance" && !screeningOpen(key as ScreeningKind, repo.scope);
  const waitingOnProvider = items.some((i) => closed(i.key) && i.state !== "verified" && i.state !== "expiring");
  const steps: ReadinessStep[] = [
    {
      key: "area",
      label: "Service area",
      done: based && m.serviceRadiusMi > 0,
      detail: based ? `Based in ${m.neighborhood}, within ${m.serviceRadiusMi} mi` : "Choose the area you're based in, so requests nearby reach you.",
      href: "/mechanic/onboarding?edit=1",
      cta: "Set area",
    },
    {
      key: "repairs",
      label: "Repairs you do",
      done: m.declaredRepairCategories.length > 0,
      detail: m.declaredRepairCategories.length ? `${m.declaredRepairCategories.length} repair types listed` : "Pick the repairs you take on. Clutch only sends matching requests.",
      href: "/mechanic/onboarding?edit=1",
      cta: "Choose repairs",
    },
    {
      key: "availability",
      label: "Availability",
      done: Boolean(m.availabilityNote.trim()) || p.openings.length > 0,
      detail: m.availabilityNote.trim() ? m.availabilityNote : "Say when you usually work, so customers know what to expect.",
      href: "/mechanic/onboarding?edit=1",
      cta: "Add hours",
    },
    {
      key: "pricing",
      label: "Pricing",
      done: m.hourlyRateCents > 0 || m.fixedPrices.length > 0,
      detail: m.hourlyRateCents > 0 ? `$${m.hourlyRateCents / 100}/hr labor` : "Set your labor rate and diagnostic fee.",
      href: "/mechanic/settings",
      cta: "Set prices",
    },
    ...items.map((i) => {
      const done = i.state === "verified" || i.state === "expiring";
      return {
        key: i.key,
        label: i.name,
        done,
        detail: !done && closed(i.key)
          ? "Optional. Can't be completed yet: Clutch hasn't connected a screening company. Customers see it as not completed."
          : `Optional: improves trust and ranking. ${i.privateLabel}`,
        href: "/mechanic/verification",
        cta: !done && closed(i.key) ? "Details" : i.state === "missing" ? "Start" : "Open",
        waiting: !done && closed(i.key),
        optional: true,
      };
    }),
  ];
  // What the mechanic can do now comes first; checks that can't open yet go last.
  steps.sort((a, b) => Number(Boolean(a.optional)) - Number(Boolean(b.optional)) || Number(Boolean(a.waiting)) - Number(Boolean(b.waiting)));
  // The profile steps alone decide whether requests reach them and customers can book them.
  const matchable = eligibility(p).eligible;
  const required = steps.filter((s) => !s.optional);
  return { steps, done: steps.filter((s) => s.done).length, requiredDone: required.filter((s) => s.done).length, requiredTotal: required.length, matchable, waitingOnProvider };
}

/** Saved customer requests that would be sent to this mechanic once they're matchable (counts only). */
export function waitingDemandFor(repo: Repository, m: MechanicProfile) {
  return repo.listAllRequests().filter((r) => {
    if (!isWaitingForMatch(r)) return false;
    const area = findArea(r.location.area);
    if (area && !serves(m, area)) return false;
    return m.declaredRepairCategories.includes(r.repairCategory);
  }).length;
}
