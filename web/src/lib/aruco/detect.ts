/**
 * In-browser ArUco detection for location markers, via js-aruco2. The detector
 * dictionary is built from the SAME bits marker.ts renders: each marker's
 * grid*grid data bits are packed MSB-first row-major into one integer, which
 * js-aruco2 decodes with toString(2).padStart(nBits) — so what we generate and
 * what we detect share one bit convention (no byte-packing ambiguity), and a
 * detected marker's id equals the location's assigned ArUco id.
 */
import type { ArDetector } from "js-aruco2";

import { ARUCO_DICTS, type ArucoDictName } from "./dictionaries";
import { bitsFromBytes } from "./marker";

/** Integer code (grid*grid bits, MSB-first row-major) for each marker in the dict. */
export function arucoCodeList(dict: ArucoDictName): number[] {
  const d = ARUCO_DICTS[dict];
  return d.markers.map((bytes) => bitsFromBytes(bytes, d.grid).reduce((acc, b) => acc * 2 + b, 0));
}

/** js-aruco2 dictionary definition for our location markers (codeList index = aruco id). */
export function arucoDictDef(dict: ArucoDictName): {
  nBits: number;
  tau: number | null;
  codeList: number[];
} {
  const d = ARUCO_DICTS[dict];
  return { nBits: d.grid * d.grid, tau: null, codeList: arucoCodeList(dict) };
}

// js-aruco2 is a CommonJS/global-style lib; load it lazily so it only runs in the browser.
let arPromise: Promise<typeof import("js-aruco2").AR> | null = null;
async function loadAR() {
  if (!arPromise) {
    arPromise = import("js-aruco2").then((m) => {
      const mod = m as unknown as { AR?: typeof import("js-aruco2").AR; default?: { AR?: typeof import("js-aruco2").AR } };
      const AR = mod.AR ?? mod.default?.AR;
      if (!AR) throw new Error("js-aruco2: AR export not found");
      return AR;
    });
  }
  return arPromise;
}

const detectorCache = new Map<ArucoDictName, ArDetector>();

async function getDetector(dict: ArucoDictName): Promise<ArDetector> {
  const cached = detectorCache.get(dict);
  if (cached) return cached;
  const AR = await loadAR();
  const name = `LOC_${dict}`;
  AR.DICTIONARIES[name] = arucoDictDef(dict);
  const detector = new AR.Detector({ dictionaryName: name });
  detectorCache.set(dict, detector);
  return detector;
}

/** Detect the first location ArUco marker in a frame; returns its id, or null. */
export async function detectArucoId(image: ImageData, dict: ArucoDictName): Promise<number | null> {
  const detector = await getDetector(dict);
  const markers = detector.detect(image);
  return markers.length > 0 ? markers[0].id : null;
}
