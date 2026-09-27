"use client";

import Link from "next/link";
import { useEffect } from "react";

/** What any page shows when loading its data fails: say so, offer a retry and a way out. Nothing is lost by retrying. */
export function ErrorState({ error, retry, home }: { error: Error & { digest?: string }; retry: () => void; home: string }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="mx-auto max-w-[560px] px-4 py-16">
      <h1 className="display text-[2rem]">This page didn&apos;t load</h1>
      <p className="mt-3 text-ink-2">Something went wrong on our side. Your saved requests and account are unaffected. Try again, or go back and continue from there.</p>
      {error.digest ? <p className="mt-2 text-[0.8125rem] text-ink-3">Reference {error.digest}</p> : null}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => retry()} className="btn btn-ink min-h-11">
          Try again
        </button>
        <Link href={home} className="btn btn-line min-h-11">
          Go to home
        </Link>
      </div>
    </div>
  );
}
