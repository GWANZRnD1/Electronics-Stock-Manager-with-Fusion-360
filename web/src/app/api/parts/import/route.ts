import Papa from "papaparse";
import { NextResponse } from "next/server";

import { isUniqueViolation } from "@/lib/http";
import { importInventory } from "@/lib/repo/inventory";
import { normalizeRow, type RawInventoryRow } from "@/lib/domain/inventoryCsv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bulk import the CurrentInventory CSV (posted as raw text). Additive — intended
 * to run against an empty inventory (purge first), so a duplicate MPN is a 409.
 */
export async function POST(request: Request) {
  const csv = (await request.text()).replace(/^﻿/, ""); // strip any UTF-8 BOM
  if (!csv.trim()) {
    return NextResponse.json({ error: "empty file" }, { status: 400 });
  }
  const parsed = Papa.parse<RawInventoryRow>(csv, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const rows = parsed.data.map(normalizeRow).filter((r) => r.mpn || r.description);
  if (rows.length === 0) {
    return NextResponse.json({ error: "no importable rows found" }, { status: 400 });
  }
  if (rows.length > 20_000) {
    return NextResponse.json({ error: "file too large (>20000 rows)" }, { status: 413 });
  }
  try {
    const result = await importInventory(rows);
    return NextResponse.json({ ...result, parseErrors: parsed.errors.length }, { status: 201 });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return NextResponse.json(
        { error: "duplicate MPN — purge the inventory before importing" },
        { status: 409 },
      );
    }
    throw e;
  }
}
