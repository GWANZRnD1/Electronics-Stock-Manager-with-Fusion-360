/**
 * The board BOM editor is a plain textarea — one part per line:
 *   "MPN, qty, value, package, designators"   (only MPN + qty are required)
 *
 * The catch: an MPN can legitimately contain commas. Jauch crystals, for
 * instance, use a decimal-comma part number like "Q 0,032768-JTX310-9-10-T2-HMR-LF"
 * (the "0,032768" is 0.032768 MHz). Comma is also the field delimiter, so:
 *   - bomToText keeps every field *except* the MPN comma-free, and
 *   - parseBomText treats any commas beyond the expected 5 fields as part of the
 *     MPN (folding them back in).
 * That makes the round-trip lossless for real-world MPNs — without it,
 * parseInt("032768-JTX310…") would be read as a quantity of 32768.
 */

export interface BomTextFields {
  partMpn: string | null;
  value: string;
  package: string;
  designators: string;
  qtyPerBoard: number;
}

const stripCommas = (s: string): string => s.replace(/,/g, " ");

/** Parse the textarea contents into BOM lines. */
export function parseBomText(text: string): BomTextFields[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const cells = line.split(",").map((s) => s.trim());
      // More than 5 fields can only mean the MPN itself contained commas
      // (bomToText guarantees the other four carry none), so fold the leading
      // extras back into the MPN and read the structured tail from the right.
      const overflow = cells.length > 5;
      const mpn = overflow ? cells.slice(0, cells.length - 4).join(",") : cells[0] ?? "";
      const [qty, value, pkg, des] = overflow ? cells.slice(cells.length - 4) : cells.slice(1);
      return {
        partMpn: mpn || null,
        qtyPerBoard: Math.max(1, parseInt(qty || "1", 10) || 1),
        value: value ?? "",
        package: pkg ?? "",
        designators: des ?? "",
      };
    });
}

/**
 * Render BOM rows back to the textarea format. Only the MPN may carry commas
 * (parseBomText folds them back in); the other fields are stripped so the
 * round-trip stays unambiguous — designators become a space-separated list.
 */
export function bomToText(rows: readonly BomTextFields[]): string {
  return rows
    .map((r) =>
      [
        r.partMpn ?? "",
        r.qtyPerBoard,
        stripCommas(r.value),
        stripCommas(r.package),
        stripCommas(r.designators),
      ].join(", "),
    )
    .join("\n");
}
