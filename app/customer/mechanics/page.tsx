import type { Metadata } from "next";
import { getRepo } from "@/lib/data";
import { getSession, needs } from "@/lib/session";
import { EvidenceProvider } from "@/components/trust/evidence-sheet";
import { MechanicSearch, type SearchParams } from "@/components/find/mechanic-search";

export const metadata: Metadata = { title: "Find Mechanics" };

export default async function CustomerFind({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const repo = await getRepo();
  const s = await getSession();
  if (s.role !== "customer") return null;
  const sp = await searchParams;
  const n = await needs(s);
  await Promise.all([n.customerVehicleList(), n.customerSavedIds()]);
  return (
    <EvidenceProvider>
      <MechanicSearch sp={sp} action="/customer/mechanics" vehicles={repo.listVehicles(s.customerId)} savedIds={repo.listSaved(s.customerId)} />
    </EvidenceProvider>
  );
}
