import { describe, expect, it } from "vitest";

import { viewBoxToMmBbox } from "./render";

describe("Gerber render bounds", () => {
  it("preserves an asymmetric Y range from the plotter viewBox", () => {
    expect(viewBoxToMmBbox([-50_000, -25_000, 100_000, 75_000], 100, "mm")).toEqual({
      minX: -50,
      minY: -25,
      maxX: 50,
      maxY: 50,
    });
  });

  it("converts inch dimensions to millimetres without reflecting Y", () => {
    expect(viewBoxToMmBbox([0, 1_000, 2_000, 3_000], 2, "in")).toEqual({
      minX: 0,
      minY: 25.4,
      maxX: 50.8,
      maxY: 101.6,
    });
  });
});
