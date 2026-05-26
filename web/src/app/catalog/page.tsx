"use client";

import { useEffect, useState } from "react";

import { Nav } from "@/components/Nav";
import { jget } from "@/lib/client";

interface CatalogPart {
  id: number;
  mpn: string;
  manufacturer: string;
  description: string;
  stock: number;
}

export default function CatalogPage() {
  const [parts, setParts] = useState<CatalogPart[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rows = await jget<CatalogPart[]>("/api/parts/catalog");
        if (active) setParts(rows);
      } catch (e) {
        if (active && e instanceof Error && e.message !== "locked") setError(e.message);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? parts.filter(
        (p) =>
          p.mpn.toLowerCase().includes(q) ||
          p.manufacturer.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q),
      )
    : parts;

  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-5xl flex-1 p-6">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Part catalog</h1>
        <p className="mb-6 text-sm text-black/60 dark:text-white/60">
          Every part (synced from the Fusion library) with its on-hand stock.
        </p>

        {error && (
          <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <input
          className="mb-4 w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-blue-500 dark:border-white/20"
          placeholder="Filter by MPN, manufacturer, description…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/15">
          <table className="w-full text-left text-sm">
            <thead className="text-black/50 dark:text-white/50">
              <tr className="border-b border-black/10 dark:border-white/15">
                <th className="px-4 py-2 font-medium">MPN</th>
                <th className="px-4 py-2 font-medium">Manufacturer</th>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 text-right font-medium">Stock</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td className="px-4 py-3 text-black/60 dark:text-white/60" colSpan={4}>
                    No parts. Sync your Fusion library or receive stock.
                  </td>
                </tr>
              ) : (
                filtered.slice(0, 500).map((p) => (
                  <tr key={p.id} className="border-b border-black/5 dark:border-white/10">
                    <td className="px-4 py-2 font-mono">{p.mpn}</td>
                    <td className="px-4 py-2 text-black/70 dark:text-white/70">
                      {p.manufacturer || "—"}
                    </td>
                    <td className="px-4 py-2 text-black/70 dark:text-white/70">
                      {p.description || "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {p.stock > 0 ? (
                        <span className="font-medium tabular-nums">{p.stock}</span>
                      ) : (
                        <span className="rounded bg-black/5 px-2 py-0.5 text-xs text-black/50 dark:bg-white/10 dark:text-white/50">
                          none
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && (
          <p className="mt-2 text-xs text-black/50 dark:text-white/50">
            Showing first 500 of {filtered.length}. Refine the filter.
          </p>
        )}
      </main>
    </>
  );
}
