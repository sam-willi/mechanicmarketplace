/**
 * The mechanic's photo, attached to the record like a print. Demo profiles have
 * no real photography, so the print carries initials and says so.
 */
export function PhotoPrint({
  photoUrl,
  initials,
  name,
  size = 84,
}: {
  photoUrl?: string;
  initials: string;
  name: string;
  size?: number;
}) {
  return (
    <div
      className="relative shrink-0 bg-white p-[3px] shadow-[0_1px_2px_rgba(22,24,29,0.12),0_6px_16px_-8px_rgba(22,24,29,0.35)] ring-1 ring-rule-soft"
      style={{ width: size, height: size }}
    >
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={name} className="size-full object-cover" />
      ) : (
        <div
          role="img"
          aria-label={`${name} — photo not provided (demo profile)`}
          className="relative grid size-full place-items-center overflow-hidden bg-[#dfe2dc]"
        >
          <svg className="absolute inset-0 size-full opacity-[0.35]" aria-hidden>
            <defs>
              <pattern id="print-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" stroke="#c7cbc4" strokeWidth="1.2" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#print-hatch)" />
          </svg>
          <span
            className="relative text-ink-2"
            style={{ fontSize: size * 0.36, fontWeight: 800, letterSpacing: "-0.02em" }}
          >
            {initials}
          </span>
        </div>
      )}
    </div>
  );
}
