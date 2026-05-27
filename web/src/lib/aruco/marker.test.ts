import { describe, expect, it } from "vitest";

import { ARUCO_DICTS } from "./dictionaries";
import { arucoSvg, bitsFromBytes, dictCapacity, markerCells } from "./marker";

describe("aruco marker", () => {
  it("decodes 4X4_50 id 0 to the OpenCV-canonical bit grid", () => {
    // marker 0 rotation-0 bytes are [181, 50] in OpenCV's predefined_dictionaries.hpp
    expect(ARUCO_DICTS["4X4_50"].markers[0]).toEqual([181, 50]);
    // 0xB5 0x32 = 1011 0101 0011 0010, row-major over the 4x4 data grid (1 = white)
    expect(bitsFromBytes([181, 50], 4)).toEqual([1, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
  });

  it("wraps the data grid in a black border (true = black)", () => {
    const cells = markerCells("4X4_50", 0);
    expect(cells.length).toBe(6); // 4 data + 2 border
    expect(cells[0].every((b) => b)).toBe(true); // top border all black
    expect(cells.at(-1)!.every((b) => b)).toBe(true); // bottom border all black
    expect(cells.map((r) => r[0]).every((b) => b)).toBe(true); // left border
    // interior top-left bit is 1 (white) -> not black
    expect(cells[1][1]).toBe(false);
  });

  it("exposes the expected dictionary capacities", () => {
    expect(dictCapacity("4X4_50")).toBe(50);
    expect(dictCapacity("5X5_100")).toBe(100);
    expect(dictCapacity("6X6_250")).toBe(250);
  });

  it("rejects out-of-range ids", () => {
    expect(() => markerCells("4X4_50", 50)).toThrow();
    expect(() => markerCells("4X4_50", -1)).toThrow();
  });

  it("renders printable SVG sized in mm with a quiet zone", () => {
    const svg = arucoSvg("4X4_50", 0, { sizeMm: 25, quiet: 1 });
    expect(svg).toContain("<svg");
    expect(svg).toContain('viewBox="0 0 8 8"'); // 6 marker + 2 quiet modules
    expect(svg).toContain("mm"); // physical units present
    expect(svg.startsWith("<svg") && svg.endsWith("</svg>")).toBe(true);
  });
});
