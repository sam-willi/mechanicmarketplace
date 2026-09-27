import { NextResponse, type NextRequest } from "next/server";
import { accountName, readyRepo } from "@/lib/data";
import { identityProviderFor, testIdentityProvider, testProvidersAllowed } from "@/lib/verification/identity/config";
import { ProviderUnavailable, WebhookRejected } from "@/lib/verification/identity/types";
import { LifecycleError } from "@/lib/domain/transitions";
import { CHECK_INFO } from "@/lib/verification/claims";

/**
 * Identity provider webhooks. The body is only a notification: after checking the signature and
 * its freshness, the session is fetched from the provider, server to server, and that result is
 * applied. Idempotent on the provider event id (a duplicate delivery changes nothing); a session
 * that isn't bound to the record and account it names is refused. Responds 2xx only once the
 * result is recorded, so the provider retries after an outage.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: key } = await params;
  const raw = await request.text();
  // The test provider may serve the fictional demo in any deployment; real sessions are "live".
  const provider = key === "test" ? testIdentityProvider : identityProviderFor(key, "live");
  if (!provider) return new NextResponse("Not found", { status: 404 });
  let event;
  try {
    event = provider.verifyWebhook(raw, request.headers);
  } catch (e) {
    if (e instanceof WebhookRejected) return new NextResponse("Invalid signature", { status: 400 });
    return new NextResponse("Bad request", { status: 400 });
  }
  try {
    const peek = await provider.fetchResult(event.providerRef, "");
    const scope = peek.scope ?? "live";
    if (key === "test" && scope === "live" && !testProvidersAllowed()) return new NextResponse("Not found", { status: 404 });
    if (!peek.recordId || !peek.accountId) return new NextResponse("Unbound session", { status: 400 });
    const name = (await accountName(scope, peek.accountId)) ?? "";
    const result = await provider.fetchResult(event.providerRef, name);
    const repo = await readyRepo(scope);
    const out = await repo.applyProviderResult({
      providerRef: result.providerRef,
      recordId: result.recordId,
      status: result.status,
      reasonCodes: result.reasonCodes,
      eventId: `${key}:${event.id}`,
      provider: provider.key,
      nameMatches: result.nameMatches,
      validMonths: CHECK_INFO.identity.validMonths,
    });
    return NextResponse.json({ received: true, applied: out.applied });
  } catch (e) {
    if (e instanceof ProviderUnavailable) return new NextResponse("Provider unavailable", { status: 503 });
    if (e instanceof WebhookRejected) return new NextResponse("Rejected", { status: 400 });
    if (e instanceof LifecycleError) return NextResponse.json({ received: true, applied: false, reason: e.code });
    throw e;
  }
}
