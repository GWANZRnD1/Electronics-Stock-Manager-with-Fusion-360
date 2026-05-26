import { NextResponse } from "next/server";

import { lookupPart } from "@/lib/distributors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const mpn = new URL(request.url).searchParams.get("mpn")?.trim();
  if (!mpn) {
    return NextResponse.json({ error: "mpn query parameter is required" }, { status: 400 });
  }
  return NextResponse.json(await lookupPart(mpn));
}
