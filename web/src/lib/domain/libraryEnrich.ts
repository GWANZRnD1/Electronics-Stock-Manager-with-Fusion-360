/**
 * Merge resolved part data (from the DB catalog or a distributor lookup) into a
 * library row's attribute columns. Only columns that ALREADY exist in the row are
 * filled — we never invent attribute names Fusion doesn't know — and matching is
 * by a name alias (so MFR / MANUFACTURER both receive the manufacturer). With
 * `overwrite` off we fill blanks only; with it on, API-fillable columns are replaced.
 */
import type { LibraryRow } from "./libraryScr";

/** Normalized fields a DB part or a distributor offer can supply. */
export interface ResolvedFields {
  manufacturer?: string;
  mpn?: string;
  spn?: string;
  description?: string;
  value?: string;
  category?: string;
  datasheet?: string;
}

/** Library attribute-column names (UPPER-cased) that map to each resolved field. */
const FIELD_ALIASES: Record<keyof ResolvedFields, string[]> = {
  manufacturer: ["MFR", "MANUFACTURER", "MFN", "MFR_NAME", "MANUFACTURER_NAME"],
  mpn: ["MPN", "MANUFACTURER_PART_NUMBER", "MANUFACTURERPARTNUMBER", "MFR_PN", "MF_PARTNUMBER", "PART_NUMBER", "PARTNUMBER"],
  spn: ["SPN", "DIGIKEY", "SUPPLIER_PART_NUMBER", "DIGIKEY_PN"],
  description: ["DESCRIPTION", "DESC"],
  value: ["VALUE"],
  category: ["CATEGORY"],
  datasheet: ["DATASHEET", "DATASHEET_URL", "DATASHEETURL"],
};

const upper = (s: string): string => s.trim().toUpperCase();

/** The row's value for a resolved field, read from whichever alias column exists. */
export function readField(row: LibraryRow, field: keyof ResolvedFields): string {
  const aliases = FIELD_ALIASES[field];
  for (const [name, value] of Object.entries(row.attributes)) {
    if (aliases.includes(upper(name))) return value;
  }
  return "";
}

/** A part number is usable as a lookup key only if it isn't a free-text description. */
export function looksLikePartNumber(value: string): boolean {
  const v = value.trim();
  if (v.length < 3) return false;
  // Real MPNs/SPNs are contiguous (letters, digits, dashes); descriptions
  // wrongly stored in MPN/SPN have whitespace (e.g. "0.1 µF 50V X7R 0603").
  if (/\s/.test(v)) return false;
  return true;
}

/** Prefer a real MPN as the lookup key, else the supplier part number. */
export function identifierOf(row: LibraryRow): { key: string; kind: "mpn" | "spn" } | null {
  const mpn = readField(row, "mpn").trim();
  if (mpn && looksLikePartNumber(mpn)) return { key: mpn, kind: "mpn" };
  const spn = readField(row, "spn").trim();
  if (spn && looksLikePartNumber(spn)) return { key: spn, kind: "spn" };
  return null;
}

export interface RowEnrichment {
  row: LibraryRow; // new row (immutable update); unchanged if nothing filled
  filled: string[]; // attribute column names that were written
}

/**
 * Fill the row's existing alias columns from `fields`. Blank cells are always
 * filled; non-blank cells only when `overwrite` is true. Returns a new row.
 */
export function applyResolved(
  row: LibraryRow,
  fields: ResolvedFields,
  options: { overwrite?: boolean } = {},
): RowEnrichment {
  const overwrite = options.overwrite ?? false;
  const attributes = { ...row.attributes };
  const filled: string[] = [];

  for (const [field, value] of Object.entries(fields) as [keyof ResolvedFields, string | undefined][]) {
    const incoming = (value ?? "").trim();
    if (!incoming) continue;
    const aliases = FIELD_ALIASES[field];
    // Find the existing column whose name matches an alias (first match wins).
    const column = Object.keys(attributes).find((name) => aliases.includes(upper(name)));
    if (!column) continue; // only fill columns that already exist
    const current = (attributes[column] ?? "").trim();
    if (current !== "" && !overwrite) continue;
    if (attributes[column] === incoming) continue;
    attributes[column] = incoming;
    filled.push(column);
  }

  return filled.length > 0 ? { row: { ...row, attributes }, filled } : { row, filled: [] };
}
