export type DistributorId = "digikey" | "mouser" | "lcsc";

export interface PriceBreak {
  quantity: number;
  unitPrice: number;
  currency: string;
}

export interface DistributorOffer {
  distributor: DistributorId;
  mpn: string;
  manufacturer: string;
  description: string;
  category: string;
  package: string;
  distributorPartNumber: string;
  value?: string; // parametric component value (e.g. "10 kOhms", "0.1 µF"), when available
  stock: number;
  priceBreaks: PriceBreak[];
  productUrl: string;
  datasheetUrl: string | null;
  mock: boolean; // true when returned by sandbox/mock fallback (no API key configured)
  note?: string; // e.g. LCSC link-only (no public API)
}

export interface LookupResult {
  mpn: string;
  offers: DistributorOffer[];
  errors?: { distributor: DistributorId; message: string }[]; // per-distributor failures (e.g. 429)
}
