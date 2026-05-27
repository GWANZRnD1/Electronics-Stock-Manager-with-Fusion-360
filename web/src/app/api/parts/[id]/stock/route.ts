import { NextResponse } from "next/server";

import { getPartStock, setStockQuantity } from "@/lib/repo/inventory";
import { adjustStockSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid part id" }, { status: 400 });
  }
  return NextResponse.json(await getPartStock(id));
}

// Set an existing part+location count to an absolute quantity (inline stock edit).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid part id" }, { status: 400 });
  }
  const parsed = adjustStockSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const result = await setStockQuantity(id, parsed.data.locationId, parsed.data.quantity);
  if (!result) {
    return NextResponse.json({ error: "stock not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}
