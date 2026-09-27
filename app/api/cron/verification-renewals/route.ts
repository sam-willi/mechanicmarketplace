import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { persistent } from "@/lib/data/store";
import { readyRepo } from "@/lib/data";

/**
 * Daily, from a host's scheduler: renewal reminders (30 and 7 days before expiry) and expiry
 * events for the real marketplace. Idempotent (each reminder is keyed by record and expiry date),
 * so extra runs change nothing. Expiry itself is also applied at every read, so a late run never
 * lets a lapsed check count. Off unless CLUTCH_CRON_SECRET is set; requires `Authorization: Bearer <secret>`.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CLUTCH_CRON_SECRET;
  if (!secret || !persistent()) return new NextResponse("Not found", { status: 404 });
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return new NextResponse("Unauthorized", { status: 401 });
  const repo = await readyRepo("live");
  const changed = await repo.remindRenewals(new Date().toISOString());
  return NextResponse.json({ changed });
}

export const GET = POST;
