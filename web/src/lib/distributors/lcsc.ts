/** LCSC official partner API plus C-number lookup fallbacks. */
import { createHash, randomBytes } from "node:crypto";

import { lcscSearchUrl } from "@/lib/domain/buyLinks";
import { type PartCandidate, unitPriceAtQuantity } from "@/lib/domain/jellybeanQuery";

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
    note: "LCSC partner API is not configured — search link only",
  };
}

const LCSC_PARTNER_API = "https://ips.lcsc.com/rest/wmsc2agent";
const partnerCache = new Map<string, { at: number; rows: PartCandidate[] }>();
const PARTNER_CACHE_MS = 10 * 60 * 1000;

export function lcscConfigured(): boolean {
  return Boolean(process.env.LCSC_API_KEY && process.env.LCSC_API_SECRET);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textValue(...values: unknown[]): string {
  return String(values.find((value) => typeof value === "string" && value.trim()) ?? "").trim();
}

function numberValue(...values: unknown[]): number {
  const found = values.find(
    (value) => typeof value === "number" || (typeof value === "string" && value.trim()),
  );
  const number = Number(found ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function resultRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result.map(record).filter(Boolean) as Record<string, unknown>[];
  const root = record(result);
  if (!root) return [];
  for (const key of [
    "productList",
    "ProductList",
    "products",
    "Products",
    "records",
    "Records",
    "list",
    "items",
    "Items",
    "content",
    "data",
  ]) {
    const value = root[key];
    if (Array.isArray(value)) {
      return value.map(record).filter(Boolean) as Record<string, unknown>[];
    }
    const nested = record(value);
    if (nested) {
      const rows = resultRows(nested);
      if (rows.length > 0) return rows;
    }
  }
  return [];
}

function priceBreaksFrom(row: Record<string, unknown>): { quantity: number; unitPrice: number }[] {
  const raw =
    row.productPriceList ??
    row.ProductPriceList ??
    row.priceList ??
    row.PriceList ??
    row.prices ??
    row.Prices ??
    row.productPrices ??
    [];
  if (!Array.isArray(raw)) return [];
  return raw
    .map(record)
    .filter(Boolean)
    .map((price) => ({
      quantity: numberValue(
        price!.ladder,
        price!.Ladder,
        price!.quantity,
        price!.Quantity,
        price!.breakQuantity,
        price!.BreakQuantity,
        price!.startNumber,
        price!.minQuantity,
      ),
      unitPrice: numberValue(
        price!.usdPrice,
        price!.UsdPrice,
        price!.unitPrice,
        price!.UnitPrice,
        price!.price,
        price!.Price,
        price!.productPrice,
      ),
    }))
    .filter((price) => price.quantity > 0 && price.unitPrice > 0)
    .sort((a, b) => a.quantity - b.quantity);
}

/**
 * Official LCSC keyword search. Credentials require LCSC approval; when absent,
 * callers receive an empty list and can still show ordinary search links.
 */
export async function lcscSearchCandidates(
  keyword: string,
  options: {
    quantity?: number;
    exact?: boolean;
    inStockOnly?: boolean;
    excludeMarketplace?: boolean;
  } = {},
): Promise<PartCandidate[]> {
  if (!lcscConfigured()) return [];
  const quantity = Math.max(1, options.quantity ?? 1);
  const cacheKey = `${keyword.trim().toLowerCase()}|${options.exact ? "exact" : "fuzzy"}`;
  const cached = partnerCache.get(cacheKey);
  let rows: PartCandidate[];
  if (cached && Date.now() - cached.at < PARTNER_CACHE_MS) {
    rows = cached.rows;
  } else {
    const key = process.env.LCSC_API_KEY!;
    const secret = process.env.LCSC_API_SECRET!;
    const nonce = randomBytes(8).toString("hex");
    // LCSC's documented timestamp is Unix seconds (their example is 10 digits)
    // and expires after 60 seconds.
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHash("sha1")
      .update(`key=${key}&nonce=${nonce}&secret=${secret}&timestamp=${timestamp}`)
      .digest("hex");
    const query = new URLSearchParams({
      keyword,
      limit: "30",
      offset: "0",
      language: "EN",
      returnInformation: "All",
      inStockOnly: "True",
      currency: "USD",
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let response: Response;
    try {
      response = await fetch(`${LCSC_PARTNER_API}/search/product?${query}`, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          key,
          nonce,
          timestamp,
          signature,
        },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`LCSC search failed (${response.status})`);
    const json = (await response.json()) as {
      success?: boolean;
      code?: number;
      message?: string;
      result?: unknown;
    };
    if (json.success === false) {
      throw new Error(`LCSC search failed (${json.code ?? "error"}): ${json.message ?? ""}`.trim());
    }
    rows = resultRows(json.result).flatMap((row) => {
      const partNumber = textValue(
        row.productCode,
        row.ProductCode,
        row.lcscPartNumber,
        row.LcscPartNumber,
        row.lcsc_part_number,
        row.sku,
        row.Sku,
      ).toUpperCase();
      const mpn = textValue(
        row.productModel,
        row.ProductModel,
        row.mpn,
        row.Mpn,
        row.manufacturerPartNumber,
        row.ManufacturerPartNumber,
        row.product_model,
      );
      if (!partNumber && !mpn) return [];
      const priceBreaks = priceBreaksFrom(row);
      return [{
        partNumber: partNumber || mpn,
        mpn: mpn || partNumber,
        manufacturer: textValue(
          row.brandNameEn,
          row.BrandNameEn,
          row.manufacturer,
          row.Manufacturer,
          row.brandName,
        ),
        packageText: textValue(
          row.encapStandard,
          row.EncapStandard,
          row.package,
          row.Package,
          row.packageType,
        ),
        description: textValue(
          row.productIntroEn,
          row.ProductIntroEn,
          row.productDescEn,
          row.ProductDescEn,
          row.productNameEn,
          row.ProductNameEn,
          row.description,
          row.Description,
        ),
        category: textValue(
          row.catalogName,
          row.CatalogName,
          row.parentCatalogName,
          row.category,
          row.Category,
        ),
        value: textValue(row.value, row.Value, row.productValue),
        stock: numberValue(
          row.stockNumber,
          row.StockNumber,
          row.stock,
          row.Stock,
          row.quantity,
          row.availableQuantity,
        ),
        unitPrice: 0,
        priceBreaks,
        normallyStocking: true,
        marketplace: Boolean(row.otherSupplier ?? row.marketplace),
        productUrl: productUrl(partNumber || mpn),
      } satisfies PartCandidate];
    });
    partnerCache.set(cacheKey, { at: Date.now(), rows });
  }

  return rows
    .filter(
      (candidate) =>
        (!options.inStockOnly || candidate.stock >= quantity) &&
        (!options.excludeMarketplace || !candidate.marketplace),
    )
    .map((candidate) => ({
      ...candidate,
      unitPrice: unitPriceAtQuantity(candidate.priceBreaks, quantity),
    }));
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
