import "server-only";
import { redirect } from "next/navigation";
import { LifecycleError } from "@/lib/domain/transitions";
import { ScopeError } from "@/lib/data/mock/repository";

/** `path?error=message`, keeping any #fragment at the end. */
export function withError(path: string, message: string) {
  const [base, hash] = path.split("#");
  return `${base}${base.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}${hash ? `#${hash}` : ""}`;
}

/**
 * Run a lifecycle write. If the rules refuse it (out of order, stale page, not yours),
 * go back to `path` with the reason shown on the page, instead of an error screen.
 */
export async function orBack<T>(path: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof LifecycleError) redirect(withError(path, e.message));
    if (e instanceof ScopeError) redirect(withError(path, "That record wasn't found."));
    throw e;
  }
}
