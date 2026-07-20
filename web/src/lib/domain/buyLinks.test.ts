import { describe, expect, it } from "vitest";

import {
  buyBucket,
  digikeyMylistsPayload,
  digikeySearchUrl,
  formatDigikeyBulkAdd,
  isJellybeanDescriptor,
  lcscProductUrl,
  lcscSearchUrl,
  mouserProductUrl,
} from "./buyLinks";

describe("buy links", () => {
  it("encodes the DigiKey (NZ) search query", () => {
    expect(digikeySearchUrl("MCP2221A-I/SL")).toBe(
      "https://www.digikey.co.nz/en/products/result?keywords=MCP2221A-I%2FSL",
    );
  });

  it("encodes a slash in the Mouser product URL", () => {
    expect(mouserProductUrl("MCP2221A-I/SL")).toBe(
      "https://www.mouser.com/ProductDetail/MCP2221A-I%2FSL",
    );
  });

  it("builds the LCSC product URL from a C-number", () => {
    expect(lcscProductUrl("C312270")).toBe("https://www.lcsc.com/product-detail/C312270.html");
  });

  it("turns spaces into + in the LCSC search query", () => {
    expect(lcscSearchUrl("STM32 F103")).toBe("https://www.lcsc.com/search?q=STM32+F103");
  });

  it("shapes each MyLists item", () => {
    expect(
      digikeyMylistsPayload([
        ["296-1234-ND", 5],
        ["311-10KND", 20],
      ]),
    ).toEqual([
      { requestedPartNumber: "296-1234-ND", quantities: [{ quantity: 5 }] },
      { requestedPartNumber: "311-10KND", quantities: [{ quantity: 20 }] },
    ]);
  });

  it("skips empty or non-positive MyLists entries", () => {
    expect(
      digikeyMylistsPayload([
        ["", 5],
        ["296-1234-ND", 0],
        ["311-10KND", -3],
        ["VALID-ND", 2],
      ]),
    ).toEqual([{ requestedPartNumber: "VALID-ND", quantities: [{ quantity: 2 }] }]);
  });
});

describe("formatDigikeyBulkAdd", () => {
  it("uses quantity, part, blank-reference order", () => {
    expect(
      formatDigikeyBulkAdd([
        { partNumber: " 296-1234-1-ND ", quantity: 7 },
        { partNumber: "ABC", quantity: 2.9 },
      ]),
    ).toBe("7,296-1234-1-ND,\n2,ABC,");
  });

  it("skips invalid lines", () => {
    expect(
      formatDigikeyBulkAdd([
        { partNumber: "", quantity: 4 },
        { partNumber: "ABC", quantity: 0 },
      ]),
    ).toBe("");
  });
});

describe("buyBucket", () => {
  it("routes digikey and jellybean to DigiKey", () => {
    expect(buyBucket("DigiKey")).toBe("digikey");
    expect(buyBucket("jellybean")).toBe("digikey");
  });

  it("routes mouser and lcsc to their own buckets", () => {
    expect(buyBucket("Mouser")).toBe("mouser");
    expect(buyBucket("LCSC")).toBe("lcsc");
  });

  it("routes unknown, empty, or other suppliers to Others", () => {
    expect(buyBucket("")).toBe("others");
    expect(buyBucket(null)).toBe("others");
    expect(buyBucket(undefined)).toBe("others");
    expect(buyBucket("Arrow")).toBe("others");
  });
});

describe("isJellybeanDescriptor", () => {
  it("recognizes capacitors, LEDs, resistors, and inductors", () => {
    expect(isJellybeanDescriptor("0.1 μF 25V X5R 0402 (1005 Metric)")).toBe(true); // Greek mu
    expect(isJellybeanDescriptor("0.1 µF 50V X7R 0603 (1608 Metric)")).toBe(true); // micro sign
    expect(isJellybeanDescriptor("10 μF 25V X5R 0603 (1608 Metric)")).toBe(true);
    expect(isJellybeanDescriptor("RED LED 0603(1608METRIC)")).toBe(true);
    expect(isJellybeanDescriptor("10k 1% 0402")).toBe(true);
    expect(isJellybeanDescriptor("4k7 0603")).toBe(true);
    expect(isJellybeanDescriptor("100 Ω 0805")).toBe(true);
    expect(isJellybeanDescriptor("10 µH 1A")).toBe(true);
  });

  it("does not flag connectors, debug headers, or synthetic keys", () => {
    expect(isJellybeanDescriptor("PINHD-1X1|1X01")).toBe(false);
    expect(isJellybeanDescriptor("TAG-CONNECT_TC2030-IDC-NL")).toBe(false);
    expect(isJellybeanDescriptor("line-451")).toBe(false);
    expect(isJellybeanDescriptor("MCP2221A-I/SL SOIC-14")).toBe(false);
  });
});
