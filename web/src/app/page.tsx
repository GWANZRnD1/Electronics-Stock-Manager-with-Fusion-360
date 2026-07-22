"use client";

import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { Nav } from "@/components/Nav";
import { StockEditorModal } from "@/components/StockEditor";
import { Modal, btn, inputClass } from "@/components/ui";
import { jdel, jget, jpatch, jpost, jupload } from "@/lib/client";
import { useAltWheelScroll } from "@/lib/useAltWheelScroll";
import { stockLocationOrder } from "@/lib/domain/stockRanking";

interface CatalogRow {
  id: number;
  category: string;
  supplier: string;
  spn: string;
  manufacturer: string;
  mpn: string;
  name: string;
  description: string;
  package: string;
  value: string;
  unitCost: number | null;
  totalQuantity: number;
  numLocations: number;
  stockValue: number | null;
  locations: string;
}

interface StockRow {
  locationId: number;
  location: string;
  quantity: number;
  lastConfirmedAt: string | null;
  projectLocation: boolean;
}

interface SummaryRow {
  category: string;
  value: number;
  quantity: number;
  partCount: number;
}

interface Offer {
  distributor: string;
  manufacturer: string;
  description: string;
  category: string;
  package: string;
  mock: boolean;
}

type Filters = {
  q: string;
  category: string;
  name: string;
  manufacturer: string;
  mpn: string;
  package: string;
  location: string;
};

// Render the catalog in chunks — a small DOM keeps row expansion snappy on
// large result sets; "Show more" reveals the next chunk.
const ROWS_PER_PAGE = 50;

const EMPTY: Filters = {
  q: "",
  category: "",
  name: "",
  manufacturer: "",
  mpn: "",
  package: "",
  location: "",
};

function buildQuery(f: Filters): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v.trim()) sp.set(k, v.trim());
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

const money = (n: number | null | undefined): string =>
  n === null || n === undefined ? "—" : `$${n.toFixed(n < 1 ? 4 : 2)}`;

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export default function Home() {
  const [view, setView] = useState<"inventory" | "summary">("inventory");
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [fabOpen, setFabOpen] = useState(false);
  const [modal, setModal] = useState<"part" | "location" | "digikey" | null>(null);
  const [editing, setEditing] = useState<CatalogRow | null>(null);

  useEffect(() => {
    if (view !== "inventory") return;
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const data = await jget<CatalogRow[]>(`/api/parts/catalog${buildQuery(filters)}`);
          setRows(data);
          setError("");
        } catch (e) {
          if (e instanceof Error && e.message !== "locked") setError(e.message);
        }
      })();
    }, 300);
    return () => clearTimeout(handle);
  }, [filters, refreshKey, view]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const cats = await jget<string[]>("/api/parts/categories");
        if (active) setCategories(cats);
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFilters((f) => ({ ...f, [k]: e.target.value }));

  const refresh = () => setRefreshKey((k) => k + 1);

  // Reflect a single inline cell edit locally so the row updates without a
  // refetch (keeps scroll position and any expanded rows intact).
  const patchRow = useCallback((id: number, patch: Partial<CatalogRow>) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...patch };
        if (patch.unitCost !== undefined || patch.totalQuantity !== undefined) {
          next.stockValue =
            next.unitCost === null ? null : Number((next.unitCost * next.totalQuantity).toFixed(4));
        }
        return next;
      }),
    );
  }, []);

  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">
        <div className="mb-4 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
          <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
            <button className="min-h-11 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white dark:bg-blue-400 dark:text-slate-950" onClick={() => setModal("part")}>
              + Add part
            </button>
            <button
              className="hidden min-h-11 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium hover:bg-[var(--surface-subtle)] sm:inline-flex sm:items-center"
              onClick={() => setModal("digikey")}
            >
              Import DigiKey order
            </button>
            <div className="flex items-center gap-1 rounded-lg border border-black/10 p-0.5 text-sm dark:border-white/15">
            <button
              className={`min-h-11 rounded-md px-3 py-2 ${view === "inventory" ? "bg-blue-600 text-white" : "text-black/60 dark:text-white/60"}`}
              onClick={() => setView("inventory")}
            >
              Inventory
            </button>
            <button
              className={`min-h-11 rounded-md px-3 py-2 ${view === "summary" ? "bg-blue-600 text-white" : "text-black/60 dark:text-white/60"}`}
              onClick={() => setView("summary")}
            >
              Summary
            </button>
            </div>
          </div>
        </div>

        {view === "summary" ? (
          <SummaryView refreshKey={refreshKey} />
        ) : (
          <>
            <div className="mb-3">
              <input
                data-shortcut-search
                aria-keyshortcuts="/"
                className={inputClass}
                placeholder="Search MPN, SPN, name, manufacturer, category, size…"
                value={filters.q}
                onChange={set("q")}
              />
            </div>

            <div className="mb-4 flex items-start gap-2">
              <select
                className={`${inputClass} max-w-64`}
                value={filters.category}
                onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <details className="min-w-32 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                <summary className="flex min-h-11 cursor-pointer list-none items-center px-3 py-2 text-sm font-medium">More filters</summary>
                <div className="grid grid-cols-1 gap-2 border-t border-[var(--border)] p-3 sm:grid-cols-2 lg:grid-cols-5">
                  <input className={inputClass} placeholder="Name" value={filters.name} onChange={set("name")} />
                  <input className={inputClass} placeholder="Manufacturer" value={filters.manufacturer} onChange={set("manufacturer")} />
                  <input className={inputClass} placeholder="MPN" value={filters.mpn} onChange={set("mpn")} />
                  <input className={inputClass} placeholder="Size (0603, TH…)" value={filters.package} onChange={set("package")} />
                  <input className={inputClass} placeholder="Location" value={filters.location} onChange={set("location")} />
                </div>
              </details>
            </div>

            {error && (
              <p className="mb-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}

            <InventoryTable rows={rows} onEdit={setEditing} onPatched={patchRow} />
            {rows.length >= 5000 && (
              <p className="mt-2 text-xs text-black/50 dark:text-white/50">
                Showing first 5000 — refine the search.
              </p>
            )}
          </>
        )}
      </main>

      <Fab
        open={fabOpen}
        onToggle={() => setFabOpen((o) => !o)}
        onAddPart={() => {
          setModal("part");
          setFabOpen(false);
        }}
        onAddLocation={() => {
          setModal("location");
          setFabOpen(false);
        }}
      />

      {modal === "part" && (
        <PartFormModal
          categories={categories}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            refresh();
          }}
        />
      )}
      {editing && (
        <PartFormModal
          initial={editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      {modal === "location" && (
        <AddLocationModal
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            refresh();
          }}
        />
      )}
      {modal === "digikey" && (
        <DigikeyImportModal
          onClose={() => setModal(null)}
          onImported={refresh}
        />
      )}
    </>
  );
}

