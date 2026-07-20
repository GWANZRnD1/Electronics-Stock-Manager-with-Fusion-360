/**
 * Turn a free-text jellybean descriptor (e.g. "0.1 μF 25V X5R 0402 (1005 Metric)")
 * into a DigiKey keyword query, and pick the best real part from the candidates
 * DigiKey returns. Pure — the live search lives in the distributor adapter.
 *
 * No part numbers are hardcoded: this only normalizes the *known attributes*
 * (value / size / specs / type) into a query and ranks the live results. The only
 * fixed lists are standard SMD size codes and the "(NNNN Metric)" noise pattern.
 */

export interface JellybeanQuery {
  keywords: string; // for DigiKey KeywordSearch
  packageCode: string; // imperial SMD size token (e.g. "0402"), "" if none found
}

const METRIC_PAREN = /\s*\(\s*\d+\s*metric\s*\)\s*/gi;
const IMPERIAL_SIZE = /\b(0201|0402|0603|0805|1206|1210|1806|1808|1812|2010|2512)\b/;

export function descriptorToQuery(descriptor: string): JellybeanQuery {
  const keywords = descriptor
    .replace(/[µμ]/g, "u") // normalize either micro sign to "u" (uF)
    .replace(METRIC_PAREN, " ") // drop "(1005 Metric)" noise
    .replace(/\s+/g, " ")
    .trim();
  return { keywords, packageCode: descriptor.match(IMPERIAL_SIZE)?.[1] ?? "" };
}

export interface PartCandidate {
  partNumber?: string;
  mpn: string;
  manufacturer: string;
  packageText: string; // DigiKey's "Package / Case" parameter value
  description?: string;
  category?: string;
  value?: string;
  stock: number;
  unitPrice: number; // unit price at the requested quantity; 0 if unknown
  priceBreaks?: { quantity: number; unitPrice: number }[];
  normallyStocking?: boolean;
  marketplace?: boolean;
  productUrl?: string;
}

export function unitPriceAtQuantity(
  breaks: Array<{ quantity: number; unitPrice: number }> | undefined,
  quantity: number,
): number {
  const eligible = (breaks ?? [])
    .filter((price) => price.quantity <= quantity && price.unitPrice > 0)
    .sort((a, b) => b.quantity - a.quantity);
  return eligible[0]?.unitPrice ?? 0;
}

/**
 * Cheapest in-stock candidate whose package matches the query's size (falling
 * back to any in-stock part when none expose a matching package). Returns null
 * when nothing is in stock.
 */
export function pickCheapestInStock(
  candidates: PartCandidate[],
  query: JellybeanQuery,
  quantity = 1,
): PartCandidate | null {
  const inStock = candidates
    .filter((c) => c.stock >= quantity)
    .map((candidate) => ({
      ...candidate,
      unitPrice:
        unitPriceAtQuantity(candidate.priceBreaks, quantity) || candidate.unitPrice,
    }));
  if (inStock.length === 0) return null;

  const pkg = query.packageCode.toLowerCase();
  const matched = pkg ? inStock.filter((c) => c.packageText.toLowerCase().includes(pkg)) : inStock;
  // A known footprint is a physical constraint. Do not silently pick a
  // different size just because it is cheaper.
  if (pkg && matched.length === 0) return null;
  const pool = matched.length > 0 ? matched : inStock;

  const priced = pool
    .filter((c) => c.unitPrice > 0)
    .sort((a, b) => a.unitPrice - b.unitPrice || b.stock - a.stock);
  return priced[0] ?? pool[0];
}
