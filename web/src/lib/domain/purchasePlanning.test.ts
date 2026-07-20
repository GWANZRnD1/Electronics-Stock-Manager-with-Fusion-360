import { describe, expect, it } from "vitest";

import type { PartCandidate } from "./jellybeanQuery";
import { chooseSupplier } from "./purchasePlanning";

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
