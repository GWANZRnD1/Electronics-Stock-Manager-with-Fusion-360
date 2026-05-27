"use client";

import type { LibraryRow } from "@/lib/domain/libraryScr";

const IDENTITY: { key: keyof Pick<LibraryRow, "deviceset" | "variant" | "package" | "technology">; label: string }[] = [
  { key: "deviceset", label: "Deviceset" },
  { key: "variant", label: "Variant" },
  { key: "package", label: "Package" },
  { key: "technology", label: "Technology" },
];

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
 * Spreadsheet-style editor for a library export. Identity columns are read-only
 * (they pick the device); attribute columns are free-text inputs, and their
 * headers can be renamed or deleted. Cells that differ from the upload are
 * tinted so you can see exactly what the apply.scr will touch.
 */
export function LibraryGrid({ rows, columns, isChanged, onCell, onRename, onDelete }: LibraryGridProps) {
  return (
    <div className="overflow-auto rounded-xl border border-black/10 dark:border-white/15">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-black/5 text-left dark:bg-white/10">
          <tr>
            {IDENTITY.map((c) => (
              <th key={c.key} className="whitespace-nowrap px-3 py-2 font-medium">
                {c.label}
              </th>
            ))}
            {columns.map((col) => (
              <th key={col} className="whitespace-nowrap px-2 py-1.5">
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
              <th className="px-3 py-2 font-normal text-black/40 dark:text-white/40">
                No attribute columns — add one to start editing.
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={`${row.deviceset}␟${row.variant}␟${row.technology}␟${ri}`} className="border-t border-black/5 dark:border-white/10">
              <td className="whitespace-nowrap px-3 py-1.5 font-medium">{row.deviceset}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-black/60 dark:text-white/60">{row.variant || "—"}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-black/60 dark:text-white/60">{row.package || "—"}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-black/60 dark:text-white/60">{row.technology || "—"}</td>
              {columns.map((col) => (
                <td
                  key={col}
                  className={isChanged(ri, col) ? "bg-amber-400/20 dark:bg-amber-300/10" : ""}
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
