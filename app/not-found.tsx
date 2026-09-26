import Link from "next/link";
import { SiteHeader } from "@/components/site/site-header";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[560px] px-4 py-24">
        <h1 className="display text-[2.5rem]">No record found.</h1>
        <p className="mt-3 text-ink-2">That link doesn&apos;t match a profile or page on Clutch. It may have been mistyped or removed.</p>
        <Link href="/mechanics" className="btn btn-ink mt-6">
          Find a mechanic
        </Link>
      </main>
    </>
  );
}
