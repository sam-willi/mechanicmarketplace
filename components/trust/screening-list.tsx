import type { PublicMechanicProfile } from "@/lib/domain/public-profile";
import { safetyEvidence } from "@/lib/domain/evidence";
import { screeningItems } from "@/lib/domain/eligibility";
import { ScreeningChip } from "./screening";

/** Every verification check for a mechanic, each with its own status. */
export function ScreeningList({ p, compact = false }: { p: PublicMechanicProfile; compact?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Verification checks">
      {screeningItems(p).map((i) => (
        <li key={i.key}>
          <ScreeningChip state={i.state} detail={safetyEvidence(i.key, p.safety[i.key], p.firstName)} compact={compact} />
        </li>
      ))}
    </ul>
  );
}
