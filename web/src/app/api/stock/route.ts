import { NextResponse } from "next/server";

import { listStock } from "@/lib/repo/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("locationId");
  const locationId = raw ? Number(raw) : undefined;
  if (raw && (!Number.isInteger(locationId) || locationId! <= 0)) {
    return NextResponse.json({ error: "invalid location id" }, { status: 400 });
  }
  return NextResponse.json(await listStock(5_000, locationId));
}
