import { describe, expect, it } from "vitest";

import { bundleCategories, categoryKey, pickCategoryLabel } from "./categories";

describe("categoryKey", () => {
  it("ignores case and surrounding whitespace", () => {
    expect(categoryKey("  Resistor ")).toBe("resistor");
    expect(categoryKey("RESISTOR")).toBe("resistor");
  });

  it("bundles singular and plural", () => {
    expect(categoryKey("Resistors")).toBe(categoryKey("Resistor"));
    expect(categoryKey("Capacitors")).toBe("capacitor");
    expect(categoryKey("Diodes")).toBe("diode");
    expect(categoryKey("ICs")).toBe(categoryKey("IC"));
    expect(categoryKey("Batteries")).toBe("battery");
  });

  it("does not strip a doubled-s ending", () => {
    expect(categoryKey("Glass")).toBe("glass");
  });

  it("collapses internal whitespace", () => {
    expect(categoryKey("Voltage   Regulators")).toBe("voltage regulator");
  });

  it("folds verbose distributor names into the leading category", () => {
    expect(categoryKey("Connectors, Interconnects")).toBe(categoryKey("Connectors"));
    expect(categoryKey("Crystals, Oscillators, Resonators")).toBe(categoryKey("Crystals"));
    expect(categoryKey("RF and Wireless")).toBe(categoryKey("RF"));
  });

  it("keeps a distinct leading segment separate", () => {
    // "Capacitor Networks, Arrays" is its own thing, not plain "Capacitors".
    expect(categoryKey("Capacitor Networks, Arrays")).toBe("capacitor network");
    expect(categoryKey("Capacitor Networks, Arrays")).not.toBe(categoryKey("Capacitors"));
  });

  it("splits on slash, ampersand, and parentheses", () => {
    expect(categoryKey("Diodes / Rectifiers")).toBe("diode");
    expect(categoryKey("Resistors & Networks")).toBe("resistor");
    expect(categoryKey("Integrated Circuits (ICs)")).toBe("integrated circuit");
  });
});

describe("pickCategoryLabel", () => {
  it("prefers the most common spelling", () => {
    expect(
      pickCategoryLabel([
        { label: "Resistors", count: 2 },
        { label: "Resistor", count: 9 },
      ]),
    ).toBe("Resistor");
  });

  it("breaks ties toward the shorter spelling", () => {
    expect(
      pickCategoryLabel([
        { label: "Resistors", count: 3 },
        { label: "Resistor", count: 3 },
      ]),
    ).toBe("Resistor");
  });
});

describe("bundleCategories", () => {
  it("collapses variants into one representative label and sorts them", () => {
    const { byKey, labels } = bundleCategories([
      { label: "Resistor", count: 5 },
      { label: "Resistors", count: 1 },
      { label: "Capacitor", count: 3 },
      { label: "led", count: 1 },
      { label: "LED", count: 4 },
      { label: "  ", count: 9 },
    ]);
    expect(labels).toEqual(["Capacitor", "LED", "Resistor"]);
    expect(byKey.get(categoryKey("Resistors"))).toBe("Resistor");
    expect(byKey.get(categoryKey("led"))).toBe("LED");
  });

  it("bundles a verbose distributor variant under the short label", () => {
    const { byKey, labels } = bundleCategories([
      { label: "Connectors", count: 5 },
      { label: "Connectors, Interconnects", count: 2 },
    ]);
    expect(labels).toEqual(["Connectors"]);
    expect(byKey.get(categoryKey("Connectors, Interconnects"))).toBe("Connectors");
  });
});
