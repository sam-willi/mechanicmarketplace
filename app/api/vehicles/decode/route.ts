import { NextResponse, type NextRequest } from "next/server";
import { vehicleData } from "@/lib/vehicles/provider";
import { getAccount } from "@/lib/session";

/** Decode a VIN. Signed-in users only (it's used while describing their own car); nothing is stored here. */
export async function POST(req: NextRequest) {
  if (!(await getAccount())) return NextResponse.json({ error: "Sign in to decode a VIN." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { vin?: string };
  const decoded = await vehicleData.decodeVin(String(body.vin ?? ""));
  return NextResponse.json(decoded, { headers: { "Cache-Control": "no-store" } });
}
