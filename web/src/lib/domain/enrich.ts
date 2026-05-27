/**
 * Decide a component's value/category/package from distributor lookup results,
 * used by the Stage-2 enrichment pass. Priority for value: a distributor's
 * parametric field (e.g. DigiKey "Resistance") → extracted from a live
 * distributor description → extracted from the part's own description. Mock
 * offers (no API key) are ignored so enrichment never invents data.
 */
import type { DistributorOffer } from "../distributors/types";

import { extractValue } from "./inventoryCsv";

export function deriveValue(offers: DistributorOffer[], fallbackDescription: string): string {
  const live = offers.filter((o) => !o.mock);
  for (const o of live) {
    if (o.value && o.value.trim()) {
      return extractValue(o.value) || o.value.trim();
    }
  }
  for (const o of live) {
    const v = extractValue(o.description);
    if (v) return v;
  }
  return extractValue(fallbackDescription);
}

/** First non-empty field across live offers — used to backfill blank category/package. */
export function deriveField(offers: DistributorOffer[], field: "category" | "package"): string {
  for (const o of offers) {
    if (!o.mock && o[field]?.trim()) return o[field].trim();
  }
  return "";
}
