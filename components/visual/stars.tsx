import { useId } from "react";

/**
 * A rating as five stars, filled to the exact value (4.7 → four and most of a
 * fifth). Usually the number sits beside it, so the stars are hidden from
 * screen readers; pass `labelled` where they stand alone.
 */
export function StarRating({ value, size = 14, className = "", labelled = false }: { value: number; size?: number; className?: string; labelled?: boolean }) {
  const id = useId();
  const v = Math.max(0, Math.min(5, value));
  return (
    <span className={`inline-flex shrink-0 items-center gap-px align-[-0.125em] ${className}`} {...(labelled ? { role: "img", "aria-label": `${v % 1 ? v.toFixed(1) : v} out of 5 stars` } : { "aria-hidden": true })}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, v - i));
        const clip = `${id}-s${i}`;
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden>
            <defs>
              <clipPath id={clip}>
                <rect x="0" y="0" width={24 * fill} height="24" />
              </clipPath>
            </defs>
            <path d={STAR} fill="none" stroke="var(--star)" strokeWidth="1.6" strokeLinejoin="round" />
            <path d={STAR} fill="var(--star)" clipPath={`url(#${clip})`} />
          </svg>
        );
      })}
    </span>
  );
}

const STAR = "M12 2.6l2.9 5.9 6.5.95-4.7 4.6 1.1 6.5L12 17.5l-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95z";
