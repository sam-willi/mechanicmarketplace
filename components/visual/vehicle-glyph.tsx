/**
 * Vehicle visual indicator: a side-profile outline by body type, drawn in the
 * site's line style. Real information (body type, make, model) instead of a
 * stock car photo. A customer's own photo replaces it when they add one.
 */
export type BodyType = "sedan" | "suv" | "truck" | "hatch" | "coupe" | "van";

const TRUCKS = /f-?150|silverado|tacoma|ranger|frontier|colorado|gladiator|tundra|ram/i;
const SUVS = /\bx[1-7]\b|x3|x5|rav4|cr-v|pilot|highlander|explorer|escape|rogue|equinox|tahoe|q5|q7|tiguan|tucson|santa fe|sorento|sportage|cx-[59]|wrangler|cherokee|outback|forester|crosstrek|rx|nx|mdx|rdx|glc|ml|model y|4runner/i;
const VANS = /odyssey|sienna|pacifica|transit|sprinter/i;
const HATCHES = /\bfit\b|gti|golf|soul|prius|impreza|ct 200h|mazda3/i;
const COUPES = /\b1[0-9]{2}i\b|\b4[0-9]{2}i\b|\b2[0-9]{2}i\b|mustang|camaro|brz|86\b|miata/i;

export function bodyType(model: string): BodyType {
  if (TRUCKS.test(model)) return "truck";
  if (VANS.test(model)) return "van";
  if (SUVS.test(model)) return "suv";
  if (COUPES.test(model)) return "coupe";
  if (HATCHES.test(model)) return "hatch";
  return "sedan";
}

const PATHS: Record<BodyType, string> = {
  sedan: "M5 38 L6 30 L22 27 L35 18 L64 17 L81 26 L101 28 L104 31 L104 38",
  coupe: "M5 38 L6 31 L27 27 L44 19 L66 18 L86 27 L102 29 L104 38",
  hatch: "M7 38 L8 28 L20 25 L32 15 L80 14 L92 24 L94 38",
  suv: "M5 38 L5 25 L19 22 L30 10 L92 10 L100 20 L104 22 L104 38",
  truck: "M5 38 L5 24 L19 22 L28 10 L56 10 L60 22 L104 22 L104 38",
  van: "M5 38 L5 16 L15 8 L100 8 L104 18 L104 38",
};

/** The side windows, so body types read apart at small sizes. */
const WINDOWS: Record<BodyType, string> = {
  sedan: "M37 20 L62 19 L75 26 L30 26 Z",
  coupe: "M45 21 L64 20 L79 27 L37 27 Z",
  hatch: "M34 17 L78 16 L87 24 L26 24 Z",
  suv: "M32 13 L89 13 L95 21 L24 21 Z",
  truck: "M30 13 L53 13 L55 21 L23 21 Z",
  van: "M18 11 L97 11 L100 17 L12 17 Z",
};

export function VehicleGlyph({ model, width = 96, className = "" }: { model: string; width?: number; className?: string }) {
  const t = bodyType(model);
  const wheelX = t === "hatch" ? [26, 78] : [28, 84];
  return (
    <svg viewBox="0 0 110 46" width={width} height={(width * 46) / 110} className={className} aria-hidden>
      <path d={PATHS[t]} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      <path d={WINDOWS[t]} fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <line x1="4" y1="38" x2="106" y2="38" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      {wheelX.map((x) => (
        <g key={x}>
          <circle cx={x} cy="38" r="7" fill="var(--sheet)" stroke="currentColor" strokeWidth="2.2" />
          <circle cx={x} cy="38" r="2" fill="currentColor" />
        </g>
      ))}
    </svg>
  );
}

/** Square/landscape tile: the customer's photo if they added one, otherwise the outline + make/model. */
export function VehicleTile({
  v,
  className = "",
  size = "md",
}: {
  v: { year: number; make: string; model: string; photoUrl?: string };
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const name = [v.year || null, v.make, v.model].filter(Boolean).join(" ");
  const h = size === "sm" ? "h-16 w-24" : size === "lg" ? "h-40 w-full" : "h-24 w-36";
  if (v.photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={v.photoUrl} alt={name} className={`${h} shrink-0 border border-rule object-cover ${className}`} />;
  }
  return (
    <div className={`${h} relative flex shrink-0 flex-col items-center justify-center border border-brand-tint bg-brand-wash text-brand ${className}`} role="img" aria-label={`${name} (no photo)`}>
      <VehicleGlyph model={v.model} width={size === "sm" ? 60 : size === "lg" ? 150 : 88} />
      <span className={`mt-1 font-extrabold tracking-[0.06em] text-brand-deep uppercase ${size === "sm" ? "text-[0.5625rem]" : "text-[0.6875rem]"}`}>{v.make}</span>
    </div>
  );
}
