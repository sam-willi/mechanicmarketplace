import Image from "next/image";

/**
 * How to frame the photos mechanics find most useful. Line drawings of the
 * framing, not stock photos: they show what to capture, not someone's car.
 */
type Guide = "dashboard" | "part" | "vin" | "location";

const GUIDES: Record<Guide, { title: string; tip: string; alt: string }> = {
  dashboard: {
    title: "Dashboard lights",
    tip: "Engine running, whole cluster in frame, no glare.",
    alt: "A dashboard with warning lights on, the whole cluster in frame",
  },
  part: {
    title: "The damaged part",
    tip: "One wide shot to show where, one close-up. Add a coin for scale.",
    alt: "A wheel and tire, shown whole",
  },
  vin: {
    title: "VIN",
    tip: "Driver-side corner of the windshield, or the door-jamb sticker.",
    alt: "The base of the windshield with the VIN plate highlighted",
  },
  location: {
    title: "Where it's parked",
    tip: "Step back so the car and the space around it are in frame.",
    alt: "A car seen from above, parked between two lines",
  },
};

export function PhotoGuide({ show }: { show: Guide[] }) {
  return (
    <ul className={`grid gap-2 ${show.length > 1 ? "grid-cols-2 sm:grid-cols-4" : "max-w-[15rem]"}`} aria-label="What to photograph">
      {show.map((g) => (
        <li key={g} className="border border-rule-soft bg-paper p-2">
          <Image src={`/guides/${g}.webp`} alt={`Example framing: ${GUIDES[g].alt}`} width={600} height={360} className="h-auto w-full" />
          <p className="mt-1 text-[0.8125rem] font-semibold">{GUIDES[g].title}</p>
          <p className="text-[0.75rem] leading-snug text-ink-2">{GUIDES[g].tip}</p>
        </li>
      ))}
    </ul>
  );
}
