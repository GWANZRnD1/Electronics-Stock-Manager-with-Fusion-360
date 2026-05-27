"use client";

import { useMemo, useState } from "react";

import { Nav } from "@/components/Nav";
import { jpost } from "@/lib/client";
import { buildApplyScr, type LibraryRow } from "@/lib/domain/libraryScr";

import { LibraryGrid } from "./LibraryGrid";

interface NewPart {
  mpn: string;
  manufacturer: string;
  description: string;
  category: string;
  value: string;
  package: string;
  supplier: string;
  spn: string;
}

interface EnrichResult {
  enrichedRows: LibraryRow[];
  summary: { rows: number; enrichedRows: number; filledCells: number; apiCalls: number; dbParts: number };
  newParts: NewPart[];
}

const keyOf = (r: LibraryRow): string => [r.deviceset, r.variant, r.technology].join(" ");

const cloneRows = (rows: LibraryRow[]): LibraryRow[] =>
  rows.map((r) => ({ ...r, attributes: { ...r.attributes } }));

/** Unique attribute column names across all rows, in first-seen order. */
function deriveColumns(rows: LibraryRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    for (const name of Object.keys(row.attributes)) {
      if (!seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
  }
  return out;
}

export default function LibraryPage() {
  const [baseline, setBaseline] = useState<LibraryRow[] | null>(null);
  const [rows, setRows] = useState<LibraryRow[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [purge, setPurge] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [enrichInfo, setEnrichInfo] = useState<EnrichResult | null>(null);
  const [showModal, setShowModal] = useState(false);

  // Live diff vs the upload — drives the change count and the downloadable script.
  const baselineByKey = useMemo(
    () => new Map((baseline ?? []).map((r) => [keyOf(r), r.attributes])),
    [baseline],
  );
  const diff = useMemo(
    () => (baseline ? buildApplyScr(baseline, rows, new Set(purge)) : null),
    [baseline, rows, purge],
  );
  const pending = diff ? diff.setCount + diff.deleteCount : 0;

  function loadRows(next: LibraryRow[], name: string) {
    setBaseline(cloneRows(next));
    setRows(cloneRows(next));
    setColumns(deriveColumns(next));
    setPurge([]);
    setFileName(name);
    setEnrichInfo(null);
    setError("");
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as { rows?: LibraryRow[] };
      if (!Array.isArray(data.rows)) throw new Error("Not a library export (missing 'rows').");
      loadRows(
        data.rows.map((r) => ({
          deviceset: r.deviceset ?? "",
          variant: r.variant ?? "",
          package: r.package ?? "",
          technology: r.technology ?? "",
          attributes: { ...(r.attributes ?? {}) },
        })),
        file.name,
      );
    } catch (err) {
      setBaseline(null);
      setRows([]);
      setError(err instanceof Error ? err.message : "Could not read that file.");
    }
  }

  function setCell(rowIdx: number, column: string, value: string) {
    setRows((prev) =>
      prev.map((r, i) => (i === rowIdx ? { ...r, attributes: { ...r.attributes, [column]: value } } : r)),
    );
  }

  function addColumn() {
    const name = window.prompt("New column name (e.g. MPN, MANUFACTURER, DATASHEET):")?.trim();
    if (!name) return;
    if (columns.some((c) => c.toUpperCase() === name.toUpperCase())) {
      setError(`Column "${name}" already exists.`);
      return;
    }
    setColumns((prev) => [...prev, name]);
    setRows((prev) => prev.map((r) => ({ ...r, attributes: { ...r.attributes, [name]: r.attributes[name] ?? "" } })));
    setPurge((prev) => prev.filter((c) => c !== name));
    setError("");
  }

  function renameColumn(oldName: string) {
    const next = window.prompt(`Rename "${oldName}" to:`, oldName)?.trim();
    if (!next || next === oldName) return;
    if (columns.some((c) => c !== oldName && c.toUpperCase() === next.toUpperCase())) {
      setError(`Column "${next}" already exists.`);
      return;
    }
    setColumns((prev) => prev.map((c) => (c === oldName ? next : c)));
    setRows((prev) =>
      prev.map((r) => {
        const attributes: Record<string, string> = {};
        for (const [k, v] of Object.entries(r.attributes)) attributes[k === oldName ? next : k] = v;
        return { ...r, attributes };
      }),
    );
    setError("");
  }

  function deleteColumn(name: string) {
    if (!window.confirm(`Delete column "${name}" from every part? The script will remove it in Fusion.`)) return;
    setColumns((prev) => prev.filter((c) => c !== name));
    setRows((prev) =>
      prev.map((r) => {
        const attributes = { ...r.attributes };
        delete attributes[name];
        return { ...r, attributes };
      }),
    );
    // Purge ensures even baseline-empty cells are explicitly removed in the script.
    setPurge((prev) => (prev.includes(name) ? prev : [...prev, name]));
  }

  async function enrich() {
    if (rows.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const res = await jpost<EnrichResult>("/api/library/enrich", { rows, overwrite, purge });
      setRows(res.enrichedRows.map((r) => ({ ...r, attributes: { ...r.attributes } })));
      setEnrichInfo(res);
    } catch (err) {
      if (err instanceof Error && err.message !== "locked") setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!diff) return;
    const url = URL.createObjectURL(new Blob([diff.scr], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = (fileName.replace(/\.json$/i, "") || "library") + "-apply.scr";
    a.click();
    URL.revokeObjectURL(url);
    if (enrichInfo && enrichInfo.newParts.length > 0) setShowModal(true);
  }

  const isChanged = (rowIdx: number, column: string): boolean => {
    const before = baselineByKey.get(keyOf(rows[rowIdx]))?.[column] ?? "";
    return (rows[rowIdx].attributes[column] ?? "") !== before;
  };

  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-[100rem] flex-1 p-6">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Library editor</h1>
        <p className="mb-4 text-sm text-black/60 dark:text-white/60">
          Upload a <code>library.json</code> (from <code>export-library.ulp</code>) and edit it like a
          spreadsheet — change cells, add/rename/delete columns. <strong>Enrich</strong> auto-fills from
          the catalog then DigiKey/Mouser by MPN/SPN. <strong>Download apply.scr</strong> any time; it
          contains only what you changed.
        </p>

        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-black/10 p-4 dark:border-white/15">
          <label className="cursor-pointer rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500">
            {baseline ? "Replace file" : "Choose library.json"}
            <input type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
          </label>
          <span className="text-sm text-black/60 dark:text-white/60">
            {baseline ? `${fileName} — ${rows.length} rows` : "No file chosen"}
          </span>

          {baseline && (
            <>
              <button
                type="button"
                onClick={addColumn}
                className="rounded-md border border-black/20 px-3 py-2 text-sm font-medium hover:bg-black/5 dark:border-white/25 dark:hover:bg-white/10"
              >
                + Add column
              </button>

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                Overwrite existing
                <span className="text-black/50 dark:text-white/50">(off = blanks only)</span>
              </label>

              <button
                type="button"
                onClick={enrich}
                disabled={busy}
                className="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {busy ? "Enriching…" : "Enrich (DB → API)"}
              </button>

              <button
                type="button"
                onClick={download}
                className="ml-auto rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500"
              >
                Download apply.scr{pending > 0 ? ` (${pending})` : ""}
              </button>
            </>
          )}
        </div>

        {error && (
          <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {baseline && (
          <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-black/60 dark:text-white/60">
            <span>
              <strong className="text-black dark:text-white">{pending}</strong> pending change(s):{" "}
              {diff?.setCount ?? 0} set, {diff?.deleteCount ?? 0} delete across {diff?.blocks ?? 0} part(s)
            </span>
            {purge.length > 0 && <span>Removing column(s): {purge.join(", ")}</span>}
            {enrichInfo && (
              <span>
                Last enrich: filled {enrichInfo.summary.filledCells} cell(s) · DB hits{" "}
                {enrichInfo.summary.dbParts} · API calls {enrichInfo.summary.apiCalls}
                {enrichInfo.newParts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowModal(true)}
                    className="ml-2 rounded border border-black/20 px-2 py-0.5 text-xs font-medium hover:bg-black/5 dark:border-white/25 dark:hover:bg-white/10"
                  >
                    Review {enrichInfo.newParts.length} new part(s)
                  </button>
                )}
              </span>
            )}
          </div>
        )}

        {baseline ? (
          <LibraryGrid
            rows={rows}
            columns={columns}
            isChanged={isChanged}
            onCell={setCell}
            onRename={renameColumn}
            onDelete={deleteColumn}
          />
        ) : (
          <p className="text-sm text-black/60 dark:text-white/60">
            Choose a <code>library.json</code> to begin.
          </p>
        )}
      </main>

      {showModal && enrichInfo && (
        <NewPartsModal parts={enrichInfo.newParts} onClose={() => setShowModal(false)} />
      )}
    </>
  );
}

function NewPartsModal({ parts, onClose }: { parts: NewPart[]; onClose: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(parts.map((p) => p.mpn)));
  const [adding, setAdding] = useState(false);
  const [done, setDone] = useState<string>("");

  function toggle(mpn: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(mpn)) next.delete(mpn);
      else next.add(mpn);
      return next;
    });
  }

  async function add() {
    setAdding(true);
    let added = 0;
    let skipped = 0;
    for (const part of parts.filter((p) => selected.has(p.mpn))) {
      try {
        await jpost("/api/parts", part);
        added++;
      } catch (err) {
        // 409 = MPN already in catalog; count as skipped, keep going.
        if (err instanceof Error && err.message !== "locked") skipped++;
      }
    }
    setAdding(false);
    setDone(`Added ${added} part(s)${skipped ? `, ${skipped} skipped` : ""}.`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white p-5 shadow-xl dark:bg-neutral-900">
        <h2 className="text-lg font-semibold">New parts not in the catalog</h2>
        <p className="mb-3 text-sm text-black/60 dark:text-white/60">
          Resolved from a distributor lookup. Select which to add to your inventory catalog.
        </p>

        <div className="mb-3 flex-1 overflow-auto rounded-lg border border-black/10 dark:border-white/15">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-black/5 text-left dark:bg-white/10">
              <tr>
                <th className="w-8 px-3 py-2"></th>
                <th className="px-3 py-2">MPN</th>
                <th className="px-3 py-2">Manufacturer</th>
                <th className="px-3 py-2">Description</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => (
                <tr key={p.mpn} className="border-t border-black/5 dark:border-white/10">
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(p.mpn)} onChange={() => toggle(p.mpn)} />
                  </td>
                  <td className="px-3 py-2 font-mono">{p.mpn}</td>
                  <td className="px-3 py-2">{p.manufacturer || "—"}</td>
                  <td className="px-3 py-2 text-black/60 dark:text-white/60">{p.description || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-3">
          {done ? (
            <span className="text-sm text-emerald-600 dark:text-emerald-400">{done}</span>
          ) : (
            <span className="text-sm text-black/60 dark:text-white/60">
              {selected.size} of {parts.length} selected
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md border border-black/20 px-4 py-2 text-sm font-medium hover:bg-black/5 dark:border-white/25 dark:hover:bg-white/10"
          >
            {done ? "Close" : "Cancel"}
          </button>
          {!done && (
            <button
              type="button"
              onClick={add}
              disabled={adding || selected.size === 0}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {adding ? "Adding…" : `Add ${selected.size} to catalog`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
