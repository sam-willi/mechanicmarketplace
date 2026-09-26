import { ready } from "@/lib/data";
import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site/site-header";
import { EvidenceProvider } from "@/components/trust/evidence-sheet";
import { MechanicSearch, type SearchParams } from "@/components/find/mechanic-search";

export const metadata: Metadata = { title: "Find a mechanic" };

/** Public search. Requesting a quote asks guests to sign up first. */
export default async function FindPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await ready();
  const sp = await searchParams;
  return (
    <EvidenceProvider>
      <SiteHeader />
      <main className="mx-auto max-w-[1040px] px-4 pt-8 sm:px-6 sm:pt-12">
        <MechanicSearch sp={sp} action="/mechanics" />
      </main>
      <SiteFooter />
    </EvidenceProvider>
  );
}
