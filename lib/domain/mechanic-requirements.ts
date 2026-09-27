/**
 * What a mechanic needs for each thing on Clutch, in the words onboarding shows. Kept beside the
 * rule itself (lib/domain/eligibility.ts readiness): the basic profile is what lets requests reach
 * a mechanic, estimates go out and customers book; verification checks are optional and shown
 * separately. (Policy of 2026-09-26, pending legal review.)
 */
export const UNLOCKS: { goal: string; needs: string }[] = [
  {
    goal: "Receive requests, send estimates and be booked",
    needs: "Your basic profile: where you start from and how far you travel, the repairs you do, your prices and when you're available.",
  },
  {
    goal: "Verification checks (optional)",
    needs: "Identity, background, driving record and insurance each show on your profile with their own status. None is required to be booked; verified checks build trust and rank you higher at equal experience.",
  },
  {
    goal: "Rank for matching jobs",
    needs: "Verified repairs of that type and make, from Clutch jobs or confirmed by past customers.",
  },
];
