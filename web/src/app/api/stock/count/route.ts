import { NextResponse } from "next/server";

import { applyStocktakeCounts } from "@/lib/repo/inventory";
import { stocktakeCountsSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = stocktakeCountsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid stocktake" }, { status: 400 });
  }
  const result = await applyStocktakeCounts(parsed.data);
  if (result.missing.length > 0) {
    return NextResponse.json(
      { error: "some stock entries no longer exist", missing: result.missing },
      { status: 409 },
    );
  }
  return NextResponse.json(result);
}
