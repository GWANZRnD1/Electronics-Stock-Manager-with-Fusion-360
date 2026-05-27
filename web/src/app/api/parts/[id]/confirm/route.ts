import { NextResponse } from "next/server";

import { confirmStock } from "@/lib/repo/inventory";
import { confirmStockSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid part id" }, { status: 400 });
  }
  const parsed = confirmStockSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const ok = await confirmStock(id, parsed.data.locationId);
  if (!ok) {
    return NextResponse.json({ error: "stock entry not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
