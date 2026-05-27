"use client";

import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { Nav } from "@/components/Nav";
import { Modal, btn, inputClass } from "@/components/ui";
import { jget, jpatch, jpost } from "@/lib/client";
import { useAltWheelScroll } from "@/lib/useAltWheelScroll";

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
  const [modal, setModal] = useState<"part" | "location" | null>(null);
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
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
          <div className="flex items-center gap-1 rounded-lg border border-black/10 p-0.5 text-sm dark:border-white/15">
            <button
              className={`rounded-md px-3 py-1 ${view === "inventory" ? "bg-blue-600 text-white" : "text-black/60 dark:text-white/60"}`}
              onClick={() => setView("inventory")}
            >
              Inventory
            </button>
            <button
              className={`rounded-md px-3 py-1 ${view === "summary" ? "bg-blue-600 text-white" : "text-black/60 dark:text-white/60"}`}
              onClick={() => setView("summary")}
            >
              Summary
            </button>
          </div>
        </div>

        {view === "summary" ? (
          <SummaryView refreshKey={refreshKey} />
        ) : (
          <>
            <div className="mb-3">
              <input
                className={inputClass}
                placeholder="Search MPN, SPN, name, manufacturer, category, size…"
                value={filters.q}
                onChange={set("q")}
              />
            </div>

            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <select
                className={inputClass}
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
              <input className={inputClass} placeholder="Name" value={filters.name} onChange={set("name")} />
              <input className={inputClass} placeholder="Manufacturer" value={filters.manufacturer} onChange={set("manufacturer")} />
              <input className={inputClass} placeholder="MPN" value={filters.mpn} onChange={set("mpn")} />
              <input className={inputClass} placeholder="Size (0603, TH…)" value={filters.package} onChange={set("package")} />
              <input className={inputClass} placeholder="Location" value={filters.location} onChange={set("location")} />
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
      <div ref={scrollRef} className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/15">
      <table className="w-full min-w-[72rem] text-left text-sm">
        <thead className="text-black/50 dark:text-white/50">
          <tr className="border-b border-black/10 dark:border-white/15">
            <th className="w-6 px-2 py-2" />
            <th className="px-3 py-2 font-medium">Category</th>
            <th className="px-3 py-2 font-medium">Supplier</th>
            <th className="px-3 py-2 font-medium">SPN</th>
            <th className="px-3 py-2 font-medium">Manufacturer</th>
            <th className="px-3 py-2 font-medium">MPN</th>
            <th className="px-3 py-2 font-medium">Description</th>
            <th className="px-3 py-2 font-medium">Value</th>
            <th className="px-3 py-2 text-right font-medium">Unit cost</th>
            <th className="px-3 py-2 text-right font-medium"># Loc</th>
            <th className="px-3 py-2 text-right font-medium">Total qty</th>
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
            className="rounded-md border border-black/15 px-3 py-1.5 font-medium hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            onClick={() => setVisible((v) => v + ROWS_PER_PAGE)}
          >
            Show more
          </button>
          <button
            className="rounded-md px-3 py-1.5 text-black/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10"
            onClick={() => setVisible(rows.length)}
          >
            Show all
          </button>
        </div>
      )}
    </>
  );
}

