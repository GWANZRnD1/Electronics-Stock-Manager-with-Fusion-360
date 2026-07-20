import { describe, expect, it } from "vitest";

import {
  componentIdentity,
  evaluateJellybeanCompatibility,
  jellybeanCompatibilityScore,
  normalizePartIdentifier,
  packageCode,
} from "./jellybeanMatch";

describe("jellybean electrical identity", () => {
  it("normalizes micro/ohm spelling differences", () => {
    expect(normalizePartIdentifier("0.1 uF 50V X7R 0603 (1608 Metric)")).toBe(
      normalizePartIdentifier("0.1 µF 50V X7R 0603 (1608 Metric)"),
    );
    expect(normalizePartIdentifier("10 kOhms")).toBe(normalizePartIdentifier("10kΩ"));
  });

  it("maps Fusion and metric footprint names to imperial sizes", () => {
    expect(packageCode("CAPC1608X85")).toBe("0603");
    expect(packageCode("RESC2012X65")).toBe("0805");
    expect(packageCode("0402 (1005 Metric)")).toBe("0402");
    expect(packageCode("RES_0603_(1608-METRIC)")).toBe("0603");
  });

  it("matches a bare 22k Fusion BOM row to stocked 22 kOhm jellybeans", () => {
    const wanted = componentIdentity({
      value: "22k",
      package: "RES_0603_(1608-METRIC)",
      designators: "R15",
    });
    const stocked = componentIdentity({
      mpn: "22 kOhm 0603 (1608 Metric)",
      value: "22kΩ",
      category: "Resistors",
      description: "22 kOhms ±5% 0.1W Chip Resistor 0603 (1608 Metric)",
    });

    expect(wanted.valueKey).toBe(stocked.valueKey);
    expect(jellybeanCompatibilityScore(wanted, stocked)).not.toBeNull();
  });

  it("matches uF and µF descriptors while enforcing package and voltage", () => {
    const wanted = componentIdentity({
      mpn: "0.1 uF 50V X7R 0603 (1608 Metric)",
      designators: "C1,C8",
    });
    const good = componentIdentity({
      mpn: "0.1 µF 50V X7R 0603 (1608 Metric)",
      category: "Capacitors",
    });
    const tooLow = componentIdentity({
      mpn: "0.1 µF 16V X7R 0603 (1608 Metric)",
      category: "Capacitors",
    });
    const wrongSize = componentIdentity({
      mpn: "0.1 µF 50V X7R 0402 (1005 Metric)",
      category: "Capacitors",
    });

    expect(jellybeanCompatibilityScore(wanted, good)).not.toBeNull();
    expect(jellybeanCompatibilityScore(wanted, tooLow)).toBeNull();
    expect(jellybeanCompatibilityScore(wanted, wrongSize)).toBeNull();
  });

  it("does not treat a varistor on an R designator as a chip resistor", () => {
    const mov = componentIdentity({
      value: "560V 2.5KA Varistor",
      package: "MOV-10D561K",
      designators: "R1",
    });
    expect(mov.kind).toBeNull();
  });

  it("reads fractional resistor power without turning 1/10W into 10W", () => {
    const identity = componentIdentity({
      value: "100K OHM 5% 1/10W",
      package: "RESC1608X60",
      designators: "R12",
    });
    expect(identity.tolerance).toBe(5);
    expect(identity.powerWatts).toBe(0.1);
  });

  it("accepts a rated resistor when the jellybean only specifies resistance", () => {
    const wanted = componentIdentity({
      value: "10k Ohm",
      package: "RESC1608X60",
      designators: "R1",
    });
    const stocked = componentIdentity({
      value: "10k Ohm 1/8W",
      package: "0603 (1608 Metric)",
      category: "Resistors",
    });

    const result = evaluateJellybeanCompatibility(wanted, stocked);
    expect(result).not.toBeNull();
    expect(result?.notes.some((note) => note.includes("Power rating"))).toBe(false);
  });

  it("prefers a higher capacitor voltage and treats dielectric as a reminder", () => {
    const wanted = componentIdentity({
      value: "1uF 16V X5R",
      package: "CAPC1608X85",
      designators: "C1",
    });
    const stocked = componentIdentity({
      value: "1uF 25V X7R",
      package: "0603 (1608 Metric)",
      category: "Capacitors",
    });

    const result = evaluateJellybeanCompatibility(wanted, stocked);
    expect(result).not.toBeNull();
    expect(result?.notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("higher rating is acceptable"),
        expect.stringContaining("Dielectric is X7R rather than X5R"),
      ]),
    );
  });

  it("still rejects a capacitor whose recorded voltage is below the BOM minimum", () => {
    const wanted = componentIdentity({
      value: "1uF 25V",
      package: "CAPC1608X85",
      designators: "C1",
    });
    const stocked = componentIdentity({
      value: "1uF 16V",
      package: "0603 (1608 Metric)",
      category: "Capacitors",
    });

    expect(evaluateJellybeanCompatibility(wanted, stocked)).toBeNull();
  });

  it("allows lower resistor power as a visible fallback reminder", () => {
    const wanted = componentIdentity({
      value: "10k Ohm 1/4W",
      package: "RESC1608X60",
      designators: "R1",
    });
    const stocked = componentIdentity({
      value: "10k Ohm 1/8W",
      package: "0603 (1608 Metric)",
      category: "Resistors",
    });

    const result = evaluateJellybeanCompatibility(wanted, stocked);
    expect(result).not.toBeNull();
    expect(result?.notes).toContain(
      "Power rating is 0.125 W rather than 0.25 W; confirm dissipation is acceptable.",
    );
  });
});
