/**
 * DigiKey Product Information V4 adapter (price + real-time stock by MPN).
 * OAuth2 client_credentials (2-legged). Falls back to a mock offer when no key
 * is configured. Token is cached in-memory until shortly before it expires.
 */
import { digikeySearchUrl } from "@/lib/domain/buyLinks";

import type { DistributorOffer } from "./types";

let tokenCache: { token: string; expiresAt: number } | null = null;

function base(): string {
  return process.env.DIGIKEY_USE_SANDBOX === "false"
    ? "https://api.digikey.com"
    : "https://sandbox-api.digikey.com";
}

export function digikeyConfigured(): boolean {
  return Boolean(process.env.DIGIKEY_CLIENT_ID && process.env.DIGIKEY_CLIENT_SECRET);
}

async function getToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const res = await fetch(`${base()}/v1/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.DIGIKEY_CLIENT_ID ?? "",
      client_secret: process.env.DIGIKEY_CLIENT_SECRET ?? "",
    }),
  });
  if (!res.ok) throw new Error(`DigiKey token request failed (${res.status})`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in - 60) * 1000,
  };
  return tokenCache.token;
}

// Loose shape — DigiKey v4 returns more; we read defensively.
interface DkProduct {
  ManufacturerProductNumber?: string;
  Manufacturer?: { Name?: string };
  Description?: { ProductDescription?: string };
  Category?: { Name?: string };
  Parameters?: { ParameterText?: string; ValueText?: string }[];
  QuantityAvailable?: number;
  ProductUrl?: string;
  DatasheetUrl?: string;
  ProductVariations?: {
    DigiKeyProductNumber?: string;
    StandardPricing?: { BreakQuantity?: number; UnitPrice?: number }[];
  }[];
}

const PACKAGE_PARAMS = ["package / case", "supplier device package", "package", "case / package"];

function dkPackage(params: DkProduct["Parameters"]): string {
  for (const p of params ?? []) {
    if (PACKAGE_PARAMS.includes((p.ParameterText ?? "").toLowerCase()) && p.ValueText) {
      return p.ValueText;
    }
  }
  return "";
}

// Component-value parameters, in priority order — the headline rating for each part type.
const VALUE_PARAMS = ["resistance", "capacitance", "inductance", "frequency", "voltage - rated"];

function dkValue(params: DkProduct["Parameters"]): string {
  for (const name of VALUE_PARAMS) {
    const p = (params ?? []).find((x) => (x.ParameterText ?? "").toLowerCase() === name);
    if (p?.ValueText) return p.ValueText;
  }
  return "";
}

export async function digikeySearch(mpn: string): Promise<DistributorOffer | null> {
  if (!digikeyConfigured()) return mockOffer(mpn);

  const token = await getToken();
  const res = await fetch(`${base()}/products/v4/search/keyword`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "X-DIGIKEY-Client-Id": process.env.DIGIKEY_CLIENT_ID ?? "",
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ Keywords: mpn, Limit: 5 }),
  });
  if (!res.ok) throw new Error(`DigiKey search failed (${res.status})`);

  const json = (await res.json()) as { Products?: DkProduct[] };
  const product = json.Products?.[0];
  if (!product) return null;

  const variation = product.ProductVariations?.[0];
  const priceBreaks = (variation?.StandardPricing ?? []).map((b) => ({
    quantity: b.BreakQuantity ?? 0,
    unitPrice: b.UnitPrice ?? 0,
    currency: "USD",
  }));

  return {
    distributor: "digikey",
    mpn: product.ManufacturerProductNumber ?? mpn,
    manufacturer: product.Manufacturer?.Name ?? "",
    description: product.Description?.ProductDescription ?? "",
    category: product.Category?.Name ?? "",
    package: dkPackage(product.Parameters),
    value: dkValue(product.Parameters),
    distributorPartNumber: variation?.DigiKeyProductNumber ?? "",
    stock: product.QuantityAvailable ?? 0,
    priceBreaks,
    productUrl: product.ProductUrl ?? digikeySearchUrl(mpn),
    datasheetUrl: product.DatasheetUrl ?? null,
    mock: false,
  };
}

function mockOffer(mpn: string): DistributorOffer {
  return {
    distributor: "digikey",
    mpn,
    manufacturer: "(mock)",
    description: "Set DIGIKEY_CLIENT_ID/SECRET for live data",
    category: "",
    package: "",
    distributorPartNumber: "",
    stock: 0,
    priceBreaks: [],
    productUrl: digikeySearchUrl(mpn),
    datasheetUrl: null,
    mock: true,
  };
}
