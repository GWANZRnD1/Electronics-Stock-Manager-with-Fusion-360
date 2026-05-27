import { NextResponse } from "next/server";

import { digikeyConfigured } from "@/lib/distributors/digikey";
import { mouserConfigured } from "@/lib/distributors/mouser";
import { enrichableCount, enrichValues } from "@/lib/repo/inventory";
import { enrichSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function configured(): boolean {
  return digikeyConfigured() || mouserConfigured();
}

/** Status for the enrich UI: whether a distributor API is set, and how many parts lack a value. */
export async function GET() {
  return NextResponse.json({ configured: configured(), enrichable: await enrichableCount() });
}

/** Run one resumable enrichment batch. Refuses to run without a distributor API key. */
export async function POST(request: Request) {
  if (!configured()) {
    return NextResponse.json(
      { error: "no distributor API configured (set DIGIKEY_CLIENT_ID/SECRET or MOUSER_API_KEY)" },
      { status: 400 },
    );
  }
  const parsed = enrichSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const result = await enrichValues(parsed.data);
  return NextResponse.json(result);
}
