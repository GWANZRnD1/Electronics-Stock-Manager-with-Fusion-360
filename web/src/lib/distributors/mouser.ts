/**
 * Mouser Search API adapter (price + availability by MPN). API key in query
 * string. Falls back to a mock offer when no key is configured.
 */
import { mouserProductUrl } from "@/lib/domain/buyLinks";

import type { DistributorOffer, PriceBreak } from "./types";

export function mouserConfigured(): boolean {
  return Boolean(process.env.MOUSER_API_KEY);
}

interface MouserPart {
  MouserPartNumber?: string;
  ManufacturerPartNumber?: string;
  Manufacturer?: string;
  Description?: string;
  Availability?: string; // e.g. "625 In Stock"
  PriceBreaks?: { Quantity?: number; Price?: string; Currency?: string }[];
  DataSheetUrl?: string;
  ProductDetailUrl?: string;
}

function parseStock(availability?: string): number {
  if (!availability) return 0;
  const match = availability.replace(/,/g, "").match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function parsePrice(price?: string): number {
  if (!price) return 0;
  const n = Number(price.replace(/[^0-9.]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

export async function mouserSearch(mpn: string): Promise<DistributorOffer | null> {
  if (!mouserConfigured()) return mockOffer(mpn);

  const res = await fetch(
    `https://api.mouser.com/api/v1/search/keyword?apiKey=${encodeURIComponent(process.env.MOUSER_API_KEY ?? "")}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        SearchByKeywordRequest: {
          keyword: mpn,
          records: 5,
          startingRecord: 0,
          searchOptions: "",
          searchWithYourSignUpLanguage: "",
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`Mouser search failed (${res.status})`);

  const json = (await res.json()) as { SearchResults?: { Parts?: MouserPart[] } };
  const parts = json.SearchResults?.Parts ?? [];
  const part =
    parts.find((p) => p.ManufacturerPartNumber?.toLowerCase() === mpn.toLowerCase()) ?? parts[0];
  if (!part) return null;

  const priceBreaks: PriceBreak[] = (part.PriceBreaks ?? []).map((b) => ({
    quantity: b.Quantity ?? 0,
    unitPrice: parsePrice(b.Price),
    currency: b.Currency ?? "USD",
  }));

  return {
    distributor: "mouser",
    mpn: part.ManufacturerPartNumber ?? mpn,
    manufacturer: part.Manufacturer ?? "",
    description: part.Description ?? "",
    distributorPartNumber: part.MouserPartNumber ?? "",
    stock: parseStock(part.Availability),
    priceBreaks,
    productUrl: part.ProductDetailUrl ?? mouserProductUrl(mpn),
    datasheetUrl: part.DataSheetUrl ?? null,
    mock: false,
  };
}

function mockOffer(mpn: string): DistributorOffer {
  return {
    distributor: "mouser",
    mpn,
    manufacturer: "(mock)",
    description: "Set MOUSER_API_KEY for live data",
    distributorPartNumber: "",
    stock: 0,
    priceBreaks: [],
    productUrl: mouserProductUrl(mpn),
    datasheetUrl: null,
    mock: true,
  };
}
