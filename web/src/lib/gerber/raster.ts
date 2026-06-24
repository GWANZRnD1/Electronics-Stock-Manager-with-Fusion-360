/**
 * Rasterize a pcb-stackup SVG render to a compact WebP. The vector SVG of a
 * dense board can be ~1 MB and is expensive for the browser to re-rasterize
 * while panning/zooming (it can even crash the tab); a WebP at a fixed
 * resolution is a fraction of the size and cheap to display.
 *
 * We rasterize with resvg (not sharp/librsvg): pcb-stackup nests layer groups
 * deeper than librsvg's 50-level limit, so sharp's SVG loader throws on these.
 * resvg renders to PNG, then sharp encodes the WebP.
 */
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

import type { MmBbox } from "./render";

const TARGET_LONG_PX = 1800; // long edge of the output raster
const WEBP_QUALITY = 80;

export interface Raster {
  buf: Buffer;
  width: number;
  height: number;
}

/** Render the SVG to WebP, capping the long edge so detail is board-appropriate. */
export async function svgToWebp(svg: string, bbox: MmBbox): Promise<Raster> {
  const wmm = Math.max(bbox.maxX - bbox.minX, 0.001);
  const hmm = Math.max(bbox.maxY - bbox.minY, 0.001);
  const fitTo =
    wmm >= hmm
      ? { mode: "width" as const, value: TARGET_LONG_PX }
      : { mode: "height" as const, value: TARGET_LONG_PX };

  const png = new Resvg(svg, { fitTo }).render().asPng();
  const buf = await sharp(png).webp({ quality: WEBP_QUALITY }).toBuffer();
  const meta = await sharp(buf).metadata();
  return { buf, width: meta.width ?? 0, height: meta.height ?? 0 };
}
