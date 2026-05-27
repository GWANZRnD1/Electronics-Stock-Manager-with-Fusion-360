"use client";

import { useState } from "react";

import { Nav } from "@/components/Nav";
import { jpost } from "@/lib/client";

interface LibraryRow {
  deviceset: string;
  variant: string;
  package: string;
  technology: string;
  attributes: Record<string, string>;
}

interface Change {
  deviceset: string;
  variant: string;
  technology: string;
  filled: { column: string; from: string; to: string }[];
}

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
  scr: string;
  summary: {
    rows: number;
    enrichedRows: number;
    filledCells: number;
    blocks: number;
    apiCalls: number;
    dbParts: number;
  };
  changes: Change[];
  newParts: NewPart[];
}

export default function LibraryPage() {
  const [rows, setRows] = useState<LibraryRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<EnrichResult | null>(null);
  const [showModal, setShowModal] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setResult(null);
    try {
      const data = JSON.parse(await file.text()) as { rows?: LibraryRow[] };
      if (!Array.isArray(data.rows)) throw new Error("Not a library export (missing 'rows').");
      setRows(data.rows);
      setFileName(file.name);
    } catch (err) {
      setRows(null);
      setError(err instanceof Error ? err.message : "Could not read that file.");
    }
  }

  async function enrich() {
    if (!rows) return;
    setBusy(true);
    setError("");
    try {
      setResult(await jpost<EnrichResult>("/api/library/enrich", { rows, overwrite }));
    } catch (err) {
      if (err instanceof Error && err.message !== "locked") setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result.scr], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.replace(/\.json$/i, "") + "-apply.scr";
    a.click();
    URL.revokeObjectURL(url);
    if (result.newParts.length > 0) setShowModal(true);
  }

  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-6xl flex-1 p-6">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Library enrichment</h1>
        <p className="mb-6 text-sm text-black/60 dark:text-white/60">
          Upload a <code>library.json</code> (from <code>export-library.ulp</code>). Existing columns
          are filled from the catalog first, then DigiKey/Mouser by MPN/SPN. Download the{" "}
          <code>apply.scr</code> and run it in Fusion.
        </p>

        <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-black/10 p-4 dark:border-white/15">
          <label className="cursor-pointer rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500">
            Choose library.json
            <input type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
          </label>
          <span className="text-sm text-black/60 dark:text-white/60">
            {rows ? `${fileName} — ${rows.length} rows` : "No file chosen"}
          </span>

          <label className="ml-auto flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            Overwrite existing values
            <span className="text-black/50 dark:text-white/50">(off = fill blanks only)</span>
          </label>

          <button
            type="button"
            onClick={enrich}
            disabled={!rows || busy}
            className="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? "Enriching…" : "Enrich"}
          </button>
        </div>

        {error && (
          <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        {result && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-black/10 p-4 text-sm dark:border-white/15">
              <span>
                Filled <strong>{result.summary.filledCells}</strong> cell(s) across{" "}
                <strong>{result.summary.enrichedRows}</strong> of {result.summary.rows} rows
              </span>
              <span className="text-black/60 dark:text-white/60">
                DB hits: {result.summary.dbParts} · API calls: {result.summary.apiCalls} · script
                blocks: {result.summary.blocks}
              </span>
              <button
                type="button"
                onClick={download}
                disabled={result.summary.blocks === 0}
                className="ml-auto rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                Download apply.scr
              </button>
              {result.newParts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowModal(true)}
                  className="rounded-md border border-black/20 px-4 py-2 font-medium hover:bg-black/5 dark:border-white/25 dark:hover:bg-white/10"
                >
                  Review {result.newParts.length} new part(s)
                </button>
              )}
            </div>

            {result.changes.length > 0 ? (
              <div className="overflow-auto rounded-xl border border-black/10 dark:border-white/15">
                <table className="w-full text-sm">
                  <thead className="bg-black/5 text-left dark:bg-white/10">
                    <tr>
                      <th className="px-3 py-2">Part</th>
                      <th className="px-3 py-2">Column</th>
                      <th className="px-3 py-2">From</th>
                      <th className="px-3 py-2">To</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.changes.flatMap((c) =>
                      c.filled.map((f, i) => (
                        <tr
                          key={`${c.deviceset}/${c.variant}/${f.column}`}
                          className="border-t border-black/5 dark:border-white/10"
                        >
                          {i === 0 ? (
                            <td className="px-3 py-2 align-top" rowSpan={c.filled.length}>
                              <div className="font-medium">{c.deviceset}</div>
                              <div className="text-black/50 dark:text-white/50">{c.variant}</div>
                            </td>
                          ) : null}
                          <td className="px-3 py-2 font-mono">{f.column}</td>
                          <td className="px-3 py-2 text-black/50 dark:text-white/50">{f.from || "—"}</td>
                          <td className="px-3 py-2">{f.to}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-black/60 dark:text-white/60">
                Nothing to fill — every matched column already had a value (try Overwrite, or no
                identifier matched).
              </p>
            )}
          </section>
        )}
      </main>

      {showModal && result && (
        <NewPartsModal parts={result.newParts} onClose={() => setShowModal(false)} />
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
                <th className="px-3 py-2 w-8"></th>
                <th className="px-3 py-2">MPN</th>
                <th className="px-3 py-2">Manufacturer</th>
                <th className="px-3 py-2">Description</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => (
                <tr key={p.mpn} className="border-t border-black/5 dark:border-white/10">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(p.mpn)}
                      onChange={() => toggle(p.mpn)}
                    />
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
