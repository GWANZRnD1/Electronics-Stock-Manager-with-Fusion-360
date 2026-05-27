import { NextResponse } from "next/server";

import { getPartStock } from "@/lib/repo/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid part id" }, { status: 400 });
  }
  return NextResponse.json(await getPartStock(id));
}
