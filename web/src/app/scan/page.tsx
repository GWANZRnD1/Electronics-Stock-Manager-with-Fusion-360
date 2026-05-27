"use client";

import { useEffect, useRef, useState } from "react";
import type { ReaderOptions } from "zxing-wasm/reader";

import { Nav } from "@/components/Nav";
import { jget, jpost } from "@/lib/client";
import { EOT, GS, RS, decodeScannedBytes, parseLabel } from "@/lib/domain/barcode";

interface Location {
  id: number;
  name: string;
}

interface Offer {
  distributor: string;
  manufacturer: string;
  description: string;
  category: string;
  package: string;
  mock: boolean;
}

// Camera track capabilities/constraints not yet in the standard DOM lib types.
type TrackCapabilities = MediaTrackCapabilities & {
  torch?: boolean;
  zoom?: { min: number; max: number; step?: number };
  focusMode?: string[];
};
type TrackConstraintSet = MediaTrackConstraintSet & {
  torch?: boolean;
  zoom?: number;
  focusMode?: string;
};
type ReaderModule = typeof import("zxing-wasm/reader");

// Request real resolution — a dense LCSC QR needs pixels to resolve its modules.
const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: "environment" },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
};
// ZXing-C++ (WASM) reader: try hard, both orientations and inverted, one symbol.
const READER_OPTIONS: ReaderOptions = {
  formats: ["QRCode", "MicroQRCode", "DataMatrix"],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  maxNumberOfSymbols: 1,
};

// Map a parsed label's distributor to the supplier label stored on the part.
const SUPPLIER_LABEL: Record<string, string> = {
  digikey: "DigiKey",
  mouser: "Mouser",
  lcsc: "LCSC",
};

/**
 * A real MPN is printable ASCII with no spaces. LCSC's "pm" is often a product
 * name (Chinese text, spaces) rather than an MPN, so those route to Name and
 * the C-code becomes the identifier instead.
 */
function looksLikeMpn(s: string): boolean {
  const t = s.trim();
  return t.length > 0 && !/\s/.test(t) && !/[^\x20-\x7e]/.test(t);
}

const inputClass =
  "w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-blue-500 dark:border-white/20";

