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

export interface MyListsItem {
  requestedPartNumber: string;
  quantities: { quantity: number }[];
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
