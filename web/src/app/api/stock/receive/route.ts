import { NextResponse } from "next/server";

import { isForeignKeyViolation } from "@/lib/http";
import { receiveStock } from "@/lib/repo/inventory";
import { receiveStockSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = receiveStockSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  try {
    const result = await receiveStock(parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    if (isForeignKeyViolation(e)) {
      return NextResponse.json({ error: "unknown location" }, { status: 400 });
    }
    throw e;
  }
}
