/** Unified part lookup across distributors, with a short in-memory TTL cache. */
import { digikeySearch } from "./digikey";
import { lcscSearch } from "./lcsc";
import { mouserSearch } from "./mouser";
import type { DistributorOffer, LookupResult } from "./types";

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min — respects distributor rate limits
const cache = new Map<string, { at: number; result: LookupResult }>();

export async function lookupPart(mpn: string): Promise<LookupResult> {
  const key = mpn.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

  // Query distributors in parallel; a failing one (bad key, rate limit) is skipped.
  const settled = await Promise.allSettled([digikeySearch(mpn), mouserSearch(mpn)]);
  const offers: DistributorOffer[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled" && s.value) offers.push(s.value);
  }
  offers.push(lcscSearch(mpn)); // link-only LCSC offer (no public API), never fails

  const result: LookupResult = { mpn, offers };
  cache.set(key, { at: Date.now(), result });
  return result;
}

export type { DistributorOffer, LookupResult } from "./types";
