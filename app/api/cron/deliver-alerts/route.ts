import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { persistent } from "@/lib/data/store";
import { deliverBatch } from "@/lib/notify/run";

/**
 * For a host's scheduler (e.g. a cron that calls this every minute). Off unless
 * CLUTCH_CRON_SECRET is set; requires `Authorization: Bearer <secret>`. Runs one leased batch;
 * safe to call concurrently. Returns counts only.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CLUTCH_CRON_SECRET;
  if (!secret || !persistent()) return new NextResponse("Not found", { status: 404 });
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return new NextResponse("Unauthorized", { status: 401 });
  return NextResponse.json(await deliverBatch());
}

export const GET = POST;
