/**
 * Pure ArUco marker geometry. The dictionary byte data is vendored from OpenCV
 * (see dictionaries.ts); here we turn a (dictionary, id) into the black/white
 * module grid and into printable SVG. No rendering dependency, works server- and
 * client-side. Convention (matching OpenCV generateImageMarker): the marker has a
 * 1-module black border; inside, a data bit of 1 is white and 0 is black.
 */
import { ARUCO_DICTS, type ArucoDictName } from "./dictionaries";

export type { ArucoDictName };
export const ARUCO_DICT_NAMES = Object.keys(ARUCO_DICTS) as ArucoDictName[];

/** Number of distinct marker ids a dictionary holds (ids run 0..capacity-1). */
export function dictCapacity(dict: ArucoDictName): number {
  return ARUCO_DICTS[dict].markers.length;
}

/** Decode rotation-0 bytes into grid*grid bits, MSB-first row-major (OpenCV getBitsFromByteList). */
export function bitsFromBytes(bytes: number[], grid: number): number[] {
  const n = grid * grid;
  const bits: number[] = new Array(n);
  for (let i = 0; i < n; i++) bits[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
  return bits;
}

/**
 * Full marker as a (grid+2) x (grid+2) matrix; true = black module. The outer
 * ring is the mandatory black border; inside, bit 0 is black and bit 1 is white.
 */
export function markerCells(dict: ArucoDictName, id: number): boolean[][] {
  const d = ARUCO_DICTS[dict];
  if (!Number.isInteger(id) || id < 0 || id >= d.markers.length) {
    throw new Error(`ArUco id ${id} out of range for ${dict} (0–${d.markers.length - 1})`);
  }
  const bits = bitsFromBytes(d.markers[id], d.grid);
  const side = d.grid + 2;
  const cells: boolean[][] = [];
  for (let r = 0; r < side; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < side; c++) {
      const isBorder = r === 0 || c === 0 || r === side - 1 || c === side - 1;
      row.push(isBorder ? true : bits[(r - 1) * d.grid + (c - 1)] === 0);
    }
    cells.push(row);
  }
  return cells;
}

/**
 * Standalone SVG for printing/downloading. `sizeMm` sets the physical size (the
 * black square only; the quiet zone is extra). `quiet` is the white margin in
 * modules around the marker (≥1 recommended so detectors find the border).
 */
export function arucoSvg(
  dict: ArucoDictName,
  id: number,
  opts: { sizeMm?: number; quiet?: number } = {},
): string {
  const cells = markerCells(dict, id);
  const side = cells.length;
  const quiet = opts.quiet ?? 1;
  const total = side + quiet * 2;
  const rects: string[] = [];
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) {
      if (cells[r][c]) rects.push(`<rect x="${c + quiet}" y="${r + quiet}" width="1" height="1"/>`);
    }
  }
  // Physical size targets the marker square; the quiet zone scales with it.
  const dim = opts.sizeMm ? (opts.sizeMm * total) / side : total;
  const unit = opts.sizeMm ? "mm" : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}${unit}" height="${dim}${unit}" ` +
    `viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="#fff"/>` +
    `<g fill="#000">${rects.join("")}</g></svg>`
  );
}
