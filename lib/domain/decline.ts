import type { DeclineReason } from "./types";

export const DECLINE_REASONS: DeclineReason[] = ["booked_up", "not_my_specialty", "too_far", "other"];

/** What the customer is told, in plain words. Never more than the mechanic chose to share. */
export const DECLINE_REASON_TEXT: Record<DeclineReason, string | null> = {
  booked_up: "They're fully booked for the time you need.",
  not_my_specialty: "They don't think they're the right fit for this car or repair.",
  too_far: "Your location is outside where they can travel.",
  other: null,
};

/** The mechanic-facing labels for the same reasons. */
export const DECLINE_REASON_LABEL: Record<DeclineReason, string> = {
  booked_up: "I'm booked up",
  not_my_specialty: "Not the right fit for me",
  too_far: "Too far away",
  other: "Something else",
};
