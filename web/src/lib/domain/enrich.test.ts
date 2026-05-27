import { describe, expect, it } from "vitest";

import type { DistributorOffer } from "../distributors/types";
import { deriveField, deriveValue, unitCostFromOffer } from "./enrich";

function offer(o: Partial<DistributorOffer>): DistributorOffer {
  return {
    distributor: "digikey",
    mpn: "X",
    manufacturer: "",
    description: "",
    category: "",
    package: "",
    distributorPartNumber: "",
    stock: 0,
    priceBreaks: [],
    productUrl: "",
    datasheetUrl: null,
    mock: false,
    ...o,
  };
}

describe("deriveValue", () => {
  it("prefers a distributor parametric value, canonicalized", () => {
    expect(deriveValue([offer({ value: "10 kOhms" })], "")).toBe("10kΩ");
    expect(deriveValue([offer({ value: "0.1 µF" })], "")).toBe("0.1µF");
  });

  it("ignores mock offers", () => {
    const offers = [offer({ mock: true, value: "10 kOhms" }), offer({ description: "0.1 µF ±10% 50V" })];
    expect(deriveValue(offers, "")).toBe("0.1µF");
  });

  it("extracts from a live description when no parametric value", () => {
    expect(deriveValue([offer({ description: "16 MHz ±30ppm Crystal" })], "")).toBe("16MHz");
  });

  it("falls back to the part's own description", () => {
    expect(deriveValue([offer({ mock: true })], "47 Ohms ±1% 0402")).toBe("47Ω");
  });

  it("returns blank when nothing is derivable (e.g. an IC)", () => {
    expect(deriveValue([offer({ description: "8-SOIC Microcontroller" })], "12 Bit ADC")).toBe("");
  });
});

describe("deriveField", () => {
  it("returns the first live non-empty value and ignores mock", () => {
    const offers = [offer({ mock: true, category: "X" }), offer({ category: "Capacitors" })];
    expect(deriveField(offers, "category")).toBe("Capacitors");
    expect(deriveField([offer({ package: "0402" })], "package")).toBe("0402");
    expect(deriveField([offer({})], "category")).toBe("");
  });

  it("backfills manufacturer and description from live offers", () => {
    expect(deriveField([offer({ manufacturer: "Yageo" })], "manufacturer")).toBe("Yageo");
    expect(deriveField([offer({ description: "RES 10K 0402" })], "description")).toBe("RES 10K 0402");
    expect(deriveField([offer({ mock: true, manufacturer: "Yageo" })], "manufacturer")).toBe("");
  });
});

describe("unitCostFromOffer", () => {
  const pb = (quantity: number, unitPrice: number, currency = "USD") => ({ quantity, unitPrice, currency });

  it("takes the unit price at the smallest break quantity", () => {
    expect(unitCostFromOffer(offer({ priceBreaks: [pb(10, 0.05), pb(1, 0.1), pb(100, 0.03)] }))).toBe(0.1);
  });

  it("ignores non-USD breaks", () => {
    expect(unitCostFromOffer(offer({ priceBreaks: [pb(1, 0.2, "NZD")] }))).toBeNull();
    expect(unitCostFromOffer(offer({ priceBreaks: [pb(1, 0.2, "NZD"), pb(5, 0.15, "USD")] }))).toBe(0.15);
  });

  it("returns null when there are no usable price breaks", () => {
    expect(unitCostFromOffer(offer({ priceBreaks: [] }))).toBeNull();
    expect(unitCostFromOffer(offer({ priceBreaks: [pb(1, 0)] }))).toBeNull();
  });
});
