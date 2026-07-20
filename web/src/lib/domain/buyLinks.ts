/** Build distributor product/search URLs and batch-purchase payloads. Pure, no I/O. */

// DigiKey New Zealand storefront. The MyLists short URLs are region-specific, so
// the batch endpoint must be the .co.nz one too (a .com short code 404s on .co.nz).
export const DIGIKEY_BASE = "https://www.digikey.co.nz";
export const MOUSER_BASE = "https://www.mouser.com";
export const LCSC_BASE = "https://www.lcsc.com";

// Keyless batch endpoint: POST returns a single-use URL preloaded with the BOM.
export const DIGIKEY_MYLISTS_ENDPOINT = "https://www.digikey.co.nz/mylists/api/thirdparty";

/**
 * Where a part is bought, derived from its catalog `supplier`. Jellybeans (and
 * plain "digikey") go to DigiKey; unknown/empty/other suppliers fall to Others.
 */
export type BuyBucket = "digikey" | "mouser" | "lcsc" | "others";

export function buyBucket(supplier: string | null | undefined): BuyBucket {
  switch ((supplier ?? "").trim().toLowerCase()) {
    case "digikey":
    case "jellybean":
      return "digikey";
    case "mouser":
      return "mouser";
    case "lcsc":
      return "lcsc";
    default:
      return "others";
  }
}

// Common jellybean passives/discretes, recognized from a free-text part
// descriptor (used as a fallback for BOM lines that don't match a catalog part,
// so they still route to DigiKey instead of Others). Both µ (U+00B5) and μ
// (U+03BC) are accepted for "micro".
const JELLYBEAN_PATTERNS: RegExp[] = [
  /\d\s*[pnµμu]f\b/i, // capacitance: 100pF, 0.1 µF, 10uF, 100nF
  /\b(?:x5r|x7r|x6s|x8r|c0g|np0|y5v|z5u)\b/i, // ceramic dielectric codes → capacitor
  /\b\d+(?:\.\d+)?\s*[kmµμ]?\s*(?:ohm|Ω)/i, // resistance stated in ohms / Ω (Ω isn't a \w char, so no trailing \b)
  /\b\d+(?:\.\d+)?[km]\b/i, // resistor value shorthand: 10k, 4.7k, 1M
  /\b\d+[rk]\d+\b/i, // resistor code shorthand: 4k7, 1r0, 10k0
  /\d\s*[pnµμum]h\b/i, // inductance: 10µH, 100nH, 1mH
  /\bled\b/i, // LEDs
  /\b(?:ferrite|bead)\b/i, // ferrite beads
];

/** True when a free-text part descriptor looks like a jellybean passive/LED. */
export function isJellybeanDescriptor(text: string): boolean {
  return JELLYBEAN_PATTERNS.some((re) => re.test(text));
}

export interface MyListsItem {
  requestedPartNumber: string;
  quantities: { quantity: number }[];
}

/**
 * DigiKey "Add Multiple Parts" paste format: quantity, part number, customer
 * reference. The final comma is the intentionally blank reference column.
 */
export function formatDigikeyBulkAdd(
  items: Array<{ partNumber: string; quantity: number }>,
): string {
  return items
    .filter((item) => item.partNumber.trim() && item.quantity > 0)
    .map((item) => `${Math.trunc(item.quantity)},${item.partNumber.trim()},`)
    .join("\n");
}

/** Encode like Python's urllib quote_plus (space -> "+"), for query strings. */
function quotePlus(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

export function digikeySearchUrl(mpn: string): string {
  return `${DIGIKEY_BASE}/en/products/result?keywords=${quotePlus(mpn)}`;
}

export function mouserProductUrl(mpn: string): string {
  return `${MOUSER_BASE}/ProductDetail/${encodeURIComponent(mpn)}`;
}

export function mouserSearchUrl(mpn: string): string {
  return `${MOUSER_BASE}/c/?q=${quotePlus(mpn)}`;
}

export function lcscProductUrl(lcscPart: string): string {
  return `${LCSC_BASE}/product-detail/${encodeURIComponent(lcscPart)}.html`;
}

export function lcscSearchUrl(mpn: string): string {
  return `${LCSC_BASE}/search?q=${quotePlus(mpn)}`;
}

/**
 * Build the JSON body for the DigiKey MyLists third-party API.
 * Entries with an empty part number or a non-positive quantity are skipped.
 */
export function digikeyMylistsPayload(
  items: Array<[partNumber: string, quantity: number]>,
): MyListsItem[] {
  const payload: MyListsItem[] = [];
  for (const [partNumber, quantity] of items) {
    if (!partNumber || quantity <= 0) continue;
    payload.push({
      requestedPartNumber: partNumber,
      quantities: [{ quantity: Math.trunc(quantity) }],
    });
  }
  return payload;
}
