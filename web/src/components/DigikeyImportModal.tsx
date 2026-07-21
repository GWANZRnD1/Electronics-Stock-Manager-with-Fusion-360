"use client";

import { useEffect, useState } from "react";

import { jget, jupload } from "@/lib/client";

import { Modal, btn, inputClass } from "./ui";

export function DigikeyImportModal({
  onClose,
  onImported,
  initialLocationId = "",
}: {
  onClose: () => void;
  onImported: () => void;
  initialLocationId?: number | "";
}) {
  const [locations, setLocations] = useState<{ id: number; name: string }[]>([]);
  const [locationsLoaded, setLocationsLoaded] = useState(false);
  const [locationId, setLocationId] = useState<number | "">(initialLocationId);
  const [file, setFile] = useState<File | null>(null);
  const [orderRef, setOrderRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let active = true;
    void jget<{ id: number; name: string }[]>("/api/locations")
      .then((rows) => {
        if (active) {
          setLocations(rows);
          setLocationsLoaded(true);
        }
      })
      .catch((error) => {
        if (!active) return;
        setLocationsLoaded(true);
        if (error instanceof Error && error.message !== "locked") setMessage(error.message);
      });
    return () => { active = false; };
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
      const result = await jupload<{ partTypes: number; createdParts: number; totalQuantity: number; skippedRows: number }>("/api/stock/import-digikey", form);
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
    <Modal title="Receive DigiKey order" onClose={onClose}>
      <form onSubmit={upload} className="space-y-3">
        <p className="text-sm leading-6 text-[var(--muted)]">
          Export an individual DigiKey order or myLists list as CSV. Its quantities will be added to one stock location and recorded as receiving transactions.
        </p>
        <label className="block text-sm font-medium" htmlFor="digikey-order-file">Order export</label>
        <input
          id="digikey-order-file"
          className={inputClass}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setMessage("");
            setSuccess(false);
          }}
        />
        <label className="block text-sm font-medium" htmlFor="digikey-order-location">Receive all items into</label>
        <select id="digikey-order-location" className={inputClass} value={locationId} onChange={(event) => setLocationId(event.target.value ? Number(event.target.value) : "")}>
          <option value="">{locationsLoaded ? "Choose location…" : "Loading locations…"}</option>
          {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
        <label className="block text-sm font-medium" htmlFor="digikey-order-reference">Reference <span className="font-normal text-[var(--muted)]">(optional)</span></label>
        <input id="digikey-order-reference" className={inputClass} placeholder="Order or purchase number" value={orderRef} onChange={(event) => setOrderRef(event.target.value)} />
        {locationsLoaded && locations.length === 0 && <p className="text-sm text-amber-800 dark:text-amber-300">Add a stock location before importing an order.</p>}
        <button className={`${btn} w-full`} type="submit" disabled={busy || !file || !locationId}>{busy ? "Importing…" : "Import and receive"}</button>
        {message && <p className={`rounded-lg px-3 py-2 text-sm ${success ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300"}`} role={success ? "status" : "alert"}>{message}</p>}
      </form>
    </Modal>
  );
}
