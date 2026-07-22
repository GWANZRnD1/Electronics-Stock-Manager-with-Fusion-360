"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Nav } from "@/components/Nav";
import { btn, btnSecondary, inputClass } from "@/components/ui";
import { jget, jpost } from "@/lib/client";

interface Location {
  id: number;
  name: string;
}

interface StockRow {
  partId: number;
  mpn: string;
  manufacturer: string;
  locationId: number;
  location: string;
  quantity: number;
  lastConfirmedAt: string | null;
}

function relativeDate(value: string | null) {
  if (!value) return "Never counted";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "Counted today";
  if (days === 1) return "Counted yesterday";
  return `Counted ${days} days ago`;
}

export default function StocktakePage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState<number | "">("");
  const [rows, setRows] = useState<StockRow[]>([]);
  const [counts, setCounts] = useState<Map<number, number>>(new Map());
  const [touched, setTouched] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [boardScope, setBoardScope] = useState<{ id: number; name: string; partIds: Set<number> } | null>(null);
  const [returnPath, setReturnPath] = useState("");

  useEffect(() => {
    let active = true;
    void jget<Location[]>("/api/locations")
      .then((data) => {
        if (!active) return;
        setLocations(data);
        const params = new URLSearchParams(window.location.search);
        const requested = Number(params.get("location"));
        const requestedBoard = Number(params.get("board"));
        const requestedReturn = params.get("return") ?? "";
        if (requestedReturn.startsWith("/") && !requestedReturn.startsWith("//")) setReturnPath(requestedReturn);
        if (Number.isInteger(requestedBoard) && requestedBoard > 0) {
          void Promise.all([
            jget<{ resolvedPartId?: number | null }[]>(`/api/boards/${requestedBoard}/bom?detail=1`),
            jget<{ id: number; name: string }[]>("/api/boards"),
          ]).then(([bom, boards]) => {
            if (!active) return;
            setBoardScope({
              id: requestedBoard,
              name: boards.find((board) => board.id === requestedBoard)?.name ?? `Board ${requestedBoard}`,
              partIds: new Set(bom.flatMap((row) => row.resolvedPartId ? [row.resolvedPartId] : [])),
            });
          }).catch(() => {});
        }
        if (Number.isInteger(requested) && data.some((location) => location.id === requested)) {
          setLocationId(requested);
        } else {
          setLoading(false);
        }
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Could not load locations.");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!locationId) return;
    let active = true;
    void jget<StockRow[]>(`/api/stock?locationId=${locationId}`)
      .then((data) => {
        if (!active) return;
        setRows(data);
        setCounts(new Map(data.map((row) => [row.partId, row.quantity])));
        setTouched(new Set());
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : "Could not load stock."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [locationId]);

  const scopedRows = useMemo(
    () => boardScope ? rows.filter((row) => boardScope.partIds.has(row.partId)) : rows,
    [boardScope, rows],
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return scopedRows;
    return scopedRows.filter((row) =>
      [row.mpn, row.manufacturer].some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [query, scopedRows]);

  const differences = scopedRows.filter((row) => touched.has(row.partId) && counts.get(row.partId) !== row.quantity).length;
  const selectedLocation = locations.find((location) => location.id === locationId);

  function setCount(row: StockRow, value: number) {
    setCounts((previous) => new Map(previous).set(row.partId, Math.max(0, Math.min(1_000_000, value))));
    setTouched((previous) => new Set(previous).add(row.partId));
    setMessage("");
  }

  function restoreCount(row: StockRow) {
    setCounts((previous) => new Map(previous).set(row.partId, row.quantity));
    setTouched((previous) => {
      const next = new Set(previous);
      next.delete(row.partId);
      return next;
    });
    setMessage("");
  }

  function focusNextCount(partId: number) {
    window.requestAnimationFrame(() => {
      const inputs = [...document.querySelectorAll<HTMLInputElement>("[data-stocktake-count]")];
      const current = inputs.findIndex((input) => Number(input.dataset.stocktakeCount) === partId);
      const next = inputs[current + 1];
      if (next) {
        next.focus();
        next.select();
      } else {
        inputs[current]?.blur();
      }
    });
  }

  function chooseLocation(value: string) {
    const next = value ? Number(value) : "";
    setLoading(Boolean(next));
    setError("");
    setMessage("");
    setRows([]);
    setCounts(new Map());
    setTouched(new Set());
    setQuery("");
    setLocationId(next);
  }

  function confirmShown() {
    setTouched((previous) => {
      const next = new Set(previous);
      filtered.forEach((row) => next.add(row.partId));
      return next;
    });
  }

  async function applyCounts() {
    if (!locationId || touched.size === 0) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await jpost<{ confirmed: number; changed: number; reference: string }>("/api/stock/count", {
        locationId,
        counts: rows
          .filter((row) => touched.has(row.partId))
          .map((row) => ({ partId: row.partId, quantity: counts.get(row.partId) ?? row.quantity })),
      });
      const refreshed = await jget<StockRow[]>(`/api/stock?locationId=${locationId}`);
      setRows(refreshed);
      setCounts(new Map(refreshed.map((row) => [row.partId, row.quantity])));
      setTouched(new Set());
      setMessage(
        `Saved ${result.confirmed} physical count${result.confirmed === 1 ? "" : "s"}; ${result.changed} stock balance${result.changed === 1 ? "" : "s"} changed.`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the stocktake.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Nav />
      <main
        className="mx-auto w-full max-w-4xl flex-1 p-4 sm:p-6"
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.ctrlKey || event.metaKey) &&
            touched.size > 0 &&
            !saving
          ) {
            event.preventDefault();
            void applyCounts();
          }
        }}
      >
        <header className="mb-5">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-blue-700 dark:text-blue-300">
            Physical inventory
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Stocktake</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            {boardScope ? `Preflight ${boardScope.name}: pick a physical location and count only this board’s matched components.` : "Pick the physical location first, then count what is actually there. Differences are reviewed before stock changes."}
          </p>
          {returnPath && <Link className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-blue-700 underline dark:text-blue-300" href={returnPath}>← Back to assembly</Link>}
        </header>

        <section className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-blue-700 text-white dark:bg-blue-400 dark:text-slate-950">1</span>
            Choose where you are counting
          </div>
          <label className="text-sm font-medium" htmlFor="stocktake-location">
            Stock location
          </label>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
            <select
              id="stocktake-location"
              className={inputClass}
              value={locationId}
              onChange={(event) => chooseLocation(event.target.value)}
              disabled={loading}
            >
              <option value="">Select a shelf, bin, or project location…</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
            <Link href="/locations" className={`${btnSecondary} shrink-0 text-center`}>Manage locations</Link>
          </div>
        </section>

        {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300" role="alert">{error}</p>}
        {message && <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300" role="status">{message}</p>}

        {locationId && (
          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-blue-700 text-white dark:bg-blue-400 dark:text-slate-950">2</span>
                  Count components
                </div>
                <h2 className="mt-2 text-lg font-semibold">{selectedLocation?.name}</h2>
                <p className="text-sm text-[var(--muted)]">{touched.size} of {scopedRows.length} checked · {differences} difference{differences === 1 ? "" : "s"}</p>
              </div>
              <div className="text-right">
                <button className={btnSecondary} onClick={confirmShown} disabled={filtered.length === 0}>Confirm shown unchanged</button>
                <p className="mt-1 hidden text-xs text-[var(--muted)] sm:block">Enter: confirm &amp; next · Esc: restore</p>
              </div>
            </div>

            <label htmlFor="stocktake-search" className="sr-only">Find a component</label>
            <input id="stocktake-search" data-shortcut-search aria-keyshortcuts="/" className={`${inputClass} mb-3`} placeholder="Scan or search MPN / manufacturer…" value={query} onChange={(event) => setQuery(event.target.value)} />

            {loading ? (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">Loading stock…</div>
            ) : scopedRows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-6 text-center">
                <h2 className="font-semibold">{boardScope ? `No ${boardScope.name} parts are assigned here` : "Nothing is assigned to this location"}</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">Receive stock here or assign parts from Inventory before counting it.</p>
                <div className="mt-4 flex justify-center gap-2"><Link className={btnSecondary} href="/">Inventory</Link><Link className={btn} href={`/scan?location=${locationId}`}>Receive stock</Link></div>
              </div>
            ) : (
              <ul className="space-y-2">
                {filtered.map((row) => {
                  const counted = counts.get(row.partId) ?? row.quantity;
                  const checked = touched.has(row.partId);
                  const difference = counted - row.quantity;
                  return (
                    <li key={row.partId} className={`rounded-xl border bg-[var(--surface)] p-3 shadow-sm ${checked ? difference === 0 ? "border-emerald-400" : "border-amber-500" : "border-[var(--border)]"}`}>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <p className="break-all font-mono text-sm font-semibold">{row.mpn || "Unnamed part"}</p>
                          <p className="mt-1 text-xs text-[var(--muted)]">Expected {row.quantity} · {relativeDate(row.lastConfirmedAt)}</p>
                        </div>
                        <div className="flex items-center justify-between gap-2 sm:justify-end">
                          <button className="grid h-11 w-11 place-items-center rounded-lg border border-[var(--border)] text-xl" aria-label={`Decrease ${row.mpn}`} onClick={() => setCount(row, counted - 1)}>−</button>
                          <label className="text-center text-xs font-medium text-[var(--muted)]">
                            Counted
                            <input
                              className="mt-1 block h-11 w-24 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-center text-lg font-semibold tabular-nums"
                              inputMode="numeric"
                              value={counted}
                              data-stocktake-count={row.partId}
                              aria-keyshortcuts="Enter Escape"
                              title="Enter to confirm and move next · Esc to restore expected count"
                              onFocus={(event) => event.currentTarget.select()}
                              onChange={(event) => setCount(row, Number(event.target.value.replace(/\D/g, "")) || 0)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
                                  event.preventDefault();
                                  setCount(row, counted);
                                  focusNextCount(row.partId);
                                } else if (event.key === "Escape") {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  restoreCount(row);
                                  event.currentTarget.blur();
                                }
                              }}
                            />
                          </label>
                          <button className="grid h-11 w-11 place-items-center rounded-lg border border-[var(--border)] text-xl" aria-label={`Increase ${row.mpn}`} onClick={() => setCount(row, counted + 1)}>+</button>
                          {!checked && <button className="min-h-11 rounded-lg border border-[var(--border)] px-3 text-sm font-medium" onClick={() => setCount(row, row.quantity)}>Same</button>}
                        </div>
                      </div>
                      {checked && difference !== 0 && <p className="mt-2 text-sm font-medium text-amber-800 dark:text-amber-300">Will adjust by {difference > 0 ? "+" : ""}{difference}</p>}
                    </li>
                  );
                })}
              </ul>
            )}

            {scopedRows.length > 0 && (
              <div className="sticky bottom-[5.25rem] z-20 mt-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-lg sm:bottom-4">
                <div className="text-sm"><strong>{touched.size}</strong> counted<span className="hidden text-[var(--muted)] sm:inline"> · {differences} changes</span></div>
                <button className={btn} aria-keyshortcuts="Control+Enter Meta+Enter" title="Save counts (Ctrl/⌘+Enter)" onClick={() => void applyCounts()} disabled={saving || touched.size === 0}>{saving ? "Saving…" : `Save ${touched.size} count${touched.size === 1 ? "" : "s"}`}</button>
              </div>
            )}
          </section>
        )}
      </main>
    </>
  );
}
