import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { ARUCO_DICTS, type ArucoDictName } from "./dictionaries";
import { arucoDictDef } from "./detect";
import { bitsFromBytes } from "./marker";

// js-aruco2 is CommonJS; require it directly in the Node test environment.
const require = createRequire(import.meta.url);
const { AR } = require("js-aruco2") as typeof import("js-aruco2");

/**
 * Proves the detector dictionary and the generator share one bit convention:
 * every marker we render, fed through js-aruco2's Dictionary.find() in its
 * canonical orientation, resolves back to its own id with zero Hamming distance.
 * If this holds, a clean camera read of our printed marker yields the right id.
 */
describe("aruco detect dictionary", () => {
  for (const name of ["4X4_50", "5X5_100", "6X6_250"] as ArucoDictName[]) {
    it(`${name}: every generated marker round-trips to its id (distance 0)`, () => {
      AR.DICTIONARIES[`T_${name}`] = arucoDictDef(name);
      const dict = new AR.Dictionary(`T_${name}`);
      const d = ARUCO_DICTS[name];
      for (let id = 0; id < d.markers.length; id++) {
        const bits = bitsFromBytes(d.markers[id], d.grid);
        const grid: string[] = [];
        for (let r = 0; r < d.grid; r++) {
          grid.push(bits.slice(r * d.grid, r * d.grid + d.grid).join(""));
        }
        const found = dict.find(grid);
        expect(found, `marker ${id} should be found`).toBeTruthy();
        expect(found!.id, `marker ${id} id`).toBe(id);
        expect(found!.distance, `marker ${id} distance`).toBe(0);
      }
    });
  }
});
