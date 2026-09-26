import { NextResponse, type NextRequest } from "next/server";
import { vehicleData } from "@/lib/vehicles/provider";

/**
 * Vehicle options for the cascading selector:
 *   ?step=years | makes&year= | models&year=&make= | configs&year=&make=&model=
 * Option lists are stable, so they're cached by the provider and the browser.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const step = q.get("step");
  const year = Number(q.get("year"));
  const make = q.get("make") ?? "";
  const model = q.get("model") ?? "";
  const headers = { "Cache-Control": "public, max-age=86400" };
  if (step === "years") return NextResponse.json({ years: vehicleData.years() }, { headers });
  if (!year || year < 1980 || year > 2100) return NextResponse.json({ error: "Choose a year" }, { status: 400 });
  if (step === "makes") return NextResponse.json({ makes: await vehicleData.makes(year) }, { headers });
  if (!make) return NextResponse.json({ error: "Choose a make" }, { status: 400 });
  if (step === "models") return NextResponse.json(await vehicleData.models(year, make), { headers });
  if (step === "configs") {
    if (!model) return NextResponse.json({ error: "Choose a model" }, { status: 400 });
    return NextResponse.json({ configs: await vehicleData.configurations(year, make, model) }, { headers });
  }
  return NextResponse.json({ error: "Unknown step" }, { status: 400 });
}
