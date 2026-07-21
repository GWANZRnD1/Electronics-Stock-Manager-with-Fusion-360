import { NextResponse } from "next/server";

import { isForeignKeyViolation } from "@/lib/http";
import { moveStockLocation } from "@/lib/repo/inventory";
import { moveStockLocationSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Move all stock for one part from one location to another, merging if needed. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid part id" }, { status: 400 });
  }
  const parsed = moveStockLocationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  try {
    const result = await moveStockLocation(
      id,
      parsed.data.fromLocationId,
      parsed.data.toLocationId,
    );
    if (!result) {
      return NextResponse.json({ error: "source stock entry not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (e) {
    if (isForeignKeyViolation(e)) {
      return NextResponse.json({ error: "destination location not found" }, { status: 404 });
    }
    throw e;
  }
}
