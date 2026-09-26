import { AREAS } from "@/lib/domain/areas";

/**
 * Service area, drawn from real coordinates: LA neighborhoods as dots, the
 * mechanic's base, and their service radius. No map tiles, no third party.
 */
export function ServiceAreaMap({
  lat,
  lng,
  radiusMi,
  label,
  highlight,
}: {
  lat: number;
  lng: number;
  radiusMi: number;
  label: string;
  highlight?: { lat: number; lng: number; label: string };
}) {
  const W = 320;
  const H = 220;
  const minLat = 33.74, maxLat = 34.22, minLng = -118.54, maxLng = -118.08;
  const x = (g: number) => ((g - minLng) / (maxLng - minLng)) * W;
  const y = (t: number) => ((maxLat - t) / (maxLat - minLat)) * H;
  const pxPerMi = W / ((maxLng - minLng) * 57.3); // ~57.3 mi per degree of longitude at LA's latitude
  const r = radiusMi * pxPerMi;
  const inside = (a: { lat: number; lng: number }) => Math.hypot(x(a.lng) - x(lng), y(a.lat) - y(lat)) <= r;
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full border border-rule bg-sheet" role="img" aria-label={`Service area: about ${radiusMi} miles around ${label}`}>
        <defs>
          <pattern id="map-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0H0V20" fill="none" stroke="var(--rule-soft)" strokeWidth="0.6" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#map-grid)" />
        {/* the coast, roughly: Santa Monica Bay to Long Beach */}
        <path d={`M0 ${y(34.04)} L${x(-118.5)} ${y(34.02)} L${x(-118.46)} ${y(33.98)} L${x(-118.42)} ${y(33.9)} L${x(-118.39)} ${y(33.82)} L${x(-118.3)} ${y(33.74)} L0 ${H} Z`} fill="var(--paper)" stroke="var(--rule)" strokeWidth="1" />
        <circle cx={x(lng)} cy={y(lat)} r={r} fill="var(--brand)" fillOpacity="0.1" stroke="var(--brand)" strokeWidth="1.2" strokeDasharray="4 3" />
        {AREAS.map((a) => (
          <g key={a.key}>
            <circle cx={x(a.lng)} cy={y(a.lat)} r="2.2" fill={inside(a) ? "var(--ink)" : "var(--rule)"} />
            {inside(a) && (
              <text x={x(a.lng) + 4} y={y(a.lat) + 3} fontSize="8" fill="var(--ink-2)" fontWeight="600">
                {a.label}
              </text>
            )}
          </g>
        ))}
        {highlight && (
          <g>
            <circle cx={x(highlight.lng)} cy={y(highlight.lat)} r="5" fill="var(--canary)" stroke="var(--ink)" strokeWidth="1.2" />
          </g>
        )}
        <rect x={x(lng) - 4.5} y={y(lat) - 4.5} width="9" height="9" fill="var(--brand)" />
      </svg>
      <figcaption className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[0.75rem] text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 bg-brand" aria-hidden /> Based in {label}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0 w-4 border-t border-dashed border-ink" aria-hidden /> Travels about {radiusMi} miles
        </span>
        {highlight && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full border border-ink bg-canary" aria-hidden /> {highlight.label}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
