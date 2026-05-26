import { describe, expect, it } from "vitest";

import {
  digikeyMylistsPayload,
  digikeySearchUrl,
  lcscProductUrl,
  lcscSearchUrl,
  mouserProductUrl,
} from "./buyLinks";

describe("buy links", () => {
  it("encodes the DigiKey search query", () => {
    expect(digikeySearchUrl("MCP2221A-I/SL")).toBe(
      "https://www.digikey.com/en/products/result?keywords=MCP2221A-I%2FSL",
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