const PartRow = memo(function PartRow({
  row,
  expanded,
  onToggle,
  onEdit,
  onPatched,
  colSpan,
}: {
  row: CatalogRow;
  expanded: boolean;
  onToggle: (id: number) => void;
  onEdit: (row: CatalogRow) => void;
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
        <td className="px-3 py-2 text-right">
          {row.totalQuantity > 0 ? (
            <span className="font-medium tabular-nums">{row.totalQuantity}</span>
          ) : (
            <span className="rounded bg-black/5 px-2 py-0.5 text-xs text-black/50 dark:bg-white/10 dark:text-white/50">
              none
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{money(row.stockValue)}</td>
        <td className="px-3 py-2 text-right">
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
 * A catalog cell that turns into an inline editor on Ctrl/Cmd+click (desktop
 * only — touch has no modifier-click). Enter commits a single-field PATCH; Esc
 * or blur cancels. On success the parent updates its row locally (no refetch).
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

  function begin(e: React.MouseEvent) {
    if (!(e.ctrlKey || e.metaKey)) return; // modifier-click only; ignores plain clicks and touch
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
      title={title ?? "Ctrl+click to edit"}
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
  const [busy, setBusy] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
  const [editLoc, setEditLoc] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [savingQty, setSavingQty] = useState(false);
  const [qtyErr, setQtyErr] = useState(false);

  useEffect(() => {
    let active = true;
    fetchStock(partId)
      .then((data) => {
        if (active) setStock(data);
      })
      .catch(() => {
        if (active && !stockCache.has(partId)) setStock([]);
      });
    return () => {
      active = false;
    };
  }, [partId, reload]);

  async function confirm(locationId: number) {
    setBusy(locationId);
    try {
      await jpost(`/api/parts/${partId}/confirm`, { locationId });
      stockCache.delete(partId); // dates changed — force a fresh read
      setReload((n) => n + 1);
    } finally {
      setBusy(null);
    }
  }

  function beginQty(e: React.MouseEvent, s: StockRow) {
    if (!(e.ctrlKey || e.metaKey)) return; // modifier-click only
    e.preventDefault();
    setEditLoc(s.locationId);
    setDraft(String(s.quantity));
    setQtyErr(false);
  }

  async function commitQty(s: StockRow) {
    const n = Number(draft.trim());
    if (!Number.isInteger(n) || n < 0) {
      setQtyErr(true);
      return;
    }
    setSavingQty(true);
    setQtyErr(false);
    try {
      await jpatch(`/api/parts/${partId}/stock`, { locationId: s.locationId, quantity: n });
      const next = (stock ?? []).map((x) => (x.locationId === s.locationId ? { ...x, quantity: n } : x));
      stockCache.set(partId, next);
      setStock(next);
      // Keep the catalog row's derived totals in sync without a refetch.
      onPatched(partId, {
        totalQuantity: next.reduce((a, x) => a + x.quantity, 0),
        numLocations: next.filter((x) => x.quantity > 0).length,
      });
      setEditLoc(null);
    } catch {
      setQtyErr(true);
    } finally {
      setSavingQty(false);
    }
  }

  if (stock === null) return <p className="text-xs text-black/50 dark:text-white/50">Loading…</p>;
  if (stock.length === 0) return <p className="text-xs text-black/50 dark:text-white/50">No stock in any location.</p>;

  return (
    <table className="w-full max-w-2xl text-left text-xs">
      <thead className="text-black/40 dark:text-white/40">
        <tr>
          <th className="py-1 pr-4 font-medium">Location</th>
          <th className="py-1 pr-4 text-right font-medium">Stock</th>
          <th className="py-1 pr-4 font-medium">Last confirmed</th>
          <th className="py-1 font-medium" />
        </tr>
      </thead>
      <tbody>
        {stock.map((s) => (
          <tr key={s.locationId}>
            <td className="py-1 pr-4">{s.location}</td>
            <td className="py-1 pr-4 text-right tabular-nums">
              {editLoc === s.locationId ? (
                <input
                  autoFocus
                  value={draft}
                  readOnly={savingQty}
                  inputMode="numeric"
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => setEditLoc(null)}
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
              ) : (
                <span
                  className="cursor-cell rounded px-1 hover:bg-blue-500/10"
                  title="Ctrl+click to edit"
                  onClick={(e) => beginQty(e, s)}
                >
                  {s.quantity}
                </span>
              )}
            </td>
            <td className="py-1 pr-4 text-black/60 dark:text-white/60">{fmtDate(s.lastConfirmedAt)}</td>
            <td className="py-1">
              <button
                className="rounded px-2 py-0.5 text-blue-600 hover:bg-blue-500/10 disabled:opacity-50 dark:text-blue-400"
                onClick={() => confirm(s.locationId)}
                disabled={busy === s.locationId}
              >
                {busy === s.locationId ? "…" : "Confirm"}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
    <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3">
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
