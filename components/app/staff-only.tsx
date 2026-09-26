import Link from "next/link";
import { signOut } from "@/app/actions/account";
import { Wordmark } from "@/components/brand/wordmark";

/**
 * A reviewer-only account (e.g. the demo reviewer) opened a customer or
 * mechanic page. Say who's signed in instead of silently redirecting.
 */
export function StaffOnlyNotice({ name, area }: { name: string; area: "customer" | "mechanic" }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule">
        <div className="mx-auto flex h-14 max-w-[1100px] items-center px-4 sm:px-6">
          <Wordmark />
        </div>
      </header>
      <main className="mx-auto max-w-[560px] px-4 py-20">
        <h1 className="display text-[2rem]">You&apos;re signed in as {name}</h1>
        <p className="mt-3 text-ink-2">
          This is a reviewer-only account, so it can&apos;t use the {area} app. Log out to continue with your own account.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <form action={signOut}>
            <button className="btn btn-ink min-h-11">Log out</button>
          </form>
          <Link href="/admin" className="btn btn-quiet min-h-11">
            Go to review queue
          </Link>
        </div>
      </main>
    </div>
  );
}
