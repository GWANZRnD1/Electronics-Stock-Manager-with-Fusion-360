import { NextResponse } from "next/server";
import { z } from "zod";

import { lookupPart } from "@/lib/distributors";
import type { DistributorOffer } from "@/lib/distributors/types";
import { deriveField, deriveValue } from "@/lib/domain/enrich";
import { applyResolved, identifierOf, type ResolvedFields } from "@/lib/domain/libraryEnrich";
import { buildApplyScr, type LibraryRow } from "@/lib/domain/libraryScr";
import { partsByKeys } from "@/lib/repo/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rowSchema = z.object({
  deviceset: z.string().max(256),
  variant: z.string().max(256).default(""),
  package: z.string().max(256).default(""),
  technology: z.string().max(256).default(""),
  attributes: z.record(z.string(), z.string()).default({}),
});

const bodySchema = z.object({
  rows: z.array(rowSchema).max(20_000),
  overwrite: z.boolean().default(false),
  purge: z.array(z.string().max(64)).max(64).default([]),
  maxApiLookups: z.number().int().min(0).max(1_000).default(200),
});

interface NewPart {
  mpn: string;
  manufacturer: string;
  description: string;
  category: string;
  value: string;
  package: string;
  supplier: string;
  spn: string;
}

/** Turn live distributor offers into the fields we fill + a candidate catalog part. */
function fromOffers(offers: DistributorOffer[]): { fields: ResolvedFields; newPart: NewPart } | null {
  const live = offers.filter((o) => !o.mock);
  if (live.length === 0) return null;
  const manufacturer = deriveField(offers, "manufacturer");
  const description = deriveField(offers, "description");
  const category = deriveField(offers, "category");
  const pkg = deriveField(offers, "package");
  const value = deriveValue(offers, description);
  const mpn = (live.find((o) => o.mpn)?.mpn ?? "").trim();
  const spn = (live.find((o) => o.distributorPartNumber)?.distributorPartNumber ?? "").trim();
  const datasheet = live.find((o) => o.datasheetUrl)?.datasheetUrl ?? "";
  return {
    fields: { manufacturer, mpn, spn, description, value, category, datasheet },
    newPart: { mpn, manufacturer, description, category, value, package: pkg, supplier: live[0].distributor, spn },
  };
}

/**
 * Enrich a library export: fill each row's existing attribute columns from the
 * DB catalog first, then distributor APIs for the rest. Returns the apply.scr
 * (diff vs the upload), a per-row change list, and parts not yet in the catalog.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  const { rows, overwrite, purge, maxApiLookups } = parsed.data;

  // 1. Unique lookup keys (a real MPN, else the supplier part number).
  const keyKind = new Map<string, "mpn" | "spn">();
  for (const row of rows) {
    const id = identifierOf(row);
    if (id && !keyKind.has(id.key)) keyKind.set(id.key, id.kind);
  }

  // 2. DB-first: resolve from the catalog, keyed by both MPN and SPN.
  const mpnKeys = [...keyKind].filter(([, k]) => k === "mpn").map(([key]) => key);
  const spnKeys = [...keyKind].filter(([, k]) => k === "spn").map(([key]) => key);
  const dbParts = await partsByKeys(mpnKeys, spnKeys);
  const resolved = new Map<string, ResolvedFields>();
  const inDbMpns = new Set<string>();
  for (const p of dbParts) {
    if (p.mpn) inDbMpns.add(p.mpn);
    const fields: ResolvedFields = {
      manufacturer: p.manufacturer,
      mpn: p.mpn,
      spn: p.spn,
      description: p.description,
      value: p.value,
      category: p.category,
    };
    if (p.mpn) resolved.set(p.mpn, fields);
    if (p.spn) resolved.set(p.spn, fields);
  }

  // 3. Distributor API for keys the DB didn't cover (throttled by maxApiLookups).
  const newParts = new Map<string, NewPart>();
  let apiCalls = 0;
  for (const key of [...keyKind.keys()].filter((k) => !resolved.has(k))) {
    if (apiCalls >= maxApiLookups) break;
    apiCalls++;
    try {
      const { offers } = await lookupPart(key);
      const result = fromOffers(offers);
      if (!result) continue;
      resolved.set(key, result.fields);
      if (result.newPart.mpn && !inDbMpns.has(result.newPart.mpn)) {
        newParts.set(result.newPart.mpn, result.newPart);
      }
    } catch {
      // transient lookup failure — leave the row unenriched
    }
  }

  // 4. Apply to rows; collect a change list and the enriched rows for the diff.
  const enriched: LibraryRow[] = [];
  const changes: {
    deviceset: string;
    variant: string;
    technology: string;
    filled: { column: string; from: string; to: string }[];
  }[] = [];
  let filledCells = 0;
  for (const row of rows) {
    const id = identifierOf(row);
    const fields = id ? resolved.get(id.key) : undefined;
    if (!fields) {
      enriched.push(row);
      continue;
    }
    const { row: nextRow, filled } = applyResolved(row, fields, { overwrite });
    enriched.push(nextRow);
    if (filled.length > 0) {
      filledCells += filled.length;
      changes.push({
        deviceset: row.deviceset,
        variant: row.variant,
        technology: row.technology,
        filled: filled.map((column) => ({
          column,
          from: row.attributes[column] ?? "",
          to: nextRow.attributes[column],
        })),
      });
    }
  }

  const { scr, setCount, deleteCount, blocks } = buildApplyScr(rows, enriched, new Set(purge));

  return NextResponse.json({
    scr,
    summary: {
      rows: rows.length,
      enrichedRows: changes.length,
      filledCells,
      blocks,
      setCount,
      deleteCount,
      apiCalls,
      dbParts: dbParts.length,
    },
    changes,
    newParts: [...newParts.values()],
  });
}
