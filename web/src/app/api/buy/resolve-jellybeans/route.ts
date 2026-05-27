import { NextResponse } from "next/server";
import { z } from "zod";

import { digikeySearchCandidates } from "@/lib/distributors/digikey";
import { descriptorToQuery, pickCheapestInStock } from "@/lib/domain/jellybeanQuery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Inline schema (kept local to avoid touching the shared validation module).
const schema = z.object({
  items: z
    .array(
      z.object({
        descriptor: z.string().trim().min(1).max(256),
        quantity: z.number().int().positive().max(1_000_000),
      }),
    )
    .min(1)
    .max(200),
});

interface Resolved {
  mpn: string;
  manufacturer: string;
  unitPrice: number;
  stock: number;
}

// Per-instance cache keyed by the normalized keyword query. `null` = looked up,
// nothing usable found (so we don't re-hit DigiKey for the same miss).
const cache = new Map<string, Resolved | null>();

async function resolve(descriptor: string): Promise<Resolved | null> {
  const query = descriptorToQuery(descriptor);
  const key = query.keywords.toLowerCase();
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  let result: Resolved | null = null;
  try {
    const best = pickCheapestInStock(await digikeySearchCandidates(query.keywords), query);
    if (best) {
      result = {
        mpn: best.mpn,
        manufacturer: best.manufacturer,
        unitPrice: best.unitPrice,
        stock: best.stock,
      };
    }
  } catch {
    result = null; // transient/search error — treat as unresolved, don't cache a hard miss forever
    return result;
  }
  cache.set(key, result);
  return result;
}

/**
 * Resolve generic jellybean descriptors (e.g. "0.1 μF 25V X5R 0402") to real,
 * in-stock DigiKey parts so they can populate the batch list. Cheapest in-stock
 * match per descriptor; unresolved entries come back with mpn: null.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  // Sequentially (not Promise.all) so we don't trip DigiKey's burst rate limit;
  // cache hits make repeats instant.
  const resolved: {
    descriptor: string;
    quantity: number;
    mpn: string | null;
    manufacturer?: string;
    unitPrice?: number;
  }[] = [];
  for (const { descriptor, quantity } of parsed.data.items) {
    const hit = await resolve(descriptor);
    resolved.push(
      hit
        ? { descriptor, quantity, mpn: hit.mpn, manufacturer: hit.manufacturer, unitPrice: hit.unitPrice }
        : { descriptor, quantity, mpn: null },
    );
  }

  return NextResponse.json({ resolved });
}
