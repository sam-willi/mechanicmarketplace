import Link from "next/link";
import { requestScope } from "@/lib/data";
import { exitDemo } from "@/app/actions/account";

/**
 * Shown on every page while this browser is in the demo marketplace, so fictional
 * data is never mistaken for the real thing. Server-rendered from the same
 * scope decision the data layer uses.
 */
export async function DemoBanner() {
  if ((await requestScope()) !== "demo") return null;
  return (
    <div role="note" aria-label="Demo mode" className="border-b border-dashed border-ink-3 bg-paper text-[0.8125rem] text-ink-2">
      <div className="mx-auto flex max-w-[1200px] items-center gap-x-3 px-4 sm:px-6">
        <span className="shrink-0 border border-ink-3 px-1.5 text-[0.6875rem] font-extrabold tracking-[0.08em] text-ink-3 uppercase">Demo</span>
        <span className="min-w-0 flex-1 truncate">
          <span className="sm:hidden">Fictional data</span>
          <span className="hidden sm:inline">You&apos;re in the demo marketplace. Everyone and everything here is fictional test data.</span>
        </span>
        <Link href="/demo" className="inline-flex min-h-11 shrink-0 items-center font-semibold whitespace-nowrap text-ink underline decoration-rule underline-offset-2">
          <span className="sm:hidden">Accounts</span>
          <span className="hidden sm:inline">Demo accounts</span>
        </Link>
        <form action={exitDemo} className="shrink-0">
          <button className="inline-flex min-h-11 items-center font-semibold whitespace-nowrap text-ink underline decoration-rule underline-offset-2">Exit demo</button>
        </form>
      </div>
    </div>
  );
}
