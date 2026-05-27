import { describe, expect, it } from "vitest";

import {
  extractValue,
  inferSupplier,
  normalizeRow,
  parseConfirmedDate,
  parseMoney,
  parseQuantity,
} from "./inventoryCsv";

describe("parseMoney", () => {
  it("handles the spreadsheet's currency variants", () => {
    expect(parseMoney(" $1.78 ")).toBe(1.78);
    expect(parseMoney("$0.06")).toBe(0.06);
    expect(parseMoney(" .39 ")).toBe(0.39);
    expect(parseMoney("0.0164")).toBe(0.0164);
    expect(parseMoney(" $-   ")).toBeNull();
    expect(parseMoney("")).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
  });
});

describe("parseConfirmedDate", () => {
  it("parses day-first dates with 2- or 4-digit years", () => {
    expect(parseConfirmedDate("23/10/2024")?.toISOString()).toBe("2024-10-23T00:00:00.000Z");
    expect(parseConfirmedDate("19/5/23")?.toISOString()).toBe("2023-05-19T00:00:00.000Z");
  });
  it("rejects blanks and garbage", () => {
    expect(parseConfirmedDate("")).toBeNull();
    expect(parseConfirmedDate("18/10/20123")).toBeNull(); // 5-digit-year typo in the data
    expect(parseConfirmedDate("32/1/2024")).toBeNull();
    expect(parseConfirmedDate("1/13/2024")).toBeNull();
  });
});

describe("parseQuantity", () => {
  it("tolerates trailing spaces and blanks", () => {
    expect(parseQuantity("100 ")).toBe(100);
    expect(parseQuantity("")).toBe(0);
    expect(parseQuantity(undefined)).toBe(0);
  });
});

describe("inferSupplier", () => {
  it("classifies by part-number shape", () => {
    expect(inferSupplier("900-2181120400-ND", "Molex")).toBe("DigiKey");
    expect(inferSupplier("MCP3021A0T-E/OTCT-ND", "Microchip")).toBe("DigiKey");
    expect(inferSupplier("C3178291 (LCSC)", "STMicroelectronics")).toBe("LCSC");
    expect(inferSupplier("C18124 LCSC", "MDD")).toBe("LCSC");
    expect(inferSupplier("0.1 µF 16V X7R 0603", "Jellybean")).toBe("Jellybean");
    expect(inferSupplier("", "")).toBe("");
  });
});

describe("extractValue", () => {
  it("pulls a leading value from R/L/C/crystal descriptions", () => {
    expect(extractValue("10 kOhms ±1% 0.063W, 1/16W Chip Resistor 0402")).toBe("10kΩ");
    expect(extractValue("1 MOhms ±1% 0.063W Chip Resistor")).toBe("1MΩ");
    expect(extractValue("0 Ohms Jumper Chip Resistor 0402")).toBe("0Ω");
    expect(extractValue("0.015 µF ±10% 50V Ceramic Capacitor X7R 0603")).toBe("0.015µF");
    expect(extractValue("100 pF ±5% 50V Ceramic Capacitor C0G, NP0 0402")).toBe("100pF");
    expect(extractValue("1.1 nH Unshielded Multilayer Inductor")).toBe("1.1nH");
    expect(extractValue("16 MHz ±30ppm Crystal 10pF")).toBe("16MHz");
  });
  it("returns blank when there is no leading value (ICs/connectors)", () => {
    expect(extractValue("4 Position Cable Assembly Rectangular Socket")).toBe("");
    expect(extractValue("12 Bit Analog to Digital Converter")).toBe("");
    expect(extractValue("")).toBe("");
  });
});

describe("normalizeRow", () => {
  it("maps a real row end to end", () => {
    const n = normalizeRow({
      Category: "Resistors",
      "Digikey Part Number": "311-10.0KLRCT-ND",
      Manufacturer: "YAGEO",
      MPN: "RC0402FR-0710KL",
      Description: "10 kOhms ±1% 0.063W, 1/16W Chip Resistor 0402 (1005 Metric)",
      "Quantity Here": "100",
      Location1: "Controller1 DC r03",
      "Last confirmed": "26/06/2024",
      Value: " $0.01 ",
    });
    expect(n).toMatchObject({
      category: "Resistors",
      supplier: "DigiKey",
      spn: "311-10.0KLRCT-ND",
      manufacturer: "YAGEO",
      mpn: "RC0402FR-0710KL",
      value: "10kΩ",
      unitCost: 0.01,
      quantity: 100,
      location: "Controller1 DC r03",
    });
    expect(n.lastConfirmedAt?.toISOString()).toBe("2024-06-26T00:00:00.000Z");
  });
});
