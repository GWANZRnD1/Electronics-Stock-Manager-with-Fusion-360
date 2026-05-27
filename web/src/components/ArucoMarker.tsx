"use client";

import { markerCells, type ArucoDictName } from "@/lib/aruco/marker";

/** Renders an ArUco marker as inline SVG. `size` is the on-screen pixel size. */
export function ArucoMarker({
  dict,
  id,
  size = 88,
  quiet = 1,
  title,
}: {
  dict: ArucoDictName;
  id: number;
  size?: number;
  quiet?: number;
  title?: string;
}) {
  let cells: boolean[][];
  try {
    cells = markerCells(dict, id);
  } catch {
    return (
      <div
        style={{ width: size, height: size }}
        className="grid place-items-center rounded border border-dashed border-black/20 text-[10px] text-black/40 dark:border-white/20 dark:text-white/40"
      >
        no marker
      </div>
    );
  }
  const side = cells.length;
  const total = side + quiet * 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${total} ${total}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={title ?? `ArUco ${dict} id ${id}`}
      className="rounded-sm"
    >
      <rect width={total} height={total} fill="#fff" />
      {cells.flatMap((row, r) =>
        row.map((black, c) =>
          black ? (
            <rect key={`${r}-${c}`} x={c + quiet} y={r + quiet} width={1} height={1} fill="#000" />
          ) : null,
        ),
      )}
    </svg>
  );
}
