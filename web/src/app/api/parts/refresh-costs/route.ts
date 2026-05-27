import { NextResponse } from "next/server";

import { digikeyConfigured } from "@/lib/distributors/digikey";
import { mouserConfigured } from "@/lib/distributors/mouser";
import { refreshableCostCount, refreshCosts } from "@/lib/repo/inventory";
import { enrichSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function configured(): boolean {
  return digikeyConfigured() || mouserConfigured();
}

/** Status: whether a distributor API is set, and how many DigiKey/Mouser parts can be refreshed. */
export async function GET() {
  return NextResponse.json({ configured: configured(), pending: await refreshableCostCount() });
}

/** Refresh one resumable batch of DigiKey/Mouser unit costs. Refuses to run without a key. */
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
  return NextResponse.json(await refreshCosts(parsed.data));
}
