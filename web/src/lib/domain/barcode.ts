/**
 * Parse scanned distributor labels into a structured identity.
 *
 * Supports DigiKey/Mouser ECIA EIGP 114 / ANSI MH10.8.2 DataMatrix labels and
 * LCSC QR labels. Pure functions, no I/O. Runs in the browser (PWA scanner) or
 * in an API route. See docs/ARCHITECTURE.md for the label formats.
 */

// ASCII control characters used by the ECIA / MH10.8.2 DataMatrix format.
export const GS = "\x1d"; // Group Separator — between data fields
export const RS = "\x1e"; // Record Separator — after the "06" header / before trailer
export const EOT = "\x04"; // End of Transmission — final trailer char

export type Distributor = "digikey" | "mouser" | "lcsc" | "unknown";
export type LabelFormat = "ecia_datamatrix" | "lcsc_qr" | "bare";

export interface ScannedLabel {
  distributor: Distributor;
  mpn: string | null;
  quantity: number | null;
  distributorPart: string | null;
  labelFormat: LabelFormat;
  rawFields: Record<string, string>;
}

// MH10.8.2 Data Identifiers -> our field names. Multi-char DIs are matched first.
const DATA_IDENTIFIERS: Record<string, string> = {
  "1P": "mpn", // Manufacturer part number
  "30P": "distributorPart", // Distributor part number (alternate)
  P: "customerPart", // Customer/distributor part number (e.g. DigiKey part #)
  "10K": "invoice",
  "11K": "packingList",
  "1K": "supplierOrder",
  K: "purchaseOrder",
  "4L": "countryOfOrigin",
  "1T": "lotCode",
  "10D": "dateCode",
  "9D": "dateCode",
  "1V": "manufacturerCode",
  Q: "quantity",
};
const DI_BY_LENGTH = Object.keys(DATA_IDENTIFIERS).sort((a, b) => b.length - a.length);

const ECIA_HEADERS = [
  `[)>${RS}06${GS}`,
  `[)>${RS}06`,
  ">[)>06", // malformed header seen on some Mouser labels (missing RS)
  "[)>06",
];

/**
 * Choose the correct text for a scanned 2D code from its raw bytes. A scanner
 * library's rendered text can drop the ECIA control separators (GS/RS/EOT) and
 * guess the wrong charset for non-Latin payloads, so decode the bytes here:
 * ECIA / MH10.8.2 labels (ASCII + control chars, identified by the `[)>`
 * header) are read as Latin-1 to preserve every byte; everything else is read
 * as UTF-8, then GBK (LCSC packs Chinese product names), then `fallbackText`.
 */
export function decodeScannedBytes(
  bytes: Uint8Array | null | undefined,
  fallbackText = "",
): string {
  if (!bytes || bytes.length === 0) return fallbackText;
  const latin1 = new TextDecoder("iso-8859-1").decode(bytes);
  if (latin1.includes("[)>")) return latin1;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("gbk").decode(bytes);
    } catch {
      return fallbackText || latin1;
    }
  }
}

export function parseLabel(raw: string | null | undefined): ScannedLabel {
  if (raw == null) throw new Error("raw label is required");
  const text = raw.trim();
  if (!text) throw new Error("empty label");

  if (text.startsWith("{") && text.endsWith("}")) return parseLcsc(text);
  if (text.includes("[)>")) return parseEcia(text);
  if (looksLikeLcscPart(text)) {
    return {
      distributor: "lcsc",
      mpn: null,
      quantity: null,
      distributorPart: text,
      labelFormat: "bare",
      rawFields: { customerPart: text },
    };
  }
  // Bare string: treat as a possible MPN typed/scanned from a 1D code.
  return {
    distributor: "unknown",
    mpn: text,
    quantity: null,
    distributorPart: null,
    labelFormat: "bare",
    rawFields: { raw: text },
  };
}

function parseLcsc(text: string): ScannedLabel {
  const fields: Record<string, string> = {};
  for (const pair of text.slice(1, -1).split(",")) {
    const idx = pair.indexOf(":");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    if (key) fields[key] = pair.slice(idx + 1).trim();
  }
  return {
    distributor: "lcsc",
    mpn: fields.pm || null,
    quantity: toInt(fields.qty),
    distributorPart: fields.pc || null,
    labelFormat: "lcsc_qr",
    rawFields: fields,
  };
}

function parseEcia(text: string): ScannedLabel {
  let body = text.split(RS + EOT)[0];
  for (const header of ECIA_HEADERS) {
    if (body.startsWith(header)) {
      body = body.slice(header.length);
      break;
    }
  }
  const fields: Record<string, string> = {};
  for (const rawToken of body.split(GS)) {
    const token = rawToken.trim().replace(/^[\x1e\x04]+|[\x1e\x04]+$/g, "");
    if (!token) continue;
    const di = matchDi(token);
    if (!di) continue;
    fields[DATA_IDENTIFIERS[di]] = token.slice(di.length);
  }
  return {
    distributor: guessEciaDistributor(fields),
    mpn: fields.mpn || null,
    quantity: toInt(fields.quantity),
    distributorPart: fields.customerPart || fields.distributorPart || null,
    labelFormat: "ecia_datamatrix",
    rawFields: fields,
  };
}

function matchDi(token: string): string | null {
  for (const di of DI_BY_LENGTH) {
    if (token.startsWith(di)) return di;
  }
  return null;
}

function guessEciaDistributor(fields: Record<string, string>): Distributor {
  return (fields.customerPart ?? "").endsWith("-ND") ? "digikey" : "unknown";
}

function looksLikeLcscPart(text: string): boolean {
  return text.length > 1 && (text[0] === "C" || text[0] === "c") && /^\d+$/.test(text.slice(1));
}

function toInt(value: string | undefined | null): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}
