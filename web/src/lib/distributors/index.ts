/** Unified part lookup across distributors, with a short in-memory TTL cache. */
import { digikeySearch } from "./digikey";
import { lcscLookupByCNumber, lcscSearch } from "./lcsc";
import { mouserSearch } from "./mouser";
import type { DistributorId, DistributorOffer, LookupResult } from "./types";

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min — respects distributor rate limits
const cache = new Map<string, { at: number; result: LookupResult }>();

export async function lookupPart(mpn: string): Promise<LookupResult> {
  const key = mpn.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

  // Query distributors in parallel; a failing one (bad key, rate limit) is
  // recorded in `errors` so callers can tell "no match" from "API unavailable".
  // An LCSC C-number additionally enriches from EasyEDA (manufacturer/package).
  const isCNumber = /^c\d+$/i.test(mpn.trim());
  const names: DistributorId[] = ["digikey", "mouser", "lcsc"];
  const settled = await Promise.allSettled([
    digikeySearch(mpn),
    mouserSearch(mpn),
    isCNumber ? lcscLookupByCNumber(mpn) : Promise.resolve(null),
  ]);
  const offers: DistributorOffer[] = [];
  const errors: NonNullable<LookupResult["errors"]> = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") {
      if (s.value) offers.push(s.value);
    } else {
      errors.push({ distributor: names[i], message: s.reason instanceof Error ? s.reason.message : String(s.reason) });
    }
  });
  // Always keep an LCSC entry; fall back to the link-only offer if EasyEDA gave nothing.
  if (!offers.some((o) => o.distributor === "lcsc")) offers.push(lcscSearch(mpn));

  const result: LookupResult = { mpn, offers, errors: errors.length ? errors : undefined };
  // Don't cache failures — so a retry after the rate limit resets isn't blocked.
  if (errors.length === 0) cache.set(key, { at: Date.now(), result });
  return result;
}

export type { DistributorOffer, LookupResult } from "./types";
