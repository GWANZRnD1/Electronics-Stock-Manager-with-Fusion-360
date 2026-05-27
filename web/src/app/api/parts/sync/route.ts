import { NextResponse } from "next/server";

import { digikeyConfigured } from "@/lib/distributors/digikey";
import { mouserConfigured } from "@/lib/distributors/mouser";
import { syncCounts, syncFromDistributors } from "@/lib/repo/inventory";
import { syncSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function configured(): boolean {
  return digikeyConfigured() || mouserConfigured();
}

/** Status for the sync panel: whether a distributor API is set, and per-operation counts. */
export async function GET() {
  return NextResponse.json({ configured: configured(), ...(await syncCounts()) });
}

/** Run one resumable sync batch. Refuses to run without a distributor API key. */
export async function POST(request: Request) {
  if (!configured()) {
    return NextResponse.json(
      { error: "no distributor API configured (set DIGIKEY_CLIENT_ID/SECRET or MOUSER_API_KEY)" },
      { status: 400 },
    );
  }
  const parsed = syncSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "select at least one operation" }, { status: 400 });
  }
  return NextResponse.json(await syncFromDistributors(parsed.data));
}
