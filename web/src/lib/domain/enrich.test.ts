import { describe, expect, it } from "vitest";

import type { DistributorOffer } from "../distributors/types";
import { deriveField, deriveValue } from "./enrich";

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
});
