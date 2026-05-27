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

const LCSC_LOOKUP_TIMEOUT_MS = 6000;
// LCSC's site API rejects requests without a browser-like User-Agent.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const productUrl = (id: string) => `https://www.lcsc.com/product-detail/${id}.html`;

async function fetchJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LCSC_LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": BROWSER_UA },
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Look up an LCSC part by its C-number and return a full DigiKey/Mouser-grade
 * offer (manufacturer, category, package, stock, USD price breaks, datasheet)
 * from LCSC's own (unofficial) site API, falling back to EasyEDA for basic
 * metadata, then null so the caller uses the link-only offer.
 */
export async function lcscLookupByCNumber(cNumber: string): Promise<DistributorOffer | null> {
  const id = cNumber.trim().toUpperCase();
  if (!/^C\d+$/.test(id)) return null;
  return (await lcscDetailLookup(id)) ?? (await easyEdaLookup(id));
}

// --- LCSC site API (wmsc): full offer with price/stock/datasheet ----------------

const LCSC_DETAIL_API = "https://wmsc.lcsc.com/ftps/wm/product/detail";

interface LcscPriceLadder {
  ladder?: number;
  usdPrice?: number;
}
interface LcscDetail {
  productCode?: string;
  productModel?: string;
  brandNameEn?: string;
  catalogName?: string;
  parentCatalogName?: string;
  encapStandard?: string;
  stockNumber?: number;
  productIntroEn?: string;
  productDescEn?: string;
  productNameEn?: string;
  pdfUrl?: string;
  productPriceList?: LcscPriceLadder[];
}

async function lcscDetailLookup(id: string): Promise<DistributorOffer | null> {
  const json = (await fetchJson(`${LCSC_DETAIL_API}?productCode=${encodeURIComponent(id)}`)) as {
    result?: LcscDetail | null;
  } | null;
  const r = json?.result;
  if (!r || !r.productCode) return null;
  const priceBreaks = (r.productPriceList ?? [])
    .filter((p): p is Required<LcscPriceLadder> => typeof p.ladder === "number" && typeof p.usdPrice === "number" && p.usdPrice > 0)
    .map((p) => ({ quantity: p.ladder, unitPrice: p.usdPrice, currency: "USD" }));
  const pkg = (r.encapStandard ?? "").trim();
  return {
    distributor: "lcsc",
    mpn: (r.productModel ?? "").trim() || id,
    manufacturer: (r.brandNameEn ?? "").trim(),
    description: (r.productIntroEn || r.productDescEn || r.productNameEn || "").trim(),
    category: (r.catalogName || r.parentCatalogName || "").trim(),
    package: pkg === "-" ? "" : pkg,
    distributorPartNumber: id,
    stock: typeof r.stockNumber === "number" ? r.stockNumber : 0,
    priceBreaks,
    productUrl: productUrl(id),
    datasheetUrl: (r.pdfUrl ?? "").trim() || null,
    mock: false,
  };
}

// --- EasyEDA fallback: basic manufacturer / package, no price/stock -------------

const EASYEDA_COMPONENTS = "https://easyeda.com/api/products";

interface EasyEdaResponse {
  success?: boolean;
  result?: {
    title?: string;
    description?: string;
    dataStr?: { head?: { c_para?: Record<string, string> } };
  } | null;
}

async function easyEdaLookup(id: string): Promise<DistributorOffer | null> {
  const json = (await fetchJson(`${EASYEDA_COMPONENTS}/${id}/components?version=6.4.19.5`)) as
    | EasyEdaResponse
    | null;
  if (!json?.success || !json.result) return null;
  const para = json.result.dataStr?.head?.c_para ?? {};
  const get = (k: string) => (para[k] ?? "").trim();
  const manufacturer = get("Manufacturer");
  const mpn = get("Manufacturer Part");
  const pkg = get("package");
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
    stock: 0,
    priceBreaks: [],
    productUrl: productUrl(id),
    datasheetUrl: null,
    mock: false,
  };
}
