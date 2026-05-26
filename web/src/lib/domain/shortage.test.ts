import { describe, expect, it } from "vitest";

import {
  type BomLine,
  computeShortage,
  hasShortage,
  maxBuildable,
  shortages,
} from "./shortage";

describe("computeShortage", () => {
  it("computes shortage for each part", () => {
    const bom: BomLine[] = [
      { partKey: "R-10K", qtyPerBoard: 4, reference: "R1,R2,R3,R4" },
      { partKey: "C-100N", qtyPerBoard: 2, reference: "C1,C2" },
    ];
    const stock = { "R-10K": 10, "C-100N": 100 };

    const report = computeShortage(bom, 5, stock);

    const byKey = Object.fromEntries(report.lines.map((l) => [l.partKey, l]));
    expect(byKey["R-10K"].required).toBe(20);
    expect(byKey["R-10K"].available).toBe(10);
    expect(byKey["R-10K"].shortage).toBe(10);
    expect(byKey["C-100N"].shortage).toBe(0);
    expect(hasShortage(report)).toBe(true);
    expect(shortages(report).map((l) => l.partKey)).toEqual(["R-10K"]);
  });

  it("aggregates duplicate part keys", () => {
    const bom: BomLine[] = [
      { partKey: "C-100N", qtyPerBoard: 2 },
      { partKey: "C-100N", qtyPerBoard: 3 },
    ];

    const report = computeShortage(bom, 1, { "C-100N": 4 });

    expect(report.lines).toHaveLength(1);
    expect(report.lines[0].qtyPerBoard).toBe(5);
    expect(report.lines[0].required).toBe(5);
    expect(report.lines[0].shortage).toBe(1);
  });

  it("reports no shortage when stock is sufficient", () => {
    const report = computeShortage([{ partKey: "U1-MCU", qtyPerBoard: 1 }], 3, {
      "U1-MCU": 10,
    });

    expect(hasShortage(report)).toBe(false);
    expect(shortages(report)).toEqual([]);
  });

  it("limits max buildable by the scarcest part", () => {
    const bom: BomLine[] = [
      { partKey: "R-10K", qtyPerBoard: 4 },
      { partKey: "U1-MCU", qtyPerBoard: 1 },
    ];

    // R allows 10//4 = 2 boards, MCU allows 1 board -> min is 1
    const report = computeShortage(bom, 5, { "R-10K": 10, "U1-MCU": 1 });

    expect(maxBuildable(report)).toBe(1);
  });

  it("treats a missing part as zero stock", () => {
    const report = computeShortage([{ partKey: "X", qtyPerBoard: 1 }], 2, {});

    expect(report.lines[0].available).toBe(0);
    expect(report.lines[0].shortage).toBe(2);
  });

  it("has no shortage and zero buildable for an empty BOM", () => {
    const report = computeShortage([], 10, {});

    expect(hasShortage(report)).toBe(false);
    expect(maxBuildable(report)).toBe(0);
  });

  it("throws on a negative board count", () => {
    expect(() => computeShortage([], -1, {})).toThrow();
  });

  it("throws on a negative qty per board", () => {
    expect(() => computeShortage([{ partKey: "R", qtyPerBoard: -1 }], 1, {})).toThrow();
  });
});
