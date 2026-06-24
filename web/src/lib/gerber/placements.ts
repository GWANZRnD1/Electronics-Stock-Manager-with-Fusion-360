/**
 * Best-effort pick-and-place / centroid parser. A Gerber zip *itself* carries no
 * component positions, but an assembly export usually includes a CPL / "pos" /
 * centroid file next to the Gerbers with designator + X/Y + rotation + side.
 * If one is present we parse it so a single zip can populate both the picture
 * and the placements. Handles the common shapes (JLCPCB CPL, KiCad .pos,
 * Altium pick-place, EAGLE mountsmd) heuristically; anything it can't read
 * cleanly just yields nothing and the user falls back to extract-placements.ulp.
 */
import { strFromU8 } from "fflate";

import type { PlacementInput } from "@/lib/repo/boards";

const NAME_HINT = /(pick|place|pos|cpl|centroid|mnt|[-_]xy)/i;
const MIL_TO_MM = 0.0254;
const INCH_TO_MM = 25.4;

/** True for files that look like a placement list rather than a Gerber/drill. */
export function looksLikePlacementFile(name: string): boolean {
  return /\.(csv|txt|pos|cpl|mnt|xy)$/i.test(name) && !/\.(gbr|ger|g[tb][lopsm]|gko|gml|drl|xln)$/i.test(name);
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function unquote(s: string): string {
  return s.trim().replace(/^"(.*)"$/, "$1").trim();
}

interface ColMap {
  des: number;
  x: number;
  y: number;
  rot: number;
  side: number;
  pkg: number;
}

function matchColumns(headers: string[]): ColMap | null {
  const n = headers.map(norm);
  const idx = (test: (h: string) => boolean) => n.findIndex(test);
  const des = idx((h) => ["designator", "refdes", "ref", "part", "name", "component", "comp"].includes(h));
  const x = idx((h) => /^(mid|pos|ref|center)?x(mm|mil|in|inch)?$/.test(h));
  const y = idx((h) => /^(mid|pos|ref|center)?y(mm|mil|in|inch)?$/.test(h));
  const rot = idx((h) => h.startsWith("rot") || h === "angle");
  const side = idx((h) => h === "side" || h === "layer");
  const pkg = idx((h) => ["footprint", "package", "pattern"].includes(h));
  if (des < 0 || x < 0 || y < 0) return null;
  return { des, x, y, rot, side, pkg };
}

function unitOf(header: string): "mm" | "mil" | "in" {
  const h = header.toLowerCase();
  if (/mil/.test(h)) return "mil";
  if (/inch|\(in\)|\bin\b/.test(h)) return "in";
  return "mm";
}

function toMm(raw: string | undefined, headerUnit: "mm" | "mil" | "in"): number {
  if (!raw) return NaN;
  let s = raw.trim();
  let unit = headerUnit;
  const m = s.match(/(mm|mil|inch|in)\s*$/i);
  if (m) {
    const u = m[1].toLowerCase();
    unit = u === "mm" ? "mm" : u === "mil" ? "mil" : "in";
    s = s.slice(0, m.index).trim();
  }
  const v = parseFloat(s.replace(/[, ]/g, "")); // strip thousands sep / stray spaces
  if (!Number.isFinite(v)) return NaN;
  return unit === "mm" ? v : unit === "mil" ? v * MIL_TO_MM : v * INCH_TO_MM;
}

function toSide(raw: string | undefined): "top" | "bottom" {
  const s = (raw ?? "").trim().toLowerCase();
  return s.startsWith("b") || s === "2" || s.includes("bot") ? "bottom" : "top";
}

function detectDelim(header: string): "," | ";" | "\t" | "ws" {
  if (header.includes(",")) return ",";
  if (header.includes(";")) return ";";
  if (header.includes("\t")) return "\t";
  return "ws";
}

function splitLine(line: string, delim: "," | ";" | "\t" | "ws"): string[] {
  const cells = delim === "ws" ? line.trim().split(/\s+/) : line.split(delim);
  return cells.map(unquote);
}

function parseText(text: string): PlacementInput[] {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/^\s*(#|;|\/\/)/.test(l));

  for (let i = 0; i < lines.length; i++) {
    const delim = detectDelim(lines[i]);
    const headers = splitLine(lines[i], delim);
    const cols = matchColumns(headers);
    if (!cols) continue;

    const xUnit = unitOf(headers[cols.x] ?? "");
    const yUnit = unitOf(headers[cols.y] ?? "");
    const out: PlacementInput[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const cells = splitLine(lines[j], delim);
      if (cells.length < headers.length - 1) continue; // not a full data row
      const designator = cells[cols.des];
      if (!designator) continue;
      const x = toMm(cells[cols.x], xUnit);
      const y = toMm(cells[cols.y], yUnit);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const rot = cols.rot >= 0 ? parseFloat((cells[cols.rot] ?? "").replace(/[^0-9.+-]/g, "")) : 0;
      out.push({
        designator,
        x,
        y,
        angle: Number.isFinite(rot) ? rot : 0,
        side: cols.side >= 0 ? toSide(cells[cols.side]) : "top",
        package: cols.pkg >= 0 ? cells[cols.pkg] : "",
        mpn: null,
      });
    }
    if (out.length) return out;
  }
  return [];
}

/** Scan the zip's files for a placement list; return [] if none is usable. */
export function parsePickAndPlace(files: Record<string, Uint8Array>): PlacementInput[] {
  const entries = Object.entries(files).filter(
    ([name, data]) => data.length > 0 && looksLikePlacementFile(name),
  );
  // Try name-hinted candidates first (…-cpl.csv, …pos.txt), then any text file.
  const ordered = [
    ...entries.filter(([n]) => NAME_HINT.test(n)),
    ...entries.filter(([n]) => !NAME_HINT.test(n)),
  ];
  for (const [, data] of ordered) {
    const rows = parseText(strFromU8(data));
    if (rows.length) return rows;
  }
  return [];
}
