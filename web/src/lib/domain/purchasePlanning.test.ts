import { describe, expect, it } from "vitest";

import type { PartCandidate } from "./jellybeanQuery";
import { chooseSupplier, recommendPurchaseQuantity } from "./purchasePlanning";

const offer = (mpn: string, unitPrice: number): PartCandidate => ({
  mpn,
  partNumber: mpn,
  manufacturer: "M",
  packageText: "0603",
  stock: 1000,
  unitPrice,
});

describe("chooseSupplier", () => {
  it("keeps the preferred supplier when savings are below the threshold", () => {
    const result = chooseSupplier(offer("DK", 1), offer("LC", 0.95), 10, {
      preferredSupplier: "digikey",
      priceDifferenceThresholdPercent: 10,
    });
    expect(result?.supplier).toBe("digikey");
    expect(result?.reason).toBe("preferred_within_threshold");
  });

  it("switches when the other supplier clears the threshold", () => {
    const result = chooseSupplier(offer("DK", 1), offer("LC", 0.7), 10, {
      preferredSupplier: "digikey",
      priceDifferenceThresholdPercent: 10,
    });
    expect(result?.supplier).toBe("lcsc");
    expect(result?.savingsPercent).toBeCloseTo(30);
  });

  it("uses the only available supplier", () => {
    expect(
      chooseSupplier(null, offer("LC", 0.7), 10, {
        preferredSupplier: "digikey",
        priceDifferenceThresholdPercent: 10,
      })?.supplier,
    ).toBe("lcsc");
  });
});

describe("recommendPurchaseQuantity", () => {
  it("keeps at least three boards worth for an expensive component", () => {
    const result = recommendPurchaseQuantity(offer("IC", 8), 1, 2);
    expect(result.quantity).toBe(6);
    expect(result.minimumQuantity).toBe(6);
  });

  it("uses a standard bulk quantity while the line remains under two dollars", () => {
    const result = recommendPurchaseQuantity(offer("R", 0.01), 2, 1);
    expect(result.quantity).toBe(100);
    expect(result.totalPrice).toBe(1);
    expect(result.reason).toBe("bulk_under_two_dollars");
  });

  it("takes a larger break when it costs no more than the minimum", () => {
    const candidate = { ...offer("C", 0.8), priceBreaks: [{ quantity: 25, unitPrice: 0.08 }] };
    const result = recommendPurchaseQuantity(candidate, 3, 1);
    expect(result.quantity).toBe(25);
    expect(result.totalPrice).toBe(2);
  });

  it("uses the configured board buffer and price-break quantities", () => {
    const result = recommendPurchaseQuantity(offer("R", 0.01), 1, 2, true, {
      minimumBoardCount: 5,
      bulkOrderQuantities: [20, 40],
      inexpensiveLineLimitUsd: 0.5,
      takeNoExtraCostBreaks: true,
    });
    expect(result.minimumQuantity).toBe(10);
    expect(result.quantity).toBe(40);
    expect(result.totalPrice).toBe(0.4);
  });

  it("can decline a no-extra-cost break when that setting is off", () => {
    const candidate = { ...offer("C", 1), priceBreaks: [{ quantity: 25, unitPrice: 0.12 }] };
    const result = recommendPurchaseQuantity(candidate, 3, 1, true, {
      minimumBoardCount: 3,
      bulkOrderQuantities: [25],
      inexpensiveLineLimitUsd: 2,
      takeNoExtraCostBreaks: false,
    });
    expect(result.quantity).toBe(3);
  });
});
