import { NextResponse } from "next/server";

import { DIGIKEY_MYLISTS_ENDPOINT, digikeyMylistsPayload } from "@/lib/domain/buyLinks";
import { digikeyBatchSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Build a one-click DigiKey "MyLists" link preloaded with the shortage BOM.
 * Uses DigiKey's keyless third-party MyLists API (no OAuth needed); returns a
 * single-use URL. If it fails, the client falls back to per-part links.
 */
export async function POST(request: Request) {
  const parsed = digikeyBatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const payload = digikeyMylistsPayload(
    parsed.data.items.map((i) => [i.partNumber, i.quantity] as [string, number]),
  );
  if (payload.length === 0) {
    return NextResponse.json({ error: "no purchasable items" }, { status: 400 });
  }

  const listName = parsed.data.listName ?? `stocktaker-${Date.now()}`;
  try {
    const res = await fetch(`${DIGIKEY_MYLISTS_ENDPOINT}?listName=${encodeURIComponent(listName)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `DigiKey responded ${res.status}` }, { status: 502 });
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const url = (data.singleUseUrl ?? data.SingleUseUrl) as string | undefined;
    if (!url) {
      return NextResponse.json({ error: "DigiKey returned no URL" }, { status: 502 });
    }
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ error: "could not reach DigiKey" }, { status: 502 });
  }
}
