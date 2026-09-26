import Link from "next/link";
import { getSession } from "@/lib/session";
import { Wordmark } from "@/components/brand/wordmark";

const NAV = [
  { href: "/mechanics", label: "Find a Mechanic" },
  { href: "/for-mechanics", label: "For Mechanics" },
  { href: "/how-it-works", label: "How It Works" },
];

/** Public marketing header. The customer and mechanic apps have their own shells. */
export async function SiteHeader() {
  const s = await getSession();
  // Dual-role accounts see which app this opens: the one they used last.
  const dual = s.role !== "guest" && s.role !== "admin" && s.roles.includes("customer") && s.roles.includes("mechanic");
  const app =
    s.role === "customer"
      ? { href: "/customer", label: dual ? "My Clutch: customer" : "My Clutch" }
      : s.role === "mechanic"
        ? { href: "/mechanic", label: dual ? "My Clutch: mechanic" : "Mechanic dashboard" }
        : s.role === "admin"
          ? { href: "/admin", label: "Review queue" }
          : null;
  return (
    <header className="sticky top-0 z-30 border-b border-rule bg-paper/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Wordmark />
          <nav aria-label="Main" className="hidden items-center gap-6 md:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-[0.9375rem] text-ink-2 hover:text-ink">
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {app ? (
            <Link href={app.href} className="btn btn-ink min-h-11 px-3 text-sm">
              {app.label}
            </Link>
          ) : (
            <>
              <Link href="/login" className="text-[0.9375rem] font-semibold text-ink hover:underline">
                Log in
              </Link>
              <Link href="/signup" className="btn btn-ink min-h-11 px-3 text-sm">
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
      <nav aria-label="Main mobile" className="flex gap-5 overflow-x-auto border-t border-rule-soft px-4 py-2 md:hidden">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="shrink-0 text-[0.875rem] text-ink-2 hover:text-ink">
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-rule">
      <div className="mx-auto grid max-w-[1200px] gap-6 px-4 py-10 text-[0.875rem] text-ink-2 sm:grid-cols-[1fr_auto] sm:px-6">
        <div className="space-y-2">
          <Wordmark />
          <p className="max-w-[46ch]">One network, two products: find someone you trust to fix your car, or build your independent mechanic business. Launching in Los Angeles.</p>
          <p className="text-ink-3">Demo build: every mechanic, shop, customer and review on this site is fictional.</p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-8 gap-y-2">
          <Link href="/mechanics" className="hover:text-ink">Find a Mechanic</Link>
          <Link href="/for-mechanics" className="hover:text-ink">For Mechanics</Link>
          <Link href="/how-it-works" className="hover:text-ink">How It Works</Link>
          <Link href="/verification" className="hover:text-ink">Verification</Link>
          <Link href="/help" className="hover:text-ink">Help &amp; safety</Link>
          <Link href="/login" className="hover:text-ink">Log in</Link>
          <Link href="/demo" className="hover:text-ink">Demo accounts</Link>
        </nav>
      </div>
    </footer>
  );
}
