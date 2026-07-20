import { describe, expect, it } from "vitest";

import { descriptorToQuery, type PartCandidate, pickCheapestInStock } from "./jellybeanQuery";

describe("descriptorToQuery", () => {
  it("normalizes the micro sign and drops the metric parenthetical", () => {
    expect(descriptorToQuery("0.1 μF 25V X5R 0402 (1005 Metric)")).toEqual({
      keywords: "0.1 uF 25V X5R 0402",
      packageCode: "0402",
    });
  });

  it("handles the micro sign (U+00B5) and a different size", () => {
    expect(descriptorToQuery("10 µF 25V X5R 0603 (1608 Metric)")).toEqual({
      keywords: "10 uF 25V X5R 0603",
      packageCode: "0603",
    });
  });

  it("returns an empty package code when none is present", () => {
    expect(descriptorToQuery("RED LED").packageCode).toBe("");
  });
});

describe("pickCheapestInStock", () => {
  const q = { keywords: "0.1uF 0402", packageCode: "0402" };
  const cand = (over: Partial<PartCandidate>): PartCandidate => ({
    mpn: "X",
    manufacturer: "M",
    packageText: "0402 (1005 Metric)",
    stock: 1000,
    unitPrice: 0.01,
    ...over,
  });

  it("picks the cheapest in-stock, package-matched candidate", () => {
    const best = pickCheapestInStock(
      [
        cand({ mpn: "PRICEY", unitPrice: 0.05 }),
        cand({ mpn: "CHEAP", unitPrice: 0.008 }),
        cand({ mpn: "OOS", unitPrice: 0.001, stock: 0 }),
      ],
      q,
    );
    expect(best?.mpn).toBe("CHEAP");
  });

  it("ignores candidates whose package doesn't match when some do", () => {
    const best = pickCheapestInStock(
      [
        cand({ mpn: "WRONGPKG", unitPrice: 0.001, packageText: "0603 (1608 Metric)" }),
        cand({ mpn: "RIGHTPKG", unitPrice: 0.02 }),
      ],
      q,
    );
    expect(best?.mpn).toBe("RIGHTPKG");
  });

  it("returns null when nothing is in stock", () => {
    expect(pickCheapestInStock([cand({ stock: 0 })], q)).toBeNull();
  });

  it("does not substitute a known, different package", () => {
    const best = pickCheapestInStock(
      [cand({ mpn: "ONLY", packageText: "nonstandard", unitPrice: 0.03 })],
      q,
    );
    expect(best).toBeNull();
  });

  it("uses the price break available at the required quantity", () => {
    const best = pickCheapestInStock(
      [
        cand({
          mpn: "CHEAP-ONLY-AT-1000",
          priceBreaks: [
            { quantity: 1, unitPrice: 0.2 },
            { quantity: 1000, unitPrice: 0.001 },
          ],
        }),
        cand({
          mpn: "ACTUALLY-CHEAP",
          priceBreaks: [{ quantity: 1, unitPrice: 0.05 }],
        }),
      ],
      q,
      10,
    );
    expect(best?.mpn).toBe("ACTUALLY-CHEAP");
  });
});
