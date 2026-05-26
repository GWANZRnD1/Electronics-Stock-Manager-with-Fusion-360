import { NextResponse } from "next/server";

import { searchCatalog } from "@/lib/repo/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const v = (k: string) => sp.get(k)?.trim() || undefined;
  return NextResponse.json(
    await searchCatalog({
      q: v("q"),
      category: v("category"),
      name: v("name"),
      manufacturer: v("manufacturer"),
      mpn: v("mpn"),
      pkg: v("package"),
      location: v("location"),
    }),
  );
}
