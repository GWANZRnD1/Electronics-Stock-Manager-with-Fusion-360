import { NextResponse } from "next/server";

import { listCatalog } from "@/lib/repo/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listCatalog());
}
