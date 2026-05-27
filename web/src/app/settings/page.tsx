"use client";

import { useEffect, useState } from "react";

import { Nav } from "@/components/Nav";
import { Modal, btn, cardClass, inputClass } from "@/components/ui";
import { jget, jpost, jpostText } from "@/lib/client";

export default function SettingsPage() {
  const [importOpen, setImportOpen] = useState(false);

  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">
        <h1 className="mb-4 text-2xl font-semibold tracking-tight">Settings</h1>
        <div className="space-y-4">
          <section className={cardClass}>
            <h2 className="mb-1 font-medium">Import inventory CSV</h2>
            <p className="mb-3 text-sm text-black/60 dark:text-white/60">
              Bulk-load parts and stock from a CurrentInventory CSV export — optionally wiping all
              existing data first.
            </p>
            <button className={btn} onClick={() => setImportOpen(true)}>
              Import CSV…
            </button>
          </section>
          <SyncPanel />
        </div>
      </main>

      {importOpen && <ImportModal onClose={() => setImportOpen(false)} onDone={() => setImportOpen(false)} />}
    </>
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
              placeholder="Type PURGE to confirm"
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

interface SyncStatus {
  configured: boolean;
  values: number;
  costs: number;
}

interface SyncBatch {
  processed: number;
  updated: number;
  live: number;
  errors: number;
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
  const [live, setLive] = useState(0);
  const [errors, setErrors] = useState(0);
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
    setLive(0);
    setErrors(0);
    let afterId = 0;
    let sweptTotal = 0;
    let updatedTotal = 0;
    let liveTotal = 0;
    let errorsTotal = 0;
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
        liveTotal += res.live;
        errorsTotal += res.errors;
        setSwept(sweptTotal);
        setUpdated(updatedTotal);
        setLive(liveTotal);
        setErrors(errorsTotal);
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
              <span className="font-medium">Fill missing details ({status.values})</span> — value,
              category, size, manufacturer, description, and the MPN (from the supplier part # for
              DigiKey/Mouser). Looked up by MPN or supplier part #.
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
                Swept {swept}… updated {updated} (live data for {live}).
              </span>
            )}
            {done && !running && (
              <span className="text-green-700 dark:text-green-400">
                Done — swept {swept}, updated {updated}, live data for {live}
                {errors ? `, ${errors} lookup errors` : ""}.
              </span>
            )}
          </div>
          {done && !running && live === 0 && (
            <p className="mt-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              No live distributor data came back for any part — so only values derivable from existing
              descriptions could be filled. Check that the server has valid DigiKey/Mouser keys and{" "}
              <code>DIGIKEY_USE_SANDBOX=false</code> (sandbox returns no real matches), then retry.
            </p>
          )}
        </div>
      )}
      {msg && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{msg}</p>}
    </section>
  );
}
