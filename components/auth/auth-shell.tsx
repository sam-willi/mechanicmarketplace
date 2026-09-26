import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";

/** The plain frame around sign-in pages. */
export function AuthShell({ children, aside }: { children: React.ReactNode; aside?: { href: string; label: string } }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule">
        <div className="mx-auto flex h-14 max-w-[560px] items-center justify-between px-4">
          <Wordmark />
          {aside ? (
            <Link href={aside.href} className="text-[0.9375rem] font-semibold hover:underline">
              {aside.label}
            </Link>
          ) : null}
        </div>
      </header>
      <main className="mx-auto max-w-[560px] px-4 pt-10 pb-20">{children}</main>
    </div>
  );
}

export function Notice({ tone = "ink", children }: { tone?: "ink" | "alert"; children: React.ReactNode }) {
  return (
    <p className={`mt-4 border px-3 py-2 text-[0.9375rem] ${tone === "alert" ? "border-alert bg-alert-wash" : "border-ink bg-sheet"}`} role={tone === "alert" ? "alert" : "status"}>
      {children}
    </p>
  );
}