export default function ScanPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const readerRef = useRef<ReaderModule | null>(null);
  const loopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanningRef = useRef(false);

  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false); // one-shot capture in flight
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number } | null>(null);
  const [zoom, setZoom] = useState(0);
  const [hint, setHint] = useState("");
  const [rawText, setRawText] = useState(""); // exact decoded payload (debug/verify)
  const [locations, setLocations] = useState<Location[]>([]);
  const [mpn, setMpn] = useState("");
  const [spn, setSpn] = useState("");
  const [supplier, setSupplier] = useState("");
  const [qty, setQty] = useState("");
  const [scanInfo, setScanInfo] = useState("");
  const [locationId, setLocationId] = useState<number | "">("");
  const [manual, setManual] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [pkg, setPkg] = useState("");
  const [looking, setLooking] = useState(false);

  useEffect(() => {
    let active = true;
    // The <video> node is stable for the component's lifetime; capture it so the
    // cleanup doesn't read a possibly-changed ref.
    const video = videoRef.current;
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
      // Tear down the camera without touching state (component is unmounting).
      scanningRef.current = false;
      if (loopRef.current) clearTimeout(loopRef.current);
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      (video?.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Auto-read part info (category/size/manufacturer/name) from DigiKey/Mouser by MPN.
  useEffect(() => {
    const m = mpn.trim();
    if (m.length < 3) return;
    const handle = setTimeout(() => {
      void (async () => {
        setLooking(true);
        try {
          const r = await jget<{ offers: Offer[] }>(`/api/parts/lookup?mpn=${encodeURIComponent(m)}`);
          const o = r.offers.find((x) => !x.mock && (x.manufacturer || x.category || x.package));
          if (o) {
            setManufacturer(o.manufacturer || "");
            setCategory(o.category || "");
            setPkg(o.package || "");
            setName(o.description || "");
          }
        } catch {
          /* lookup is best-effort */
        } finally {
          setLooking(false);
        }
      })();
    }, 500);
    return () => clearTimeout(handle);
  }, [mpn]);

  function applyRaw(raw: string) {
    setRawText(raw);
    try {
      const label = parseLabel(raw);
      setSpn(label.distributorPart ?? "");
      setSupplier(SUPPLIER_LABEL[label.distributor] ?? "");
      setQty(label.quantity != null ? String(label.quantity) : "");
      // LCSC's "pm" is often a product name (Chinese text, spaces), not a real
      // MPN: route it to Name and use the C-code as the identifier. A clean
      // alphanumeric pm is kept as the MPN.
      const pm = label.mpn ?? "";
      if (label.distributor === "lcsc" && pm && !looksLikeMpn(pm)) {
        setName(pm);
        setMpn(label.distributorPart ?? "");
      } else {
        setMpn(pm || (label.distributorPart ?? ""));
      }
      setScanInfo(
        `${label.distributor} · ${label.mpn ?? label.distributorPart ?? "?"}` +
          (label.quantity != null ? ` · qty ${label.quantity}` : ""),
      );
      setMsg("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not parse that code.");
    }
  }

  function scratchCanvas(): HTMLCanvasElement {
    return (canvasRef.current ??= document.createElement("canvas"));
  }

  /** Decode the current video frame with the WASM reader. Returns text or null. */
  async function decodeFrame(): Promise<string | null> {
    const reader = readerRef.current;
    const video = videoRef.current;
    if (!reader || !video) return null;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    const canvas = scratchCanvas();
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const results = await reader.readBarcodes(ctx.getImageData(0, 0, w, h), READER_OPTIONS);
    const hit = results.find((r) => r.bytes?.length || r.text);
    return hit ? decodeScannedBytes(hit.bytes, hit.text) : null;
  }

  async function scanLoop() {
    if (!scanningRef.current) return;
    try {
      const text = await decodeFrame();
      if (text) {
        applyRaw(text);
        stop();
        return;
      }
    } catch {
      /* transient decode failure (frame not ready, wasm warming up) — keep going */
    }
    if (scanningRef.current) loopRef.current = setTimeout(() => void scanLoop(), 180);
  }

  /** Wire torch/zoom/focus from the live track's capabilities. */
  async function setupTrack(track: MediaStreamTrack | undefined) {
    trackRef.current = track ?? null;
    if (!track) {
      setTorchSupported(false);
      setZoomRange(null);
      return;
    }
    const caps = track.getCapabilities?.() as TrackCapabilities | undefined;
    setTorchSupported(Boolean(caps?.torch));
    setTorchOn(false);
    // Continuous autofocus keeps a tiny code sharp as the user moves closer.
    if (caps?.focusMode?.includes("continuous")) {
      try {
        await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as TrackConstraintSet] });
      } catch {
        /* focus control is best-effort */
      }
    }
    // Zoom is the biggest lever for dense codes: crop the sensor so the code
    // fills more pixels. Start partway in and expose a slider.
    if (caps?.zoom && caps.zoom.max > caps.zoom.min) {
      const { min, max } = caps.zoom;
      const step = caps.zoom.step && caps.zoom.step > 0 ? caps.zoom.step : (max - min) / 100;
      const initial = Math.min(max, min + (max - min) * 0.4);
      setZoomRange({ min, max, step });
      setZoom(initial);
      try {
        await track.applyConstraints({ advanced: [{ zoom: initial } as TrackConstraintSet] });
      } catch {
        /* zoom control is best-effort */
      }
    } else {
      setZoomRange(null);
    }
  }

  async function onZoom(value: number) {
    setZoom(value);
    const track = trackRef.current;
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ zoom: value } as TrackConstraintSet] });
    } catch {
      /* ignore — slider stays where the user left it */
    }
  }

  async function toggleTorch() {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as TrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setError("Couldn't toggle the light on this camera.");
    }
  }

  function startHintTimer() {
    setHint("Scanning… fill the box with the code and hold steady.");
    hintTimerRef.current = setTimeout(() => {
      if (scanningRef.current) {
        setHint(
          "Still scanning — zoom in, move closer, steady your hand, turn the light on, or tap Capture for a sharp photo.",
        );
      }
    }, 6000);
  }

  async function start() {
    setError("");
    setMsg("");
    setHint("");
    // getUserMedia only exists in a secure context. Over plain HTTP on a LAN IP
    // (e.g. a phone hitting the dev server) navigator.mediaDevices is undefined,
    // so scanning fails before the reader even loads. Detect that up front.
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(
        window.isSecureContext
          ? "This browser doesn't expose a camera API. Try Chrome or Safari."
          : "Camera needs a secure (HTTPS) connection. You're on plain HTTP — a phone on the LAN can't use the camera over http://. Open the app via localhost, deploy over HTTPS, or run the dev server with `npm run dev:https`.",
      );
      return;
    }
    try {
      scanningRef.current = true;
      setScanning(true);
      setHint("Starting camera…");
      const stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play().catch(() => {});
      await setupTrack(stream.getVideoTracks()[0]);

      // ZXing-C++ via WebAssembly — strong on dense DataMatrix/QR and works on
      // iOS and Android alike. The .wasm is self-hosted from /public so there's
      // no CDN/CSP dependency; fire it immediately so it warms while we frame up.
      setHint("Loading scanner…");
      const reader = await import("zxing-wasm/reader");
      reader.prepareZXingModule({
        overrides: {
          locateFile: (path, prefix) =>
            path.endsWith(".wasm") ? "/zxing_reader.wasm" : prefix + path,
        },
        fireImmediately: true,
      });
      readerRef.current = reader;

      startHintTimer();
      void scanLoop();
    } catch (e) {
      stop();
      const detail =
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "permission denied — allow camera access in your browser settings."
          : e instanceof DOMException && e.name === "NotFoundError"
            ? "no camera found on this device."
            : e instanceof Error
              ? e.message
              : "unknown error.";
      setError(`Camera error: ${detail}`);
    }
  }

  // One-shot: grab a full-resolution still (where supported) and decode it. The
  // trick real scanner apps use for tiny dense codes the live feed can't resolve.
  async function captureDecode() {
    const reader = readerRef.current;
    if (busy || !reader) return;
    setBusy(true);
    setError("");
    setHint("Capturing a sharp photo…");
    try {
      let text: string | null = null;
      const track = trackRef.current;
      const w = window as unknown as {
        ImageCapture?: new (t: MediaStreamTrack) => { takePhoto: () => Promise<Blob> };
      };
      if (track && w.ImageCapture) {
        try {
          const blob = await new w.ImageCapture(track).takePhoto();
          const hit = (await reader.readBarcodes(blob, READER_OPTIONS)).find(
            (r) => r.bytes?.length || r.text,
          );
          text = hit ? decodeScannedBytes(hit.bytes, hit.text) : null;
        } catch {
          /* ImageCapture not usable here — fall back to a video frame */
        }
      }
      if (!text) text = await decodeFrame();
      if (text) {
        applyRaw(text);
        stop();
      } else {
        setError("No code found in that frame. Fill the box with the code, hold steady, and try again.");
        setHint("Scanning…");
      }
    } finally {
      setBusy(false);
    }
  }

  function stop() {
    scanningRef.current = false;
    if (loopRef.current) clearTimeout(loopRef.current);
    loopRef.current = null;
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (video) {
      (video.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    }
    trackRef.current = null;
    setTorchSupported(false);
    setTorchOn(false);
    setZoomRange(null);
    setZoom(0);
    setHint("");
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
        manufacturer,
        name,
        category,
        package: pkg,
        supplier,
        spn,
      });
      setMsg(`Received ${qty} × ${mpn.trim()} → on hand ${r.quantity}.`);
      setMpn("");
      setSpn("");
      setSupplier("");
      setQty("");
      setScanInfo("");
      setRawText("");
      setManufacturer("");
      setName("");
      setCategory("");
      setPkg("");
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

        <div className="relative overflow-hidden rounded-xl border border-black/10 bg-black dark:border-white/15">
          <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
          {scanning && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-2/3 w-2/3 rounded-lg border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
          )}
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
          {scanning && torchSupported && (
            <button
              className="rounded-md border border-white/20 bg-white/10 px-4 py-2 font-medium text-white"
              onClick={toggleTorch}
            >
              {torchOn ? "Light off" : "Light on"}
            </button>
          )}
        </div>

        {scanning && (
          <div className="mt-3 space-y-3">
            {zoomRange && (
              <label className="flex items-center gap-3 text-sm text-black/60 dark:text-white/60">
                <span className="w-12 shrink-0">Zoom</span>
                <input
                  type="range"
                  className="flex-1"
                  min={zoomRange.min}
                  max={zoomRange.max}
                  step={zoomRange.step}
                  value={zoom}
                  onChange={(e) => void onZoom(Number(e.target.value))}
                />
              </label>
            )}
            <button
              className="w-full rounded-md border border-black/15 px-4 py-2 text-sm font-medium disabled:opacity-50 dark:border-white/20"
              onClick={() => void captureDecode()}
              disabled={busy}
            >
              {busy ? "Reading…" : "Capture a sharp photo"}
            </button>
            {hint && <p className="text-xs text-black/60 dark:text-white/60">{hint}</p>}
          </div>
        )}

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
          {rawText && (
            <p className="select-all break-all rounded bg-black/5 px-2 py-1 font-mono text-[10px] text-black/50 dark:bg-white/5 dark:text-white/50">
              {rawText.split(GS).join("[GS]").split(RS).join("[RS]").split(EOT).join("[EOT]")}
            </p>
          )}
          <input
            className={inputClass}
            placeholder="MPN"
            value={mpn}
            onChange={(e) => setMpn(e.target.value)}
          />
          {looking && (
            <p className="text-xs text-black/50 dark:text-white/50">Reading part info…</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <input
              className={inputClass}
              placeholder="Supplier (DigiKey/LCSC…)"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
            />
            <input
              className={inputClass}
              placeholder="Supplier part # (e.g. LCSC C-code)"
              value={spn}
              onChange={(e) => setSpn(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              className={inputClass}
              placeholder="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
            <input
              className={inputClass}
              placeholder="Size (0603, TH…)"
              value={pkg}
              onChange={(e) => setPkg(e.target.value)}
            />
          </div>
          <input
            className={inputClass}
            placeholder="Manufacturer"
            value={manufacturer}
            onChange={(e) => setManufacturer(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
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
