import { redirect } from "next/navigation";
import { getRepo } from "@/lib/data";
import { getSession, needs } from "@/lib/session";
import { identityProviderFor } from "@/lib/verification/identity/config";
import { ProviderUnavailable } from "@/lib/verification/identity/types";
import { CHECK_INFO } from "@/lib/verification/claims";

/**
 * Where the provider sends the mechanic back. Nothing in the URL is trusted: the session is read
 * from the provider server-side (this also recovers a missed or delayed webhook), then the mechanic
 * lands on their Verification Center with the outcome.
 */
export default async function IdentityReturn({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const s = await getSession();
  if (s.role !== "mechanic") redirect("/login?next=/mechanic/verification");
  const repo = await getRepo();
  await (await needs(s)).ownSources();
  const id = (await searchParams).r ?? "";
  const v = repo.getVerification(id);
  if (!v || v.mechanicId !== s.mechanicId || v.category !== "identity" || !v.providerRef || !v.provider) redirect("/mechanic/verification#identity");
  const provider = identityProviderFor(v.provider, repo.scope);
  if (!provider) redirect("/mechanic/verification?identity=unavailable#identity");
  let status: string = v.status;
  try {
    const result = await provider.fetchResult(v.providerRef, s.name);
    if (result.recordId === v.id) {
      const out = await repo.applyProviderResult({
        providerRef: v.providerRef,
        recordId: v.id,
        status: result.status,
        reasonCodes: result.reasonCodes,
        // Keyed by the observed state: returning twice to the same result applies it once.
        eventId: `return:${v.providerRef}:${result.status}:${result.reasonCodes.join("+")}`,
        provider: provider.key,
        nameMatches: result.nameMatches,
        validMonths: CHECK_INFO.identity.validMonths,
      });
      status = out.status;
    }
  } catch (e) {
    if (e instanceof ProviderUnavailable) redirect("/mechanic/verification?identity=outage#identity");
    throw e;
  }
  redirect(`/mechanic/verification?identity=${status}#identity`);
}
