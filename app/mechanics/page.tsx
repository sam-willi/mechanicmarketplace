import { redirect } from "next/navigation";
import type { SearchParams } from "@/components/find/mechanic-search";

/**
 * Searching needs an account: the customer app asks guests to log in or sign
 * up, then returns them to these same results. Profiles (/mechanics/[slug])
 * stay public so mechanics can share them.
 */
export default async function FindPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "")).toString();
  redirect(`/customer/mechanics${qs ? `?${qs}` : ""}`);
}
