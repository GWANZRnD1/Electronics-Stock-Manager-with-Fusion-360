"use client";

import { useCallback, useEffect, useState } from "react";

import { Nav } from "@/components/Nav";

interface Location {
  id: number;
  name: string;
  description: string;
}

interface StockRow {
  partId: number;
  mpn: string;
  manufacturer: string;
  locationId: number;
  location: string;
  quantity: number;
}

async function jget<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (res.status === 401) {
    window.location.href = "/unlock";
    throw new Error("locked");
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function jpost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    window.location.href = "/unlock";
    throw new Error("locked");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

async function fetchData(): Promise<{ locations: Location[]; stock: StockRow[] }> {
  const [locations, stock] = await Promise.all([
    jget<Location[]>("/api/locations"),
    jget<StockRow[]>("/api/stock"),
  ]);
  return { locations, stock };
}

export default function Home() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const data = await fetchData();
      setLocations(data.locations);
      setStock(data.stock);
    } catch (e) {
      if (e instanceof Error && e.message !== "locked") setError(e.message);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await fetchData();
        if (active) {
          setLocations(data.locations);
          setStock(data.stock);
        }
      } catch (e) {
        if (active && e instanceof Error && e.message !== "locked") setError(e.message);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-5xl flex-1 p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Electronics Stock Manager</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Inventory for Fusion 360 PCB projects.
        </p>
      </header>

      {error && (
        <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <ReceiveCard locations={locations} onDone={reload} />
        <LocationCard onDone={reload} />
      </div>

      <StockTable rows={stock} />
      </main>
    </>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-black/10 p-5 dark:border-white/15">
      <h2 className="mb-3 font-medium">{title}</h2>
      {children}
    </section>
  );
}

const inputClass =
  "w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-blue-500 dark:border-white/20";
const btnClass =
  "rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500 disabled:opacity-50";

function ReceiveCard({ locations, onDone }: { locations: Location[]; onDone: () => void }) {
  const [mpn, setMpn] = useState("");
  const [locationId, setLocationId] = useState<number | "">("");
  const [quantity, setQuantity] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      await jpost("/api/stock/receive", {
        mpn: mpn.trim(),
        locationId: Number(locationId),
        quantity: Number(quantity),
      });
      setMsg(`Received ${quantity} × ${mpn.trim()}.`);
      setMpn("");
      setQuantity("");
      onDone();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Receive stock">
      {locations.length === 0 ? (
        <p className="text-sm text-black/60 dark:text-white/60">Add a location first →</p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <input
            className={inputClass}
            placeholder="MPN (e.g. MCP2221A-I/SL)"
            value={mpn}
            onChange={(e) => setMpn(e.target.value)}
          />
          <select
            className={inputClass}
            value={locationId}
            onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">Select location…</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <input
            className={inputClass}
            type="number"
            min={1}
            placeholder="Quantity"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          <button
            type="submit"
            className={btnClass}
            disabled={busy || !mpn.trim() || !locationId || !quantity}
          >
            {busy ? "Receiving…" : "Receive"}
          </button>
          {msg && <p className="text-sm text-black/70 dark:text-white/70">{msg}</p>}
        </form>
      )}
    </Card>
  );
}

function LocationCard({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      await jpost("/api/locations", { name: name.trim() });
      setMsg(`Added "${name.trim()}".`);
      setName("");
      onDone();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Add location">
      <form onSubmit={submit} className="space-y-3">
        <input
          className={inputClass}
          placeholder="Location name (e.g. Drawer A3)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className={btnClass} disabled={busy || !name.trim()}>
          {busy ? "Adding…" : "Add location"}
        </button>
        {msg && <p className="text-sm text-black/70 dark:text-white/70">{msg}</p>}
      </form>
    </Card>
  );
}

function StockTable({ rows }: { rows: StockRow[] }) {
  return (
    <section className="mt-6 rounded-xl border border-black/10 p-5 dark:border-white/15">
      <h2 className="mb-3 font-medium">Current stock ({rows.length})</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-black/60 dark:text-white/60">No stock yet. Receive some above.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-black/50 dark:text-white/50">
              <tr className="border-b border-black/10 dark:border-white/15">
                <th className="py-2 pr-4 font-medium">MPN</th>
                <th className="py-2 pr-4 font-medium">Manufacturer</th>
                <th className="py-2 pr-4 font-medium">Location</th>
                <th className="py-2 pr-4 text-right font-medium">Qty</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.partId}-${r.locationId}`}
                  className="border-b border-black/5 dark:border-white/10"
                >
                  <td className="py-2 pr-4 font-mono">{r.mpn}</td>
                  <td className="py-2 pr-4 text-black/70 dark:text-white/70">
                    {r.manufacturer || "—"}
                  </td>
                  <td className="py-2 pr-4">{r.location}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{r.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
