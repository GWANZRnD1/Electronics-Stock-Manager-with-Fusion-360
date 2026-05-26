"use client";

import { useEffect, useState } from "react";

import { Nav } from "@/components/Nav";
import { jget, jpost } from "@/lib/client";

interface CatalogRow {
  id: number;
  category: string;
  name: string;
  manufacturer: string;
  mpn: string;
  package: string;
  stock: number;
  locations: string;
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

export default function Home() {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [advanced, setAdvanced] = useState(false);
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [fabOpen, setFabOpen] = useState(false);
  const [modal, setModal] = useState<"part" | "location" | null>(null);

  useEffect(() => {
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
  }, [filters, refreshKey]);

  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFilters((f) => ({ ...f, [k]: e.target.value }));

  const refresh = () => setRefreshKey((k) => k + 1);

  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
          <button
            className="text-sm text-blue-600 hover:underline dark:text-blue-400"
            onClick={() => setAdvanced((a) => !a)}
          >
            {advanced ? "Hide advanced search" : "Advanced search"}
          </button>
        </div>

        <input
          className={`${inputClass} mb-3`}
          placeholder="Search MPN, name, manufacturer, category, size…"
          value={filters.q}
          onChange={set("q")}
        />

        {advanced && (
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <input className={inputClass} placeholder="Category" value={filters.category} onChange={set("category")} />
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

        <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/15">
          <table className="w-full text-left text-sm">
            <thead className="text-black/50 dark:text-white/50">
              <tr className="border-b border-black/10 dark:border-white/15">
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Manufacturer</th>
                <th className="px-3 py-2 font-medium">MPN</th>
                <th className="px-3 py-2 font-medium">Size</th>
                <th className="px-3 py-2 font-medium">Location</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-black/60 dark:text-white/60" colSpan={7}>
                    No parts. Use the + button to add one, or sync your Fusion library.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-black/5 dark:border-white/10">
                    <td className="px-3 py-2">{r.category || "—"}</td>
                    <td className="px-3 py-2">{r.name || "—"}</td>
                    <td className="px-3 py-2 text-black/70 dark:text-white/70">{r.manufacturer || "—"}</td>
                    <td className="px-3 py-2 font-mono">{r.mpn}</td>
                    <td className="px-3 py-2">{r.package || "—"}</td>
                    <td className="px-3 py-2 text-black/70 dark:text-white/70">{r.locations || "—"}</td>
                    <td className="px-3 py-2 text-right">
                      {r.stock > 0 ? (
                        <span className="font-medium tabular-nums">{r.stock}</span>
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
        {rows.length >= 500 && (
          <p className="mt-2 text-xs text-black/50 dark:text-white/50">
            Showing first 500 — refine the search.
          </p>
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
        <AddPartModal
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
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

function AddPartModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [mpn, setMpn] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [pkg, setPkg] = useState("");
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
        setName(o.description || "");
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
    try {
      await jpost("/api/parts", {
        mpn: mpn.trim(),
        manufacturer,
        name,
        category,
        package: pkg,
      });
      onDone();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add part" onClose={onClose}>
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
        <input className={inputClass} placeholder="Category (e.g. Resistor)" value={category} onChange={(e) => setCategory(e.target.value)} />
        <input className={inputClass} placeholder="Name (e.g. RES 47Ω 1% 0603)" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={inputClass} placeholder="Manufacturer" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
        <input className={inputClass} placeholder="Size / package (0603, SOIC-14, TH…)" value={pkg} onChange={(e) => setPkg(e.target.value)} />
        <button type="submit" className={btn} disabled={busy || !mpn.trim()}>
          {busy ? "Saving…" : "Add part"}
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
