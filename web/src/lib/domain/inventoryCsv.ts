/**
 * Pure transforms for importing the "CurrentInventory" CSV export. The source is
 * hand-maintained, so every field is defensive: currency comes in as " $1.78 ",
 * ".39", or "$-"; dates are day-first and inconsistent ("23/10/2024", "19/5/23");
 * supplier is inferred from the part-number shape. Grouping/DB work lives in the
 * import repo — this file only normalizes one row at a time.
 */

/** A raw CSV row keyed by the (trimmed) header names of CurrentInventory.csv. */
export interface RawInventoryRow {
  Category?: string;
  "Digikey Part Number"?: string;
  Manufacturer?: string;
  MPN?: string;
  Description?: string;
  "Quantity Here"?: string;
  Location1?: string;
  "Last confirmed"?: string;
  Value?: string;
}

export interface NormalizedRow {
  category: string;
  supplier: string;
  spn: string;
  manufacturer: string;
  mpn: string;
  description: string;
  value: string; // best-effort component value extracted from the description
  unitCost: number | null;
  quantity: number;
  location: string; // trimmed; "" when blank
  lastConfirmedAt: Date | null;
}

/** Parse a currency cell. Strips "$", commas, whitespace; "", "-", "$-" → null. */
export function parseMoney(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Parse a day-first date ("23/10/2024", "19/5/23"). Returns null if unparseable. */
export function parseConfirmedDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31 || year > 2100) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? d : null;
}

/** Parse a quantity cell; blank/garbage → 0, never negative. */
export function parseQuantity(raw: string | undefined): number {
  if (!raw) return 0;
  const n = parseInt(raw.replace(/[, ]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Infer the supplier from the supplier-part-number shape and manufacturer. */
export function inferSupplier(spn: string, manufacturer: string): string {
  if (/lcsc/i.test(spn)) return "LCSC";
  if (manufacturer.trim().toLowerCase() === "jellybean") return "Jellybean";
  if (/-nd$/i.test(spn.trim())) return "DigiKey";
  return "";
}

const PREFIX: Record<string, string> = {
  p: "p", P: "p", n: "n", N: "n", u: "µ", U: "µ", µ: "µ", m: "m", k: "k", K: "k", M: "M", G: "G",
};
const UNIT: Record<string, string> = { f: "F", h: "H", hz: "Hz", ohm: "Ω", ohms: "Ω", "ω": "Ω", v: "V", a: "A", w: "W" };

/**
 * Best-effort component value from a description's leading "<number><prefix><unit>"
 * (e.g. "10 kOhms ±1% …" → "10kΩ", "0.015 µF …" → "0.015µF", "16 MHz …" → "16MHz").
 * Returns "" when the description doesn't start with a recognizable value (ICs,
 * connectors, etc.) — those get filled by distributor lookup later.
 */
export function extractValue(description: string): string {
  const m = description
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*([pPnNuUµmkKMG]?)\s*(Ohms?|Ω|F|H|Hz|V|A|W)\b/i);
  if (!m) return "";
  const num = m[1];
  const prefix = m[2] ? PREFIX[m[2]] ?? "" : "";
  const unit = UNIT[m[3].toLowerCase()] ?? m[3];
  return `${num}${prefix}${unit}`;
}

/** Normalize one raw CSV row into typed fields. */
export function normalizeRow(r: RawInventoryRow): NormalizedRow {
  const g = (v: string | undefined) => (v ?? "").trim();
  const spn = g(r["Digikey Part Number"]);
  const manufacturer = g(r.Manufacturer);
  const description = g(r.Description);
  return {
    category: g(r.Category),
    supplier: inferSupplier(spn, manufacturer),
    spn,
    manufacturer,
    mpn: g(r.MPN),
    description,
    value: extractValue(description),
    unitCost: parseMoney(r.Value),
    quantity: parseQuantity(r["Quantity Here"]),
    location: g(r.Location1),
    lastConfirmedAt: parseConfirmedDate(r["Last confirmed"]),
  };
}
