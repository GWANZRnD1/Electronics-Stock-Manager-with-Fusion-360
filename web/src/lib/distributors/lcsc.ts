/**
 * LCSC has no public customer API, so this is a link-only offer: a search link,
 * no live price/stock. (Buying via batch is per-part links + CSV elsewhere.)
 */
import { lcscSearchUrl } from "@/lib/domain/buyLinks";

import type { DistributorOffer } from "./types";

export function lcscSearch(mpn: string): DistributorOffer {
  return {
    distributor: "lcsc",
    mpn,
    manufacturer: "",
    description: "",
    distributorPartNumber: "",
    stock: 0,
    priceBreaks: [],
    productUrl: lcscSearchUrl(mpn),
    datasheetUrl: null,
    mock: true,
    note: "No public API — search link only",
  };
}
