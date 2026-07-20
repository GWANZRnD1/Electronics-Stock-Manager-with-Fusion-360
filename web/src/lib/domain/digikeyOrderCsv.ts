/** Parse DigiKey order-history or myLists CSV exports into receivable stock. */
import Papa from "papaparse";

export interface DigikeyOrderItem {
  mpn: string;
  spn: string;
  manufacturer: string;
  description: string;
  quantity: number;
  unitCost: number | null;
}

export interface DigikeyOrderParseResult {
  items: DigikeyOrderItem[];
  sourceRows: number;
  skippedRows: number;
  parseErrors: number;
}

function key(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const MPN_HEADERS = [
  "manufacturerpartnumber",
  "manufacturerproductnumber",
  "mfrpartnumber",
  "mfrproductnumber",
  "mpn",
];
const SPN_HEADERS = [
  "digikeypartnumber",
  "digikeyproductnumber",
  "digikeypart",
  "dkpartnumber",
  "partnumber",
];
const SHIPPED_QUANTITY_HEADERS = [
  "quantityshipped",
  "shippedquantity",
  "qtyshipped",
  "invoicequantity",
];
const QUANTITY_HEADERS = [
  "quantity",
  "qty",
  "quantityordered",
  "orderedquantity",
  "orderquantity",
  "requestedquantity",
  "quantityrequested",
];
const MANUFACTURER_HEADERS = ["manufacturer", "manufacturername", "mfr"];
const DESCRIPTION_HEADERS = ["description", "productdescription", "partdescription"];
const UNIT_COST_HEADERS = ["unitprice", "customerunitprice", "priceeach", "unitcost"];

function indexOf(headers: string[], aliases: string[]): number {
  return headers.findIndex((header) => aliases.includes(header));
}

function quantityIndexes(headers: string[]): number[] {
  const shipped = SHIPPED_QUANTITY_HEADERS.map((alias) => headers.indexOf(alias)).filter(
    (index) => index >= 0,
  );
  const normal = QUANTITY_HEADERS.map((alias) => headers.indexOf(alias)).filter(
    (index) => index >= 0,
  );
  // myLists exports can call configurable columns "Quantity 1", "Quantity 2".
  const numbered = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => /^quantity\d+$/.test(header))
    .map(({ index }) => index);
  return [...new Set([...shipped, ...normal, ...numbered])];
}

function integer(value: string | undefined): number {
  const normalized = (value ?? "").replace(/[,\s]/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

function money(value: string | undefined): number | null {
  const normalized = (value ?? "").replace(/[$,\s]/g, "");
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function firstCell(row: string[], indexes: number[]): string {
  for (const index of indexes) {
    const value = row[index]?.trim();
    if (value) return value;
  }
  return "";
}

/**
 * DigiKey sometimes places order metadata above the actual CSV header. Locate
 * the row containing both a part-number and quantity column instead of assuming
 * the first row is the header.
 */
export function parseDigikeyOrderCsv(csv: string): DigikeyOrderParseResult {
  const parsed = Papa.parse<string[]>(csv.replace(/^\uFEFF/, ""), {
    skipEmptyLines: "greedy",
  });
  const rows = parsed.data.map((row) => row.map((cell) => String(cell ?? "").trim()));
  const headerIndex = rows.findIndex((row) => {
    const headers = row.map(key);
    const hasPart =
      indexOf(headers, MPN_HEADERS) >= 0 || indexOf(headers, SPN_HEADERS) >= 0;
    return hasPart && quantityIndexes(headers).length > 0;
  });
  if (headerIndex < 0) {
    throw new Error(
      "Could not find DigiKey part-number and quantity columns. Export the order/list as CSV.",
    );
  }

  const headers = rows[headerIndex].map(key);
  const mpnIndex = indexOf(headers, MPN_HEADERS);
  const spnIndex = indexOf(headers, SPN_HEADERS);
  const manufacturerIndex = indexOf(headers, MANUFACTURER_HEADERS);
  const descriptionIndex = indexOf(headers, DESCRIPTION_HEADERS);
  const unitCostIndex = indexOf(headers, UNIT_COST_HEADERS);
  const qtyIndexes = quantityIndexes(headers);
  const dataRows = rows.slice(headerIndex + 1);
  const grouped = new Map<string, DigikeyOrderItem>();
  let skippedRows = 0;

  for (const row of dataRows) {
    const spn = spnIndex >= 0 ? row[spnIndex]?.trim() ?? "" : "";
    const manufacturerMpn = mpnIndex >= 0 ? row[mpnIndex]?.trim() ?? "" : "";
    const mpn = manufacturerMpn || spn;
    const quantity = integer(firstCell(row, qtyIndexes));
    if (!mpn || quantity <= 0) {
      skippedRows += 1;
      continue;
    }

    const manufacturer =
      manufacturerIndex >= 0 ? row[manufacturerIndex]?.trim() ?? "" : "";
    const description =
      descriptionIndex >= 0 ? row[descriptionIndex]?.trim() ?? "" : "";
    const unitCost = unitCostIndex >= 0 ? money(row[unitCostIndex]) : null;
    const groupKey = mpn.toUpperCase();
    const current = grouped.get(groupKey);
    if (current) {
      current.quantity += quantity;
      if (!current.spn && spn) current.spn = spn;
      if (!current.manufacturer && manufacturer) current.manufacturer = manufacturer;
      if (!current.description && description) current.description = description;
      if (current.unitCost === null && unitCost !== null) current.unitCost = unitCost;
    } else {
      grouped.set(groupKey, {
        mpn,
        spn,
        manufacturer,
        description,
        quantity,
        unitCost,
      });
    }
  }

  const items = [...grouped.values()];
  if (items.length === 0) {
    throw new Error("No positive-quantity DigiKey order lines were found.");
  }
  return {
    items,
    sourceRows: dataRows.length,
    skippedRows,
    parseErrors: parsed.errors.length,
  };
}