function InventoryTable({
  rows,
  onEdit,
  onPatched,
}: {
  rows: CatalogRow[];
  onEdit: (r: CatalogRow) => void;
  onPatched: (id: number, patch: Partial<CatalogRow>) => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [stockPart, setStockPart] = useState<CatalogRow | null>(null);
  const [visible, setVisible] = useState(ROWS_PER_PAGE);
  // Render rows incrementally — keeping the DOM small is what makes expand snappy
  // on large result sets. Reset paging/expansion when a new result set arrives
  // (set-state-during-render is React's recommended way to react to a prop change).
  const [prevRows, setPrevRows] = useState(rows);
  if (rows !== prevRows) {
    setPrevRows(rows);
    setVisible(ROWS_PER_PAGE);
    setExpanded(null);
  }
  // Stable handler so memoized rows don't re-render when an unrelated row toggles.
  const toggle = useCallback((id: number) => setExpanded((cur) => (cur === id ? null : id)), []);
  const scrollRef = useAltWheelScroll<HTMLDivElement>();
  const cols = 12;
  const shown = rows.slice(0, visible);
  return (
    <>
      <div className="space-y-2 lg:hidden">
        {shown.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-5 text-center text-sm text-[var(--muted)]">
            No parts. Add a component or import an order to get started.
          </div>
        ) : shown.map((row) => (
          <article key={row.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-all font-mono text-sm font-semibold">{row.mpn || row.description || "Unnamed component"}</h2>
                <p className="mt-1 line-clamp-2 text-sm text-[var(--muted)]">{[row.manufacturer, row.value, row.package].filter(Boolean).join(" · ") || row.category || "No details"}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-2xl font-semibold tabular-nums">{row.totalQuantity}</p>
                <p className="text-xs text-[var(--muted)]">on hand</p>
              </div>
            </div>
            <p className="mt-2 truncate text-xs text-[var(--muted)]">{row.locations || "No stock location"}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="min-h-11 rounded-lg bg-blue-700 px-3 py-2 text-sm font-medium text-white dark:bg-blue-400 dark:text-slate-950" onClick={() => setStockPart(row)}>
                Count / adjust stock
              </button>
              <button className="min-h-11 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium" onClick={() => onEdit(row)}>
                Edit details
              </button>
            </div>
          </article>
        ))}
      </div>

      <div ref={scrollRef} className="hidden overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] lg:block">
      <table className="w-full min-w-[72rem] text-left text-sm">
        <thead className="text-black/50 dark:text-white/50">
          <tr className="border-b border-black/10 dark:border-white/15">
            <th className="w-6 px-2 py-2" />
            <th className="px-3 py-2 font-medium">Category</th>
            <th className="px-3 py-2 font-medium">Supplier</th>
            <th className="px-3 py-2 font-medium">SPN</th>
            <th className="px-3 py-2 font-medium">Manufacturer</th>
            <th className="px-3 py-2 font-medium">MPN</th>
            <th className="px-3 py-2 text-right font-medium">On hand</th>
            <th className="px-3 py-2 font-medium">Description</th>
            <th className="px-3 py-2 font-medium">Value</th>
            <th className="px-3 py-2 text-right font-medium">Unit cost</th>
            <th className="px-3 py-2 text-right font-medium"># Loc</th>
            <th className="px-3 py-2 text-right font-medium">Stock value</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="px-3 py-3 text-black/60 dark:text-white/60" colSpan={cols + 1}>
                No parts. Use the + button to add one or import a CSV.
              </td>
            </tr>
          ) : (
            shown.map((r) => (
              <PartRow
                key={r.id}
                row={r}
                expanded={expanded === r.id}
                onToggle={toggle}
                onEdit={onEdit}
                onStock={setStockPart}
                onPatched={onPatched}
                colSpan={cols + 1}
              />
            ))
          )}
        </tbody>
      </table>
      </div>

      {visible < rows.length && (
        <div className="mt-3 flex items-center justify-center gap-3 text-sm">
          <span className="text-black/50 dark:text-white/50">
            Showing {shown.length} of {rows.length}
          </span>
          <button
            className="min-h-11 rounded-lg border border-[var(--border)] px-3 py-2 font-medium hover:bg-[var(--surface-subtle)]"
            onClick={() => setVisible((v) => v + ROWS_PER_PAGE)}
          >
            Show more
          </button>
          <button
            className="min-h-11 rounded-lg px-3 py-2 text-[var(--muted)] hover:bg-[var(--surface-subtle)]"
            onClick={() => setVisible(rows.length)}
          >
            Show all
          </button>
        </div>
      )}

      {stockPart && (
        <StockEditorModal
          partId={stockPart.id}
          partLabel={stockPart.mpn || stockPart.description}
          onClose={() => setStockPart(null)}
          onChanged={(stockRows) => onPatched(stockPart.id, {
            totalQuantity: stockRows.reduce((sum, row) => sum + row.quantity, 0),
            numLocations: stockRows.filter((row) => row.quantity > 0).length,
            locations: stockRows.filter((row) => row.quantity > 0).map((row) => row.location).join(", "),
          })}
        />
      )}
    </>
  );
}

