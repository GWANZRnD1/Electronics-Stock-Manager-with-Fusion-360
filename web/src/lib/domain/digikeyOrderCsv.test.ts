import { describe, expect, it } from "vitest";

import { parseDigikeyOrderCsv } from "./digikeyOrderCsv";

describe("parseDigikeyOrderCsv", () => {
  it("parses an order export with metadata before the header", () => {
    const csv = [
      "Sales Order,123456",
      "Order Date,2026-07-20",
      "",
      "Digi-Key Part Number,Manufacturer Part Number,Manufacturer,Description,Quantity Shipped,Unit Price",
      '311-10KJRCT-ND,RC0402JR-0710KL,Yageo,"RES 10K OHM 5% 0402",100,$0.0021',
    ].join("\n");

    expect(parseDigikeyOrderCsv(csv).items).toEqual([
      {
        mpn: "RC0402JR-0710KL",
        spn: "311-10KJRCT-ND",
        manufacturer: "Yageo",
        description: "RES 10K OHM 5% 0402",
        quantity: 100,
        unitCost: 0.0021,
      },
    ]);
  });

  it("accepts myLists quantity columns and aggregates duplicate parts", () => {
    const csv = [
      "DigiKey Part Number,Manufacturer Product Number,Manufacturer,Quantity 1",
      "1276-1009-1-ND,CL10B103KB8NNNC,Samsung,50",
      "1276-1009-1-ND,CL10B103KB8NNNC,Samsung,25",
    ].join("\n");
    const result = parseDigikeyOrderCsv(csv);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].quantity).toBe(75);
  });

  it("falls back to the DigiKey part number when an MPN column is absent", () => {
    const result = parseDigikeyOrderCsv("Part Number,Qty\n296-1234-1-ND,7");
    expect(result.items[0]).toMatchObject({
      mpn: "296-1234-1-ND",
      spn: "296-1234-1-ND",
      quantity: 7,
    });
  });

  it("rejects unrelated CSV files", () => {
    expect(() => parseDigikeyOrderCsv("name,count\nfoo,2")).toThrow(
      /part-number and quantity/i,
    );
  });
});
