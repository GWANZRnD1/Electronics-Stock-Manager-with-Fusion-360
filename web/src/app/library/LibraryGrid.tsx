"use client";

import { useEffect, useRef, useState } from "react";

import { useAltWheelScroll } from "@/lib/useAltWheelScroll";
import type { LibraryRow } from "@/lib/domain/libraryScr";

// Identity columns pinned to the left while you scroll the attribute columns.
const FROZEN: { key: keyof Pick<LibraryRow, "deviceset" | "variant">; label: string }[] = [
  { key: "deviceset", label: "Deviceset" },
  { key: "variant", label: "Variant" },
];

// Identity columns that scroll along with the attribute columns (read-only context).
const SCROLL_IDENTITY: { key: keyof Pick<LibraryRow, "package" | "technology">; label: string }[] = [
  { key: "package", label: "Package" },
  { key: "technology", label: "Technology" },
];

const DIVIDER = "border-black/10 dark:border-white/15";
const CELL_BORDER = "border-b border-black/5 dark:border-white/10";
// border-separate (not collapse) so borders survive on sticky cells; left-aligned header bar.
const HEAD = `sticky top-0 whitespace-nowrap border-b ${DIVIDER} bg-neutral-100 text-left dark:bg-neutral-800`;
// Opaque fill so scrolling attribute cells don't bleed through the frozen columns.
const FROZEN_CELL = `sticky z-10 whitespace-nowrap bg-background px-3 py-1.5 ${CELL_BORDER}`;
const MUTED = "text-black/60 dark:text-white/60";

interface LibraryGridProps {
  rows: LibraryRow[];
  columns: string[];
  /** True when a cell's current value differs from the uploaded baseline. */
  isChanged: (rowIdx: number, column: string) => boolean;
  onCell: (rowIdx: number, column: string, value: string) => void;
  onRename: (column: string) => void;
  onDelete: (column: string) => void;
}

/**
 * Spreadsheet-style editor for a library export. The two identity columns
 * (Deviceset, Variant) and the header row stay pinned while you scroll, and
 * Alt + wheel scrolls horizontally — matching the inventory table. Identity
 * columns are read-only; attribute columns are free-text inputs whose headers
 * can be renamed or deleted. Cells that differ from the upload are tinted so
 * you can see exactly what the apply.scr will touch.
 */
export function LibraryGrid({ rows, columns, isChanged, onCell, onRename, onDelete }: LibraryGridProps) {
  const scrollRef = useAltWheelScroll<HTMLDivElement>();
  const col1Ref = useRef<HTMLTableCellElement>(null);
  const [col1Width, setCol1Width] = useState(0);

  // Pin the second frozen column flush against the first, whatever width its
  // (variable-length) device names give it.
  useEffect(() => {
    const el = col1Ref.current;
    if (!el) return;
    const measure = () => setCol1Width(Math.round(el.getBoundingClientRect().width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={scrollRef}
      className="max-h-[70vh] overflow-auto rounded-xl border border-black/10 bg-background dark:border-white/15"
    >
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th ref={col1Ref} className={`${HEAD} left-0 z-30 px-3 py-2 font-medium`}>
              {FROZEN[0].label}
            </th>
            <th
              className={`${HEAD} z-30 border-r ${DIVIDER} px-3 py-2 font-medium`}
              style={{ left: col1Width }}
            >
              {FROZEN[1].label}
            </th>
            {SCROLL_IDENTITY.map((c) => (
              <th key={c.key} className={`${HEAD} z-20 px-3 py-2 font-medium`}>
                {c.label}
              </th>
            ))}
            {columns.map((col) => (
              <th key={col} className={`${HEAD} z-20 px-2 py-1.5`}>
                <div className="flex items-center gap-1">
                  <span className="font-mono font-medium">{col}</span>
                  <button
                    type="button"
                    title={`Rename "${col}"`}
                    onClick={() => onRename(col)}
                    className="rounded px-1 text-black/40 hover:bg-black/10 hover:text-black dark:text-white/40 dark:hover:bg-white/15 dark:hover:text-white"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    title={`Delete column "${col}"`}
                    onClick={() => onDelete(col)}
                    className="rounded px-1 text-black/40 hover:bg-red-500/15 hover:text-red-600 dark:text-white/40 dark:hover:text-red-400"
                  >
                    ✕
                  </button>
                </div>
              </th>
            ))}
            {columns.length === 0 && (
              <th className={`${HEAD} z-20 px-3 py-2 font-normal text-black/40 dark:text-white/40`}>
                No attribute columns — add one to start editing.
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={`${row.deviceset}␟${row.variant}␟${row.technology}␟${ri}`}>
              <td className={`${FROZEN_CELL} left-0 font-medium`}>{row.deviceset}</td>
              <td className={`${FROZEN_CELL} border-r ${DIVIDER} ${MUTED}`} style={{ left: col1Width }}>
                {row.variant || "—"}
              </td>
              <td className={`whitespace-nowrap px-3 py-1.5 ${MUTED} ${CELL_BORDER}`}>{row.package || "—"}</td>
              <td className={`whitespace-nowrap px-3 py-1.5 ${MUTED} ${CELL_BORDER}`}>{row.technology || "—"}</td>
              {columns.map((col) => (
                <td
                  key={col}
                  className={`${CELL_BORDER} ${isChanged(ri, col) ? "bg-amber-400/20 dark:bg-amber-300/10" : ""}`}
                >
                  <input
                    value={row.attributes[col] ?? ""}
                    onChange={(e) => onCell(ri, col, e.target.value)}
                    className="w-full min-w-[8rem] bg-transparent px-2 py-1.5 outline-none focus:bg-blue-500/10"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
