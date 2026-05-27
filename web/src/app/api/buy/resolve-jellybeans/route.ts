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

type Outcome =
  | { mpn: string; manufacturer: string; unitPrice: number }
  | { mpn: null; reason: "no_match" | "rate_limited" | "error" };

// Per-instance cache keyed by the normalized keyword query. Only successes and
// confirmed misses are cached; transient failures (429/errors) are not, so a
// retry after the rate limit clears can still succeed.
const cache = new Map<string, Outcome>();

async function resolve(descriptor: string): Promise<Outcome> {
  const query = descriptorToQuery(descriptor);
  const key = query.keywords.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  let outcome: Outcome;
  try {
    const best = pickCheapestInStock(await digikeySearchCandidates(query.keywords), query);
    outcome = best
      ? { mpn: best.mpn, manufacturer: best.manufacturer, unitPrice: best.unitPrice }
      : { mpn: null, reason: "no_match" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return { mpn: null, reason: msg.includes("429") ? "rate_limited" : "error" };
  }
  cache.set(key, outcome);
  return outcome;
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
    reason?: string;
  }[] = [];
  for (const { descriptor, quantity } of parsed.data.items) {
    const r = await resolve(descriptor);
    resolved.push(
      r.mpn !== null
        ? { descriptor, quantity, mpn: r.mpn, manufacturer: r.manufacturer, unitPrice: r.unitPrice }
        : { descriptor, quantity, mpn: null, reason: r.reason },
    );
  }

  return NextResponse.json({ resolved });
}
