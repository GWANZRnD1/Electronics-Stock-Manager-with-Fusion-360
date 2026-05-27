/**
 * LCSC has no public customer API. `lcscSearch` is a link-only offer (search
 * link, no live data). For a C-number we additionally enrich from EasyEDA's
 * (unofficial) component API, which carries the manufacturer / package the
 * scanned QR omits — see `lcscLookupByCNumber`.
 */
import { lcscSearchUrl } from "@/lib/domain/buyLinks";

import type { DistributorOffer } from "./types";

export function lcscSearch(mpn: string): DistributorOffer {
  return {
    distributor: "lcsc",
    mpn,
    manufacturer: "",
    description: "",
    category: "",
    package: "",
    distributorPartNumber: "",
    stock: 0,
    priceBreaks: [],
    productUrl: lcscSearchUrl(mpn),
    datasheetUrl: null,
    mock: true,
    note: "No public API — search link only",
  };
}

interface EasyEdaResponse {
  success?: boolean;
  result?: {
    title?: string;
    description?: string;
    dataStr?: { head?: { c_para?: Record<string, string> } };
  } | null;
}

const EASYEDA_COMPONENTS = "https://easyeda.com/api/products";
const LCSC_LOOKUP_TIMEOUT_MS = 6000;

/**
 * Enrich an LCSC part from its C-number via EasyEDA's component API. Returns a
 * real (non-mock) offer with the manufacturer / package / MPN that the scanned
 * QR omits, or null on any failure so the caller falls back to the link-only
 * offer. EasyEDA's "JLCPCB Part Class" is a sourcing tier ("Extended Part"),
 * not a category, so it is intentionally ignored.
 */
export async function lcscLookupByCNumber(cNumber: string): Promise<DistributorOffer | null> {
  const id = cNumber.trim().toUpperCase();
  if (!/^C\d+$/.test(id)) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LCSC_LOOKUP_TIMEOUT_MS);
    const res = await fetch(`${EASYEDA_COMPONENTS}/${id}/components?version=6.4.19.5`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const json = (await res.json()) as EasyEdaResponse;
    if (!json?.success || !json.result) return null;
    const para = json.result.dataStr?.head?.c_para ?? {};
    const get = (k: string) => (para[k] ?? "").trim();
    const manufacturer = get("Manufacturer");
    const mpn = get("Manufacturer Part");
    const pkg = get("package");
    const value = get("Value");
    const description = (json.result.description || json.result.title || "").trim();
    if (!manufacturer && !mpn && !pkg && !description) return null; // nothing useful
    return {
      distributor: "lcsc",
      mpn: mpn || id,
      manufacturer,
      description,
      category: "",
      package: pkg,
      distributorPartNumber: id,
      value: value || undefined,
      stock: 0,
      priceBreaks: [],
      productUrl: `https://www.lcsc.com/product-detail/${id}.html`,
      datasheetUrl: null,
      mock: false,
    };
  } catch {
    return null;
  }
}
