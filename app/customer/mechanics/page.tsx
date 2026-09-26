import type { Metadata } from "next";
import { ready, repo } from "@/lib/data";
import { getSession } from "@/lib/session";
import { EvidenceProvider } from "@/components/trust/evidence-sheet";
import { MechanicSearch, type SearchParams } from "@/components/find/mechanic-search";

export const metadata: Metadata = { title: "Find Mechanics" };

export default async function CustomerFind({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await ready();
  const s = await getSession();
  if (s.role !== "customer") return null;
  const sp = await searchParams;
  return (
    <EvidenceProvider>
      <MechanicSearch sp={sp} action="/customer/mechanics" vehicles={repo.listVehicles(s.customerId)} savedIds={repo.listSaved(s.customerId)} />
    </EvidenceProvider>
  );
}
