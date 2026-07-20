import { NextResponse } from "next/server";

import { parseDigikeyOrderCsv } from "@/lib/domain/digikeyOrderCsv";
import { getLocation, importDigikeyOrder } from "@/lib/repo/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Import a DigiKey order-history/myLists CSV into an existing stock location. */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const locationId = Number(form?.get("locationId"));
  if (!form || !(file instanceof File) || !Number.isInteger(locationId) || locationId <= 0) {
    return NextResponse.json({ error: "file and location are required" }, { status: 400 });
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: "empty file" }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "file too large (>5 MB)" }, { status: 413 });
  }
  if (!(await getLocation(locationId))) {
    return NextResponse.json({ error: "unknown location" }, { status: 400 });
  }

  try {
    const parsed = parseDigikeyOrderCsv(await file.text());
    if (parsed.items.length > 5_000) {
      return NextResponse.json({ error: "too many order lines (>5000)" }, { status: 413 });
    }
    const suppliedRef = String(form.get("ref") ?? "").trim().slice(0, 128);
    const result = await importDigikeyOrder(
      parsed.items,
      locationId,
      suppliedRef || `DigiKey:${file.name}`.slice(0, 128),
    );
    return NextResponse.json(
      {
        ...result,
        sourceRows: parsed.sourceRows,
        skippedRows: parsed.skippedRows,
        parseErrors: parsed.parseErrors,
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not import DigiKey CSV" },
      { status: 400 },
    );
  }
}
