"use client";

import { useEffect, useRef, useState } from "react";

import { Nav } from "@/components/Nav";
import { jget, jpatch, jpost, jpostText } from "@/lib/client";

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

const EMPTY: Filters = {
  q: "",
  category: "",
  name: "",
  manufacturer: "",
  mpn: "",
  package: "",
  location: "",
};

const inputClass =
  "w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-blue-500 dark:border-white/20";

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
  const [view, setView] = useState<"inventory" | "summary" | "settings">("inventory");
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [advanced, setAdvanced] = useState(false);
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [fabOpen, setFabOpen] = useState(false);
  const [modal, setModal] = useState<"part" | "location" | "import" | null>(null);
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
            <button
              className={`rounded-md px-3 py-1 ${view === "settings" ? "bg-blue-600 text-white" : "text-black/60 dark:text-white/60"}`}
              onClick={() => setView("settings")}
            >
              Settings
            </button>
          </div>
        </div>

        {view === "summary" ? (
          <SummaryView refreshKey={refreshKey} />
        ) : view === "settings" ? (
          <SettingsView onOpenImport={() => setModal("import")} />
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between gap-3">
              <input
                className={inputClass}
                placeholder="Search MPN, SPN, name, manufacturer, category, size…"
                value={filters.q}
                onChange={set("q")}
              />
              <button
                className="shrink-0 text-sm text-blue-600 hover:underline dark:text-blue-400"
                onClick={() => setAdvanced((a) => !a)}
              >
                {advanced ? "Hide" : "Advanced"}
              </button>
            </div>

            {advanced && (
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
            )}

            {error && (
              <p className="mb-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}

            <InventoryTable rows={rows} onEdit={setEditing} />
            {rows.length >= 500 && (
              <p className="mt-2 text-xs text-black/50 dark:text-white/50">
                Showing first 500 — refine the search.
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
      {modal === "import" && (
        <ImportModal
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

/**
 * Horizontally scrollable container that a mouse user can actually drive: click
 * and drag to scroll sideways (grab cursor), with fade shadows marking hidden
 * content. Shift+wheel and the native scrollbar still work; touch uses native
 * scrolling. Drags starting on a button/input are ignored so controls still click.
 */
function HScroll({
  children,
  onScrollableChange,
}: {
  children: React.ReactNode;
  onScrollableChange?: (scrollable: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startLeft: number } | null>(null);
  const moved = useRef(false);
  const [shadow, setShadow] = useState({ left: false, right: false });
  const [grabbing, setGrabbing] = useState(false);

  function update() {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setShadow({ left, right });
    onScrollableChange?.(left || right);
  }

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType !== "mouse") return; // touch/pen scroll natively
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return;
    drag.current = { startX: e.clientX, startLeft: ref.current?.scrollLeft ?? 0 };
    moved.current = false;
  }
  function onPointerMove(e: React.PointerEvent) {
    const el = ref.current;
    if (!drag.current || !el) return;
    const dx = e.clientX - drag.current.startX;
    if (!moved.current && Math.abs(dx) < 5) return; // threshold so clicks still register
    moved.current = true;
    setGrabbing(true);
    el.setPointerCapture(e.pointerId);
    el.scrollLeft = drag.current.startLeft - dx;
    e.preventDefault();
  }
  function endDrag(e: React.PointerEvent) {
    if (drag.current && moved.current) {
      try {
        ref.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may not be set */
      }
    }
    drag.current = null;
    moved.current = false;
    setGrabbing(false);
  }

  const scrollable = shadow.left || shadow.right;
  return (
    <div className="relative overflow-hidden rounded-xl border border-black/10 dark:border-white/15">
      <div
        ref={ref}
        onScroll={update}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        className={`overflow-x-auto ${scrollable ? (grabbing ? "cursor-grabbing select-none" : "cursor-grab") : ""}`}
      >
        {children}
      </div>
      {shadow.left && (
        <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-black/15 to-transparent dark:from-black/50" />
      )}
      {shadow.right && (
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-black/15 to-transparent dark:from-black/50" />
      )}
    </div>
  );
}

function InventoryTable({ rows, onEdit }: { rows: CatalogRow[]; onEdit: (r: CatalogRow) => void }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [scrollable, setScrollable] = useState(false);
  const cols = 12;
  return (
    <>
      <HScroll onScrollableChange={setScrollable}>
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
            rows.map((r) => (
              <PartRow
                key={r.id}
                row={r}
                expanded={expanded === r.id}
                onToggle={() => setExpanded((id) => (id === r.id ? null : r.id))}
                onEdit={() => onEdit(r)}
                colSpan={cols + 1}
              />
            ))
          )}
        </tbody>
      </table>
      </HScroll>
      {scrollable && (
        <p className="mt-1.5 text-xs text-black/45 dark:text-white/45">
          ↔ Drag the table sideways, or hold Shift while scrolling, to see all columns.
        </p>
      )}
    </>
  );
}

function PartRow({
  row,
  expanded,
  onToggle,
  onEdit,
  colSpan,
}: {
  row: CatalogRow;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  colSpan: number;
}) {
  return (
    <>
      <tr className="border-b border-black/5 dark:border-white/10">
        <td className="px-2 py-2">
          <button
            className="grid h-5 w-5 place-items-center rounded text-black/50 hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/10"
            onClick={onToggle}
            aria-label={expanded ? "Collapse" : "Expand locations"}
          >
            <span className={`transition-transform ${expanded ? "rotate-90" : ""}`}>▸</span>
          </button>
        </td>
        <td className="px-3 py-2">{row.category || "—"}</td>
        <td className="px-3 py-2 text-black/70 dark:text-white/70">{row.supplier || "—"}</td>
        <td className="px-3 py-2 font-mono text-xs">{row.spn || "—"}</td>
        <td className="px-3 py-2 text-black/70 dark:text-white/70">{row.manufacturer || "—"}</td>
        <td className="px-3 py-2 font-mono">{row.mpn || "—"}</td>
        <td className="max-w-xs truncate px-3 py-2 text-black/70 dark:text-white/70" title={row.description}>
          {row.description || "—"}
        </td>
        <td className="px-3 py-2">{row.value || "—"}</td>
        <td className="px-3 py-2 text-right tabular-nums">{money(row.unitCost)}</td>
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
            onClick={onEdit}
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
            <LocationDetail partId={row.id} />
          </td>
        </tr>
      )}
    </>
  );
}

function LocationDetail({ partId }: { partId: number }) {
  const [stock, setStock] = useState<StockRow[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await jget<StockRow[]>(`/api/parts/${partId}/stock`);
        if (active) setStock(data);
      } catch {
        if (active) setStock([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [partId, reload]);

  async function confirm(locationId: number) {
    setBusy(locationId);
    try {
      await jpost(`/api/parts/${partId}/confirm`, { locationId });
      setReload((n) => n + 1);
    } finally {
      setBusy(null);
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
            <td className="py-1 pr-4 text-right tabular-nums">{s.quantity}</td>
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
    <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/15">
      <table className="w-full text-left text-sm">
        <thead className="text-black/50 dark:text-white/50">
          <tr className="border-b border-black/10 dark:border-white/15">
            <th className="px-3 py-2 font-medium">Category</th>
            <th className="px-3 py-2 text-right font-medium">Parts</th>
            <th className="px-3 py-2 text-right font-medium">Total qty</th>
            <th className="px-3 py-2 text-right font-medium">Stock value</th>
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

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-black/10 bg-[var(--background)] p-5 dark:border-white/15"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">{title}</h2>
          <button className="text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const btn = "rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500 disabled:opacity-50";

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

interface ImportResult {
  parts: number;
  stockEntries: number;
  locations: number;
  totalQuantity: number;
  parseErrors?: number;
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [purge, setPurge] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  const canSubmit = file && (!purge || confirmText === "PURGE") && !busy;

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setMsg("");
    setResult(null);
    try {
      const text = await file.text();
      if (purge) {
        setMsg("Purging…");
        await jpost("/api/parts/purge", { confirm: "PURGE" });
      }
      setMsg("Importing…");
      const res = await jpostText<ImportResult>("/api/parts/import", text);
      setResult(res);
      setMsg("");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Import inventory CSV" onClose={onClose}>
      {result ? (
        <div className="space-y-3 text-sm">
          <p className="rounded-md bg-green-500/10 px-3 py-2 text-green-700 dark:text-green-400">
            Imported {result.parts} parts across {result.locations} locations · {result.stockEntries} stock
            entries · {result.totalQuantity} total units.
            {result.parseErrors ? ` (${result.parseErrors} rows had parse warnings.)` : ""}
          </p>
          <button className={btn} onClick={onDone}>
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={run} className="space-y-3 text-sm">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:text-white"
          />
          <label className="flex items-center gap-2 text-black/80 dark:text-white/80">
            <input type="checkbox" checked={purge} onChange={(e) => setPurge(e.target.checked)} />
            Wipe ALL existing inventory first (full reset — irreversible)
          </label>
          {purge && (
            <input
              className={inputClass}
              placeholder='Type PURGE to confirm'
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
            />
          )}
          <button type="submit" className={btn} disabled={!canSubmit}>
            {busy ? msg || "Working…" : purge ? "Purge & import" : "Import"}
          </button>
          {msg && !busy && <p className="text-red-600 dark:text-red-400">{msg}</p>}
        </form>
      )}
    </Modal>
  );
}

const cardClass = "rounded-xl border border-black/10 p-4 dark:border-white/15";

function SettingsView({ onOpenImport }: { onOpenImport: () => void }) {
  return (
    <div className="space-y-4">
      <section className={cardClass}>
        <h2 className="mb-1 font-medium">Import inventory CSV</h2>
        <p className="mb-3 text-sm text-black/60 dark:text-white/60">
          Bulk-load parts and stock from a CurrentInventory CSV export — optionally wiping all
          existing data first.
        </p>
        <button className={btn} onClick={onOpenImport}>
          Import CSV…
        </button>
      </section>
      <SyncPanel />
    </div>
  );
}

interface SyncStatus {
  configured: boolean;
  values: number;
  costs: number;
}

interface SyncBatch {
  processed: number;
  updated: number;
  nextAfterId: number | null;
}

/** Combined, resumable DigiKey/Mouser sync with per-operation toggles (one lookup per part). */
function SyncPanel() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [fillValues, setFillValues] = useState(true);
  const [refreshCosts, setRefreshCosts] = useState(true);
  const [running, setRunning] = useState(false);
  const [swept, setSwept] = useState(0);
  const [updated, setUpdated] = useState(0);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const s = await jget<SyncStatus>("/api/parts/sync");
        if (active) setStatus(s);
      } catch (e) {
        if (active && e instanceof Error && e.message !== "locked") setMsg(e.message);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  async function run() {
    setRunning(true);
    setMsg("");
    setDone(false);
    setSwept(0);
    setUpdated(0);
    let afterId = 0;
    let sweptTotal = 0;
    let updatedTotal = 0;
    try {
      for (;;) {
        const res = await jpost<SyncBatch>("/api/parts/sync", {
          fillValues,
          refreshCosts,
          limit: 25,
          afterId,
        });
        sweptTotal += res.processed;
        updatedTotal += res.updated;
        setSwept(sweptTotal);
        setUpdated(updatedTotal);
        if (res.nextAfterId === null) break;
        afterId = res.nextAfterId;
        await new Promise((r) => setTimeout(r, 300)); // gentle pause between batches
      }
      setDone(true);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className={cardClass}>
      <h2 className="mb-1 font-medium">Sync from distributors</h2>
      <p className="mb-3 text-sm text-black/60 dark:text-white/60">
        Look up DigiKey/Mouser parts to fill details — one lookup per part, throttled to respect API
        rate limits.
      </p>
      {status === null && !msg && <p className="text-sm text-black/50 dark:text-white/50">Loading…</p>}
      {status && !status.configured && (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          No distributor API configured. Add <code>DIGIKEY_CLIENT_ID</code>/<code>SECRET</code> (and set{" "}
          <code>DIGIKEY_USE_SANDBOX=false</code>) and/or <code>MOUSER_API_KEY</code> to{" "}
          <code>web/.env.local</code>, then restart the dev server.
        </p>
      )}
      {status?.configured && (
        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={fillValues}
              onChange={(e) => setFillValues(e.target.checked)}
              disabled={running}
            />
            <span>
              <span className="font-medium">Fill missing values ({status.values})</span> — component
              value + blank category/size, looked up by MPN or supplier part #.
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={refreshCosts}
              onChange={(e) => setRefreshCosts(e.target.checked)}
              disabled={running}
            />
            <span>
              <span className="font-medium">Refresh unit costs in USD ({status.costs})</span> —
              DigiKey/Mouser parts only; LCSC and unidentified parts are left unchanged.
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button className={btn} onClick={run} disabled={running || (!fillValues && !refreshCosts)}>
              {running ? "Syncing…" : "Run sync"}
            </button>
            {running && (
              <span className="text-black/60 dark:text-white/60">
                Swept {swept}… updated {updated}.
              </span>
            )}
            {done && !running && (
              <span className="text-green-700 dark:text-green-400">
                Done — swept {swept}, updated {updated}.
              </span>
            )}
          </div>
        </div>
      )}
      {msg && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{msg}</p>}
    </section>
  );
}
