/**
 * Render a Gerber set (zip) to top/bottom SVG with the board's real mm bounding
 * box, using tracespace's pcb-stackup. The bbox is in the same board-coordinate
 * space (mm) as the placements from extract-placements.ulp, so the Assembly view
 * can align highlights to the render with no manual calibration.
 *
 * gerber-to-svg negates Y (SVG is y-down, the board is y-up) and scales the
 * viewBox into integer units; we convert that viewBox back to board mm:
 *   scale = width_mm / viewBox.width
 *   minX = vx*scale,            maxX = (vx+vw)*scale
 *   maxY = -vy*scale,           minY = -(vy+vh)*scale   (Y is negated)
 */
import { strFromU8, unzipSync } from "fflate";
import pcbStackup from "pcb-stackup";

import { looksLikePlacementFile } from "./placements";

export interface MmBbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface RenderedSide {
  svg: string;
  widthPx: number;
  heightPx: number;
  mmBbox: MmBbox;
}

export interface GerberRender {
  top?: RenderedSide;
  bottom?: RenderedSide;
  layerCount: number;
}

interface StackupSide {
  svg: string;
  viewBox: number[];
  width: number;
  height: number;
  units: "in" | "mm";
}

function toSide(side: StackupSide): RenderedSide | undefined {
  const [vx, vy, vw, vh] = side.viewBox;
  if (!vw || !vh) return undefined; // this side had no renderable layers
  const widthMm = side.units === "in" ? side.width * 25.4 : side.width;
  const scale = widthMm / vw; // mm per viewBox unit (uniform x/y)
  return {
    svg: side.svg,
    widthPx: Math.round(vw),
    heightPx: Math.round(vh),
    mmBbox: {
      minX: vx * scale,
      maxX: (vx + vw) * scale,
      minY: -(vy + vh) * scale,
      maxY: -vy * scale,
    },
  };
}

/** Unzip an archive to a { name: bytes } map. Throws on an unreadable zip. */
export function unzipArchive(buf: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(buf);
  } catch {
    throw new Error("could not read the zip — upload a .zip of Gerber + drill files");
  }
}

/** Render both board sides from an unzipped file map (ignores placement files). */
export async function renderGerber(files: Record<string, Uint8Array>): Promise<GerberRender> {
  const layers = Object.entries(files)
    .filter(
      ([name, data]) =>
        !name.endsWith("/") && data.length > 0 && !looksLikePlacementFile(name) && !/\.(json|md|pdf)$/i.test(name),
    )
    .map(([name, data]) => ({
      filename: name.split("/").pop() ?? name, // whats-that-gerber keys on the basename
      gerber: strFromU8(data),
    }));

  if (layers.length === 0) throw new Error("no Gerber layers found in the zip");

  const stackup = (await pcbStackup(layers)) as unknown as {
    top: StackupSide;
    bottom: StackupSide;
  };

  return {
    top: toSide(stackup.top),
    bottom: toSide(stackup.bottom),
    layerCount: layers.length,
  };
}

/** Convenience: unzip + render in one call. */
export async function renderGerberZip(buf: Uint8Array): Promise<GerberRender> {
  return renderGerber(unzipArchive(buf));
}
