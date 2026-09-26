"use server";

import { ready, repo } from "@/lib/data";
import { getSession, getSessionId } from "@/lib/session";
import type { AnalyticsEventName, EvidenceVariant } from "@/lib/domain/types";

const CLIENT_EVENTS: AnalyticsEventName[] = [
  "profile_share",
  "verification_badge_clicked",
  "repair_request_started",
  "quote_requested",
];

/** Client-originated analytics. Server-originated events call repo.track directly. */
export async function trackClient(
  name: AnalyticsEventName,
  props: { mechanicId?: string; variant?: EvidenceVariant; [k: string]: string | number | boolean | undefined },
) {
  await ready();
  if (!CLIENT_EVENTS.includes(name)) return;
  const session = await getSession();
  const sessionId = await getSessionId();
  repo.track(name, { ...props, actorId: session.role === "customer" ? session.customerId : undefined, session: sessionId });
}