const PartRow = memo(function PartRow({
  row,
  expanded,
  onToggle,
  onEdit,
  onStock,
  onPatched,
  colSpan,
}: {
  row: CatalogRow;
  expanded: boolean;
  onToggle: (id: number) => void;
  onEdit: (row: CatalogRow) => void;
  onStock: (row: CatalogRow) => void;
  onPatched: (id: number, patch: Partial<CatalogRow>) => void;
  colSpan: number;
}) {
  return (
    <>
      <tr className="border-b border-black/5 dark:border-white/10" onMouseEnter={() => prefetchStock(row.id)}>
        <td className="px-2 py-2">
          <button
            className="grid h-5 w-5 place-items-center rounded text-black/50 hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/10"
            onClick={() => onToggle(row.id)}
            aria-label={expanded ? "Collapse" : "Expand locations"}
          >
            <span className={`transition-transform ${expanded ? "rotate-90" : ""}`}>▸</span>
          </button>
        </td>
        <EditableCell partId={row.id} field="category" raw={row.category} className="px-3 py-2" onPatched={onPatched} />
        <EditableCell
          partId={row.id}
          field="supplier"
          raw={row.supplier}
          className="px-3 py-2 text-black/70 dark:text-white/70"
          onPatched={onPatched}
        />
        <EditableCell
          partId={row.id}
          field="spn"
          raw={row.spn}
          className="px-3 py-2 font-mono text-xs"
          onPatched={onPatched}
        />
        <EditableCell
          partId={row.id}
          field="manufacturer"
          raw={row.manufacturer}
          className="px-3 py-2 text-black/70 dark:text-white/70"
          onPatched={onPatched}
        />
        <EditableCell partId={row.id} field="mpn" raw={row.mpn} className="px-3 py-2 font-mono" onPatched={onPatched} />
        <td className="px-3 py-2 text-right">
          <button className="min-h-9 rounded-lg px-2 font-semibold tabular-nums text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-500/10" onClick={() => onStock(row)} aria-label={`Manage ${row.totalQuantity} units of ${row.mpn || row.description}`}>
            {row.totalQuantity}
          </button>
        </td>
        <EditableCell
          partId={row.id}
          field="description"
          raw={row.description}
          title={row.description || undefined}
          className="max-w-xs truncate px-3 py-2 text-black/70 dark:text-white/70"
          onPatched={onPatched}
        />
        <EditableCell partId={row.id} field="value" raw={row.value} className="px-3 py-2" onPatched={onPatched} />
        <EditableCell
          partId={row.id}
          field="unitCost"
          numeric
          raw={row.unitCost != null ? String(row.unitCost) : ""}
          display={money(row.unitCost)}
          className="px-3 py-2 text-right tabular-nums"
          onPatched={onPatched}
        />
        <td className="px-3 py-2 text-right tabular-nums">{row.numLocations}</td>
        <td className="px-3 py-2 text-right tabular-nums">{money(row.stockValue)}</td>
        <td className="px-3 py-2 text-right">
          <button
            className="rounded-md px-2 py-1 text-xs text-blue-600 hover:bg-blue-500/10 dark:text-blue-400"
            onClick={() => onStock(row)}
            aria-label={`Manage stock locations for ${row.mpn || row.description}`}
          >
            Stock
          </button>
          <button
            className="rounded-md px-2 py-1 text-xs text-blue-600 hover:bg-blue-500/10 dark:text-blue-400"
            onClick={() => onEdit(row)}
            aria-label={`Edit ${row.mpn || row.description}`}
          >
            ✎ Edit
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-black/5 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.03]">
          <td />
          <td className="px-3 py-2" colSpan={colSpan - 1}>
            <LocationDetail partId={row.id} onPatched={onPatched} />
          </td>
        </tr>
      )}
    </>
  );
});

