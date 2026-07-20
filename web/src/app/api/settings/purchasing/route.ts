import { NextResponse } from "next/server";
import { z } from "zod";

import { digikeyConfigured } from "@/lib/distributors/digikey";
import {
  getPurchaseConfig,
  setPurchaseConfig,
} from "@/lib/repo/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  preferredSupplier: z.enum(["digikey", "lcsc"]),
  priceDifferenceThresholdPercent: z.number().min(0).max(100),
  normallyStockingOnly: z.boolean(),
  excludeMarketplace: z.boolean(),
  inStockOnly: z.boolean(),
});

function apiStatus() {
  return {
    digikey: digikeyConfigured(),
    lcsc: Boolean(process.env.LCSC_API_KEY && process.env.LCSC_API_SECRET),
  };
}

export async function GET() {
  return NextResponse.json({ config: await getPurchaseConfig(), apis: apiStatus() });
}

export async function PUT(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid purchasing settings" }, { status: 400 });
  }
  await setPurchaseConfig(parsed.data);
  return NextResponse.json({ config: parsed.data, apis: apiStatus() });
}
