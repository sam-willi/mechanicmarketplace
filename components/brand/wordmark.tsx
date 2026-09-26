import Link from "next/link";
import { LOGO_PATH, LOGO_VIEWBOX } from "./logo-path";

/** The Clutch logo: a wrench forming the C. Inherits text colour, so it works on ink and paper. */
export function Logo({ height = 24, className = "" }: { height?: number; className?: string }) {
  return (
    <svg viewBox={LOGO_VIEWBOX} height={height} width={(height * 1622) / 336} role="img" aria-label="Clutch" className={className}>
      <path fillRule="evenodd" fill="currentColor" d={LOGO_PATH} />
    </svg>
  );
}

export function Wordmark({ href = "/", className = "" }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={`inline-flex items-center text-ink ${className}`} aria-label="Clutch home">
      <Logo height={24} />
    </Link>
  );
}