type EditableField =
  | "category"
  | "supplier"
  | "spn"
  | "manufacturer"
  | "mpn"
  | "description"
  | "value"
  | "unitCost";

/**
 * A catalog cell that turns into an inline editor on double-click or
 * Ctrl/Cmd+click. Enter commits a single-field PATCH; Esc or blur cancels. On
 * success the parent updates its row locally (no refetch).
 */
function EditableCell({
  partId,
  field,
  raw,
  display,
  numeric,
  className,
  title,
  onPatched,
}: {
  partId: number;
  field: EditableField;
  raw: string;
  display?: ReactNode;
  numeric?: boolean;
  className?: string;
  title?: string;
  onPatched: (id: number, patch: Partial<CatalogRow>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(raw);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (editing && el) {
      el.focus();
      el.select();
    }
  }, [editing]);

  function begin(e: React.MouseEvent, direct = false) {
    if (!direct && !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setDraft(raw);
    setErr(false);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setDraft(raw);
    setErr(false);
  }

  async function commit() {
    const trimmed = draft.trim();
    let value: string | number | null = trimmed;
    if (numeric) {
      if (trimmed === "") value = null;
      else {
        const n = Number(trimmed);
        if (!Number.isFinite(n) || n < 0) {
          setErr(true);
          return;
        }
        value = n;
      }
    }
    setSaving(true);
    setErr(false);
    try {
      await jpatch(`/api/parts/${partId}`, { [field]: value });
      onPatched(partId, { [field]: value } as Partial<CatalogRow>);
      setEditing(false);
    } catch {
      setErr(true);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <td className={className}>
        <input
          ref={inputRef}
          value={draft}
          readOnly={saving}
          inputMode={numeric ? "decimal" : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={cancel}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          className={`w-full rounded bg-white px-1 py-0.5 text-sm text-black outline-none ring-1 dark:bg-neutral-900 dark:text-white ${
            err ? "ring-red-500" : "ring-blue-500"
          }`}
        />
      </td>
    );
  }

  return (
    <td
      className={`${className ?? ""} cursor-cell hover:bg-blue-500/5`}
      onClick={begin}
      onDoubleClick={(event) => begin(event, true)}
      title={title ?? "Double-click to edit"}
    >
      {display ?? (raw || "—")}
    </td>
  );
}

// Stock detail cached per part so re-expanding a row is instant (no refetch, no
// "Loading…" flash). Hovering a row prefetches it so the first open feels instant
// too. An in-flight map dedupes concurrent requests for the same part.
const stockCache = new Map<number, StockRow[]>();
const stockInflight = new Map<number, Promise<StockRow[]>>();

function fetchStock(partId: number): Promise<StockRow[]> {
  const cached = stockCache.get(partId);
  if (cached) return Promise.resolve(cached);
  const inflight = stockInflight.get(partId);
  if (inflight) return inflight;
  const p = jget<StockRow[]>(`/api/parts/${partId}/stock`)
    .then((data) => {
      stockCache.set(partId, data);
      stockInflight.delete(partId);
      return data;
    })
    .catch((e) => {
      stockInflight.delete(partId);
      throw e;
    });
  stockInflight.set(partId, p);
  return p;
}

/** Warm the cache ahead of a click (called on row hover) so expand feels instant. */
function prefetchStock(partId: number): void {
  void fetchStock(partId).catch(() => {});
}

function LocationDetail({
  partId,
  onPatched,
}: {
  partId: number;
  onPatched: (id: number, patch: Partial<CatalogRow>) => void;
}) {
  // Seed from cache so a re-expand paints immediately; still revalidate below.
  const [stock, setStock] = useState<StockRow[] | null>(() => stockCache.get(partId) ?? null);
  const [locations, setLocations] = useState<{ id: number; name: string }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [editLoc, setEditLoc] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [qtyErr, setQtyErr] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addLocationId, setAddLocationId] = useState<number | "">("");
  const [addQuantity, setAddQuantity] = useState("0");
  const [moveLoc, setMoveLoc] = useState<number | null>(null);
  const [moveToId, setMoveToId] = useState<number | "">("");

  useEffect(() => {
    let active = true;
    void fetchStock(partId)
      .then((stockRows) => {
        if (active) setStock(stockRows);
      })
      .catch((e) => {
        if (active) {
          setStock(stockCache.get(partId) ?? []);
          setError(e instanceof Error && e.message !== "locked" ? e.message : "Unable to load stock.");
        }
      });
    void jget<{ id: number; name: string }[]>("/api/locations")
      .then((locationRows) => {
        if (active) setLocations(locationRows);
      })
      .catch((e) => {
        if (active) {
          setError(e instanceof Error && e.message !== "locked" ? e.message : "Unable to load locations.");
        }
      });
    return () => {
      active = false;
    };
  }, [partId]);

  function applyStock(next: StockRow[]) {
    const sorted = [...next].sort(stockLocationOrder);
    stockCache.set(partId, sorted);
    setStock(sorted);
    onPatched(partId, {
      totalQuantity: sorted.reduce((total, row) => total + row.quantity, 0),
      numLocations: sorted.filter((row) => row.quantity > 0).length,
    });
  }

  async function refreshStock() {
    stockCache.delete(partId);
    applyStock(await fetchStock(partId));
  }

  async function confirm(locationId: number) {
    setBusy(`confirm:${locationId}`);
    setError("");
    try {
      await jpost(`/api/parts/${partId}/confirm`, { locationId });
      await refreshStock();
    } catch (e) {
      if (e instanceof Error && e.message !== "locked") setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  function beginQty(s: StockRow) {
    setEditLoc(s.locationId);
    setDraft(String(s.quantity));
    setQtyErr(false);
    setMoveLoc(null);
    setError("");
  }

  async function commitQty(s: StockRow) {
    const n = Number(draft.trim());
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
      setQtyErr(true);
      return;
    }
    setBusy(`edit:${s.locationId}`);
    setQtyErr(false);
    setError("");
    try {
      await jpatch(`/api/parts/${partId}/stock`, { locationId: s.locationId, quantity: n });
      const next = (stock ?? []).map((x) => (x.locationId === s.locationId ? { ...x, quantity: n } : x));
      applyStock(next);
      setEditLoc(null);
    } catch (e) {
      setQtyErr(true);
      if (e instanceof Error && e.message !== "locked") setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const quantity = Number(addQuantity.trim());
    if (!addLocationId || !Number.isInteger(quantity) || quantity < 0 || quantity > 1_000_000) {
      setError("Choose a location and enter a whole-number quantity from 0 to 1,000,000.");
      return;
    }
    setBusy("add");
    setError("");
    try {
      await jpost(`/api/parts/${partId}/stock`, { locationId: addLocationId, quantity });
      await refreshStock();
      setAdding(false);
      setAddLocationId("");
      setAddQuantity("0");
    } catch (e) {
      if (e instanceof Error && e.message !== "locked") setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function move(s: StockRow) {
    if (!moveToId) return;
    setBusy(`move:${s.locationId}`);
    setError("");
    try {
      await jpost(`/api/parts/${partId}/stock/move`, {
        fromLocationId: s.locationId,
        toLocationId: moveToId,
      });
      await refreshStock();
      setMoveLoc(null);
      setMoveToId("");
    } catch (e) {
      if (e instanceof Error && e.message !== "locked") setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(s: StockRow) {
    const detail =
      s.quantity === 0
        ? `Remove this component from "${s.location}"?`
        : `Remove this component from "${s.location}" and adjust its ${s.quantity} unit${s.quantity === 1 ? "" : "s"} to zero?`;
    if (!window.confirm(detail)) return;
    setBusy(`remove:${s.locationId}`);
    setError("");
    try {
      await jdel(`/api/parts/${partId}/stock?locationId=${s.locationId}`);
      await refreshStock();
    } catch (e) {
      if (e instanceof Error && e.message !== "locked") setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  if (stock === null) return <p className="text-xs text-black/50 dark:text-white/50">Loading…</p>;

  const assignedIds = new Set(stock.map((row) => row.locationId));
  const unassigned = (locations ?? []).filter((location) => !assignedIds.has(location.id));
  const actionClass =
    "rounded px-2 py-1 text-blue-600 hover:bg-blue-500/10 disabled:opacity-40 dark:text-blue-400";

  return (
    <div className="max-w-4xl space-y-2 text-xs">
      {error && (
        <p className="rounded bg-red-500/10 px-2 py-1.5 text-red-600 dark:text-red-400">{error}</p>
      )}

      {stock.length === 0 ? (
        <p className="text-black/50 dark:text-white/50">No location assigned.</p>
      ) : (
        <table className="w-full text-left">
          <thead className="text-black/40 dark:text-white/40">
            <tr>
              <th className="py-1 pr-4 font-medium">Location</th>
              <th className="py-1 pr-4 text-right font-medium">Stock</th>
              <th className="py-1 pr-4 font-medium">Last confirmed</th>
              <th className="py-1 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {stock.map((s) => {
              const moveTargets = (locations ?? []).filter((location) => location.id !== s.locationId);
              return (
                <tr key={s.locationId} className="border-t border-black/5 dark:border-white/10">
                  <td className="py-1.5 pr-4">{s.location}</td>
                  <td
                    className={`py-1.5 pr-4 text-right tabular-nums ${editLoc === s.locationId ? "" : "cursor-cell hover:bg-blue-500/5"}`}
                    onDoubleClick={() => editLoc !== s.locationId && beginQty(s)}
                    title={editLoc === s.locationId ? undefined : "Double-click to edit quantity"}
                  >
                    {editLoc === s.locationId ? (
                      <span className="inline-flex items-center justify-end gap-1">
                        <input
                          autoFocus
                          value={draft}
                          readOnly={busy !== null}
                          inputMode="numeric"
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void commitQty(s);
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              setEditLoc(null);
                            }
                          }}
                          className={`w-20 rounded bg-white px-1 py-0.5 text-right text-black outline-none ring-1 dark:bg-neutral-900 dark:text-white ${
                            qtyErr ? "ring-red-500" : "ring-blue-500"
                          }`}
                        />
                        <button className={actionClass} disabled={busy !== null} onClick={() => commitQty(s)}>
                          Save
                        </button>
                        <button className={actionClass} disabled={busy !== null} onClick={() => setEditLoc(null)}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      s.quantity
                    )}
                  </td>
                  <td className="py-1.5 pr-4 text-black/60 dark:text-white/60">
                    {fmtDate(s.lastConfirmedAt)}
                  </td>
                  <td className="py-1.5 text-right">
                    {moveLoc === s.locationId ? (
                      <span className="inline-flex flex-wrap items-center justify-end gap-1">
                        <select
                          autoFocus
                          className="rounded border border-black/15 bg-transparent px-2 py-1 dark:border-white/20"
                          value={moveToId}
                          onChange={(e) => setMoveToId(e.target.value ? Number(e.target.value) : "")}
                          disabled={busy !== null}
                        >
                          <option value="">Move all to…</option>
                          {moveTargets.map((location) => (
                            <option key={location.id} value={location.id}>
                              {location.name}{assignedIds.has(location.id) ? " (merge)" : ""}
                            </option>
                          ))}
                        </select>
                        <button className={actionClass} disabled={busy !== null || !moveToId} onClick={() => move(s)}>
                          Move
                        </button>
                        <button
                          className={actionClass}
                          disabled={busy !== null}
                          onClick={() => {
                            setMoveLoc(null);
                            setMoveToId("");
                          }}
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <span className="inline-flex flex-wrap justify-end gap-0.5">
                        <button className={actionClass} disabled={busy !== null} onClick={() => beginQty(s)}>
                          Edit qty
                        </button>
                        <button
                          className={actionClass}
                          disabled={busy !== null || moveTargets.length === 0}
                          onClick={() => {
                            setEditLoc(null);
                            setMoveLoc(s.locationId);
                            setMoveToId("");
                          }}
                        >
                          Move
                        </button>
                        <button className={actionClass} disabled={busy !== null} onClick={() => confirm(s.locationId)}>
                          {busy === `confirm:${s.locationId}` ? "Confirming…" : "Confirm"}
                        </button>
                        <button
                          className={`${actionClass} text-red-600 dark:text-red-400`}
                          disabled={busy !== null}
                          onClick={() => remove(s)}
                        >
                          {busy === `remove:${s.locationId}` ? "Removing…" : "Remove"}
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {adding ? (
        <form className="flex flex-wrap items-center gap-2 pt-1" onSubmit={add}>
          <select
            autoFocus
            className="min-w-48 rounded border border-black/15 bg-transparent px-2 py-1.5 dark:border-white/20"
            value={addLocationId}
            onChange={(e) => setAddLocationId(e.target.value ? Number(e.target.value) : "")}
            disabled={busy !== null}
          >
            <option value="">Choose location…</option>
            {unassigned.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-black/60 dark:text-white/60">
            Qty
            <input
              className="w-24 rounded border border-black/15 bg-transparent px-2 py-1.5 text-right text-black dark:border-white/20 dark:text-white"
              inputMode="numeric"
              value={addQuantity}
              onChange={(e) => setAddQuantity(e.target.value)}
              disabled={busy !== null}
            />
          </label>
          <button className={actionClass} type="submit" disabled={busy !== null || !addLocationId}>
            {busy === "add" ? "Adding…" : "Add"}
          </button>
          <button className={actionClass} type="button" disabled={busy !== null} onClick={() => setAdding(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            className={actionClass}
            disabled={busy !== null || locations === null || unassigned.length === 0}
            onClick={() => {
              setAdding(true);
              setEditLoc(null);
              setMoveLoc(null);
              setError("");
            }}
          >
            + Add location
          </button>
          {locations !== null && unassigned.length === 0 && (
            <span className="text-black/45 dark:text-white/45">
              {locations.length === 0 ? "No locations available." : "Assigned to every location."}
            </span>
          )}
          <a className="text-black/50 underline hover:text-black dark:text-white/50 dark:hover:text-white" href="/locations">
            Manage location names
          </a>
        </div>
      )}
    </div>
  );
}

function SummaryView({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<SummaryRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await jget<SummaryRow[]>("/api/parts/summary");
        if (active) setRows(data);
      } catch (e) {
        if (active && e instanceof Error && e.message !== "locked") setError(e.message);
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshKey]);

  if (error) {
    return <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>;
  }
  if (rows === null) return <p className="text-black/50 dark:text-white/50">Loading…</p>;

  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const totalQty = rows.reduce((s, r) => s + r.quantity, 0);

  return (
    <div className="space-y-2">
      <p className="text-xs text-black/50 dark:text-white/50">All stock values are in US$.</p>
      <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/15">
      <table className="w-full text-left text-sm">
        <thead className="text-black/50 dark:text-white/50">
          <tr className="border-b border-black/10 dark:border-white/15">
            <th className="px-3 py-2 font-medium">Category</th>
            <th className="px-3 py-2 text-right font-medium">Parts</th>
            <th className="px-3 py-2 text-right font-medium">Total qty</th>
            <th className="px-3 py-2 text-right font-medium">Stock value (US$)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.category} className="border-b border-black/5 dark:border-white/10">
              <td className="px-3 py-2">{r.category}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.partCount}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.quantity}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(r.value)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-black/10 font-medium dark:border-white/15">
            <td className="px-3 py-2">Total</td>
            <td className="px-3 py-2 text-right tabular-nums">
              {rows.reduce((s, r) => s + r.partCount, 0)}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">{totalQty}</td>
            <td className="px-3 py-2 text-right tabular-nums">{money(Number(totalValue.toFixed(2)))}</td>
          </tr>
        </tfoot>
      </table>
      </div>
    </div>
  );
}

function Fab({
  open,
  onToggle,
  onAddPart,
  onAddLocation,
}: {
  open: boolean;
  onToggle: () => void;
  onAddPart: () => void;
  onAddLocation: () => void;
}) {
  const action = "flex items-center gap-2";
  const bubble = "grid h-12 w-12 place-items-center rounded-full text-white shadow-lg";
  const label =
    "rounded-md bg-black/80 px-2 py-1 text-xs text-white dark:bg-white/90 dark:text-black";
  return (
    <div className="hidden">
      <div
        className={`flex flex-col items-end gap-3 transition-all duration-200 ${
          open ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
        }`}
      >
        <button className={action} onClick={onAddLocation}>
          <span className={label}>Add location</span>
          <span className={`${bubble} bg-green-700`}>📍</span>
        </button>
        <button className={action} onClick={onAddPart}>
          <span className={label}>Add part</span>
          <span className={`${bubble} bg-blue-600`}>🧩</span>
        </button>
      </div>
      <button
        className="grid h-14 w-14 place-items-center rounded-full bg-blue-600 text-3xl leading-none text-white shadow-lg transition-transform hover:bg-blue-500"
        onClick={onToggle}
        aria-label="Add"
      >
        <span className={`transition-transform ${open ? "rotate-45" : ""}`}>+</span>
      </button>
    </div>
  );
}

function PartFormModal({
  initial,
  categories,
  onClose,
  onDone,
}: {
  initial?: CatalogRow;
  categories: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [mpn, setMpn] = useState(initial?.mpn ?? "");
  const [manufacturer, setManufacturer] = useState(initial?.manufacturer ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [supplier, setSupplier] = useState(initial?.supplier ?? "");
  const [spn, setSpn] = useState(initial?.spn ?? "");
  const [value, setValue] = useState(initial?.value ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [pkg, setPkg] = useState(initial?.package ?? "");
  const [unitCost, setUnitCost] = useState(initial?.unitCost != null ? String(initial.unitCost) : "");
  const [busy, setBusy] = useState(false);
  const [filling, setFilling] = useState(false);
  const [msg, setMsg] = useState("");

  async function autofill() {
    if (!mpn.trim()) return;
    setFilling(true);
    setMsg("");
    try {
      const r = await jget<{ offers: Offer[] }>(`/api/parts/lookup?mpn=${encodeURIComponent(mpn.trim())}`);
      const o = r.offers.find((x) => !x.mock && (x.manufacturer || x.category || x.package)) ?? r.offers[0];
      if (o && !o.mock) {
        setManufacturer(o.manufacturer || "");
        setCategory(o.category || "");
        setPkg(o.package || "");
        setDescription(o.description || "");
        setMsg(`Filled from ${o.distributor}.`);
      } else {
        setMsg("No live distributor data (add API keys for auto-fill).");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Lookup failed.");
    } finally {
      setFilling(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const cost = unitCost.trim() === "" ? null : Number(unitCost);
    if (cost !== null && !Number.isFinite(cost)) {
      setMsg("Unit cost must be a number.");
      setBusy(false);
      return;
    }
    const body = {
      mpn: mpn.trim(),
      manufacturer,
      category,
      supplier,
      spn,
      value,
      description,
      package: pkg,
      unitCost: cost,
    };
    try {
      if (initial) {
        await jpatch(`/api/parts/${initial.id}`, body);
      } else {
        await jpost("/api/parts", body);
      }
      onDone();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={initial ? "Edit part" : "Add part"} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <div className="flex gap-2">
          <input className={inputClass} placeholder="MPN" value={mpn} onChange={(e) => setMpn(e.target.value)} />
          <button
            type="button"
            className="shrink-0 rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
            onClick={autofill}
            disabled={filling || !mpn.trim()}
          >
            {filling ? "…" : "Auto-fill"}
          </button>
        </div>
        <input
          className={inputClass}
          placeholder="Category (e.g. Resistor)"
          list="category-options"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
        <datalist id="category-options">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <div className="grid grid-cols-2 gap-2">
          <input className={inputClass} placeholder="Supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          <input className={inputClass} placeholder="Supplier part # (SPN)" value={spn} onChange={(e) => setSpn(e.target.value)} />
        </div>
        <input className={inputClass} placeholder="Manufacturer" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
        <input className={inputClass} placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="grid grid-cols-3 gap-2">
          <input className={inputClass} placeholder="Value (47Ω)" value={value} onChange={(e) => setValue(e.target.value)} />
          <input className={inputClass} placeholder="Size (0603)" value={pkg} onChange={(e) => setPkg(e.target.value)} />
          <input className={inputClass} placeholder="Unit cost" inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
        </div>
        <button type="submit" className={btn} disabled={busy || !mpn.trim()}>
          {busy ? "Saving…" : initial ? "Save changes" : "Add part"}
        </button>
        {msg && <p className="text-sm text-black/70 dark:text-white/70">{msg}</p>}
      </form>
    </Modal>
  );
}

function AddLocationModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      await jpost("/api/locations", { name: name.trim() });
      onDone();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add location" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <input className={inputClass} placeholder="Location name (e.g. Drawer A3)" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className={btn} disabled={busy || !name.trim()}>
          {busy ? "Adding…" : "Add location"}
        </button>
        {msg && <p className="text-sm text-black/70 dark:text-white/70">{msg}</p>}
      </form>
    </Modal>
  );
}

function DigikeyImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [locations, setLocations] = useState<{ id: number; name: string }[]>([]);
  const [locationId, setLocationId] = useState<number | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [orderRef, setOrderRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let active = true;
    void jget<{ id: number; name: string }[]>("/api/locations")
      .then((rows) => {
        if (active) setLocations(rows);
      })
      .catch((error) => {
        if (active && error instanceof Error && error.message !== "locked") {
          setMessage(error.message);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file || !locationId) return;
    setBusy(true);
    setMessage("");
    setSuccess(false);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("locationId", String(locationId));
      if (orderRef.trim()) form.set("ref", orderRef.trim());
      const result = await jupload<{
        partTypes: number;
        createdParts: number;
        totalQuantity: number;
        skippedRows: number;
      }>("/api/stock/import-digikey", form);
      setSuccess(true);
      setMessage(
        `Received ${result.totalQuantity} item(s) across ${result.partTypes} part type(s); ` +
          `${result.createdParts} new catalog part(s)` +
          (result.skippedRows ? `, ${result.skippedRows} blank/zero row(s) skipped.` : "."),
      );
      onImported();
    } catch (error) {
      if (error instanceof Error && error.message !== "locked") setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Import DigiKey order" onClose={onClose}>
      <form onSubmit={upload} className="space-y-3">
        <p className="text-sm text-black/60 dark:text-white/60">
          Export an individual order or myLists list as CSV. Quantities are added to the selected
          stock location and recorded as receive transactions.
        </p>
        <input
          className={inputClass}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setMessage("");
            setSuccess(false);
          }}
        />
        <select
          className={inputClass}
          value={locationId}
          onChange={(event) => setLocationId(event.target.value ? Number(event.target.value) : "")}
        >
          <option value="">Receive into location…</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
        <input
          className={inputClass}
          placeholder="Order/reference number (optional)"
          value={orderRef}
          onChange={(event) => setOrderRef(event.target.value)}
        />
        {locations.length === 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Add a stock location before importing an order.
          </p>
        )}
        <button className={btn} type="submit" disabled={busy || !file || !locationId}>
          {busy ? "Importing…" : "Import and receive"}
        </button>
        {message && (
          <p
            className={`rounded-md px-3 py-2 text-sm ${
              success
                ? "bg-green-500/10 text-green-700 dark:text-green-300"
                : "bg-red-500/10 text-red-600 dark:text-red-400"
            }`}
          >
            {message}
          </p>
        )}
      </form>
    </Modal>
  );
}
