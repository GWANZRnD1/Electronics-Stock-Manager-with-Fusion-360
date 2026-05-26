"use client";

import type { IScannerControls } from "@zxing/browser";
import { useEffect, useRef, useState } from "react";

import { Nav } from "@/components/Nav";
import { jget, jpost } from "@/lib/client";
import { parseLabel } from "@/lib/domain/barcode";

interface Location {
  id: number;
  name: string;
}

const inputClass =
  "w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-blue-500 dark:border-white/20";

export default function ScanPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);

  const [scanning, setScanning] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [mpn, setMpn] = useState("");
  const [qty, setQty] = useState("");
  const [scanInfo, setScanInfo] = useState("");
  const [locationId, setLocationId] = useState<number | "">("");
  const [manual, setManual] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const locs = await jget<Location[]>("/api/locations");
        if (active) setLocations(locs);
      } catch (e) {
        if (active && e instanceof Error && e.message !== "locked") setError(e.message);
      }
    })();
    return () => {
      active = false;
      controlsRef.current?.stop();
    };
  }, []);

  function applyRaw(raw: string) {
    try {
      const label = parseLabel(raw);
      setMpn(label.mpn ?? label.distributorPart ?? "");
      setQty(label.quantity != null ? String(label.quantity) : "");
      setScanInfo(
        `${label.distributor} · ${label.mpn ?? label.distributorPart ?? "?"}` +
          (label.quantity != null ? ` · qty ${label.quantity}` : ""),
      );
      setMsg("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not parse that code.");
    }
  }

  async function start() {
    setError("");
    setMsg("");
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const { BarcodeFormat, DecodeHintType } = await import("@zxing/library");
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.DATA_MATRIX, BarcodeFormat.QR_CODE]);
      const reader = new BrowserMultiFormatReader(hints);
      setScanning(true);
      controlsRef.current = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } } },
        videoRef.current!,
        (result) => {
          if (result) {
            applyRaw(result.getText());
            stop();
          }
        },
      );
    } catch (e) {
      setScanning(false);
      setError(
        e instanceof Error ? `Camera error: ${e.message}` : "Camera unavailable (needs HTTPS).",
      );
    }
  }

  function stop() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScanning(false);
  }

  async function receive(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    try {
      const r = await jpost<{ quantity: number }>("/api/stock/receive", {
        mpn: mpn.trim(),
        locationId: Number(locationId),
        quantity: Number(qty),
      });
      setMsg(`Received ${qty} × ${mpn.trim()} → on hand ${r.quantity}.`);
      setMpn("");
      setQty("");
      setScanInfo("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Receive failed.");
    }
  }

  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-lg flex-1 p-4 sm:p-6">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Scan &amp; receive</h1>
        <p className="mb-4 text-sm text-black/60 dark:text-white/60">
          Point the camera at a reel/bag barcode (DigiKey/Mouser DataMatrix or LCSC QR), then
          choose a location and receive it.
        </p>

        {error && (
          <p className="mb-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {msg && (
          <p className="mb-3 rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
            {msg}
          </p>
        )}

        <div className="overflow-hidden rounded-xl border border-black/10 bg-black dark:border-white/15">
          <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
        </div>
        <div className="mt-3 flex gap-2">
          {scanning ? (
            <button
              className="flex-1 rounded-md bg-black/80 px-4 py-2 font-medium text-white"
              onClick={stop}
            >
              Stop camera
            </button>
          ) : (
            <button
              className="flex-1 rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500"
              onClick={start}
            >
              Start camera
            </button>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            className={inputClass}
            placeholder="…or paste/scan barcode text here"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
          <button
            className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
            onClick={() => manual.trim() && applyRaw(manual.trim())}
          >
            Parse
          </button>
        </div>

        <form
          onSubmit={receive}
          className="mt-5 space-y-3 rounded-xl border border-black/10 p-4 dark:border-white/15"
        >
          <h2 className="font-medium">Receive</h2>
          {scanInfo && (
            <p className="text-sm text-black/60 dark:text-white/60">Scanned: {scanInfo}</p>
          )}
          <input
            className={inputClass}
            placeholder="MPN"
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
            inputMode="numeric"
            placeholder="Quantity"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <button
            type="submit"
            className="w-full rounded-md bg-green-700 px-4 py-2 font-medium text-white hover:bg-green-600 disabled:opacity-50"
            disabled={!mpn.trim() || !locationId || !qty}
          >
            Receive into stock
          </button>
          {locations.length === 0 && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Add a location first (Inventory tab).
            </p>
          )}
        </form>
      </main>
    </>
  );
}
