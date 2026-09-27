import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";

/**
 * "Older" / "Back to newest" for a list read a page at a time. The cursor is a position in
 * the list, so a row added or removed meanwhile never breaks paging.
 */
export function Pager({ href, param = "before", next, paged, olderLabel = "Older", newestLabel = "Back to newest" }: { href: string; param?: string; next?: string; paged: boolean; olderLabel?: string; newestLabel?: string }) {
  if (!next && !paged) return null;
  const join = href.includes("?") ? "&" : "?";
  return (
    <nav aria-label="Pages" className="mt-4 flex flex-wrap items-center justify-between gap-3">
      {paged ? (
        <Link href={href} className="btn btn-quiet min-h-11">
          <ArrowLeft size={15} aria-hidden /> {newestLabel}
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={`${href}${join}${param}=${encodeURIComponent(next)}`} className="btn btn-line min-h-11">
          {olderLabel} <ArrowRight size={15} aria-hidden />
        </Link>
      ) : null}
    </nav>
  );
}
