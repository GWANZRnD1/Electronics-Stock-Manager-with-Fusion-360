import { describe, expect, it } from "vitest";

import { applyResolved, identifierOf, looksLikePartNumber, readField } from "./libraryEnrich";
import type { LibraryRow } from "./libraryScr";

function row(attributes: Record<string, string>): LibraryRow {
  return { deviceset: "DS", variant: "V", package: "P", technology: "T", attributes };
}

describe("identifierOf", () => {
  it("prefers a real MPN over the SPN", () => {
    expect(identifierOf(row({ MPN: "RMCF0402FT1K20", SPN: "RMCF0402FT1K20CT-ND" }))).toEqual({
      key: "RMCF0402FT1K20",
      kind: "mpn",
    });
  });

  it("falls back to SPN when MPN is blank", () => {
    expect(identifierOf(row({ MPN: "", SPN: "273-ND" }))).toEqual({ key: "273-ND", kind: "spn" });
  });

  it("ignores a description wrongly stored as the part number", () => {
    expect(identifierOf(row({ MPN: "10 kOhm 0603 (1608 Metric)", SPN: "" }))).toBeNull();
  });
});

describe("looksLikePartNumber", () => {
  it("accepts real part numbers and rejects descriptions", () => {
    expect(looksLikePartNumber("RMCF0402FT1K20CT-ND")).toBe(true);
    expect(looksLikePartNumber("0.1 µF 50V X7R 0603")).toBe(false);
  });
});

describe("readField", () => {
  it("reads a field from whichever alias column exists", () => {
    expect(readField(row({ MANUFACTURER: "Ohmite" }), "manufacturer")).toBe("Ohmite");
    expect(readField(row({ MFR: "Yageo" }), "manufacturer")).toBe("Yageo");
  });
});

describe("applyResolved", () => {
  it("fills a blank existing column and reports it", () => {
    const result = applyResolved(row({ MFR: "", MPN: "X" }), { manufacturer: "Ohmite" });
    expect(result.filled).toEqual(["MFR"]);
    expect(result.row.attributes.MFR).toBe("Ohmite");
  });

  it("does not overwrite a non-blank cell by default", () => {
    const result = applyResolved(row({ MFR: "Keep" }), { manufacturer: "New" });
    expect(result.filled).toEqual([]);
    expect(result.row.attributes.MFR).toBe("Keep");
  });

  it("overwrites a non-blank cell when overwrite is on", () => {
    const result = applyResolved(row({ MFR: "Old" }), { manufacturer: "New" }, { overwrite: true });
    expect(result.filled).toEqual(["MFR"]);
    expect(result.row.attributes.MFR).toBe("New");
  });

  it("never invents a column that does not already exist", () => {
    const result = applyResolved(row({ MPN: "X" }), { datasheet: "http://d" });
    expect(result.filled).toEqual([]);
    expect("DATASHEET" in result.row.attributes).toBe(false);
  });

  it("backfills a blank MPN column from a resolved MPN (SPN→MPN)", () => {
    const result = applyResolved(row({ MPN: "", SPN: "273-ND" }), { mpn: "KDV06DR068ET" });
    expect(result.row.attributes.MPN).toBe("KDV06DR068ET");
  });

  it("leaves the original row untouched (immutable)", () => {
    const original = row({ MFR: "" });
    applyResolved(original, { manufacturer: "Ohmite" });
    expect(original.attributes.MFR).toBe("");
  });
});
