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

interface Offer {
  distributor: string;
  manufacturer: string;
  description: string;
  category: string;
  package: string;
  mock: boolean;
}

// Native Barcode Detection API (Android Chrome). Minimally typed — it isn't in
// the DOM lib yet — and feature-detected at runtime, so iOS/desktop fall back.
interface DetectedBarcode {
  rawValue: string;
  format: string;
}
interface BarcodeDetectorInstance {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): BarcodeDetectorInstance;
  getSupportedFormats(): Promise<string[]>;
}
// Torch lives on the video track but isn't in the standard MediaTrack types.
type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };
type TorchConstraintSet = MediaTrackConstraintSet & { torch?: boolean };

// A dense reel/bag DataMatrix needs real resolution to resolve.
const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: "environment" },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
};

function barcodeDetectorCtor(): BarcodeDetectorCtor | null {
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return w.BarcodeDetector ?? null;
}

const inputClass =
  "w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-blue-500 dark:border-white/20";

export default function ScanPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const loopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanningRef = useRef(false);

  const [scanning, setScanning] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [hint, setHint] = useState("");
  const [locations, setLocations] = useState<Location[]>([]);
  const [mpn, setMpn] = useState("");
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
      controlsRef.current?.stop();
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

  /** Wire torch state from the live track's capabilities, if it has a lamp. */
  function setupTorch(track: MediaStreamTrack | undefined) {
    trackRef.current = track ?? null;
    const caps = track?.getCapabilities?.() as TorchCapabilities | undefined;
    setTorchSupported(Boolean(caps?.torch));
    setTorchOn(false);
  }

  async function toggleTorch() {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as TorchConstraintSet] });
      setTorchOn(next);
    } catch {
      setError("Couldn't toggle the light on this camera.");
    }
  }

  function startHintTimer() {
    setHint("Scanning… fill the frame with the code and hold steady.");
    hintTimerRef.current = setTimeout(() => {
      if (scanningRef.current) {
        setHint(
          "Still scanning — move closer so the code fills the box, steady your hand, and turn the light on if it's glossy.",
        );
      }
    }, 6000);
  }

  // Native BarcodeDetector polling loop (Android). Stops on the first hit.
  async function runDetectorLoop(detector: BarcodeDetectorInstance, video: HTMLVideoElement) {
    if (!scanningRef.current) return;
    try {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        const codes = await detector.detect(video);
        if (codes.length > 0) {
          applyRaw(codes[0].rawValue);
          stop();
          return;
        }
      }
    } catch {
      /* transient detect failures (e.g. frame not ready) — keep polling */
    }
    loopRef.current = setTimeout(() => void runDetectorLoop(detector, video), 120);
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

      // Prefer the native Barcode Detection API where it can do DataMatrix + QR
      // (Android Chrome): hardware-accelerated and far stronger than the JS port.
      const Ctor = barcodeDetectorCtor();
      const nativeFormats = Ctor ? await Ctor.getSupportedFormats() : [];
      const useNative =
        !!Ctor && nativeFormats.includes("data_matrix") && nativeFormats.includes("qr_code");

      if (useNative && Ctor) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS });
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play().catch(() => {});
        setupTorch(stream.getVideoTracks()[0]);
        const detector = new Ctor({ formats: ["data_matrix", "qr_code"] });
        void runDetectorLoop(detector, video);
      } else {
        // Fallback: ZXing with TRY_HARDER, high resolution, and a tight retry
        // interval (the 500ms default only gives ~2 decode attempts/second).
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const { BarcodeFormat, DecodeHintType } = await import("@zxing/library");
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.DATA_MATRIX,
          BarcodeFormat.QR_CODE,
        ]);
        hints.set(DecodeHintType.TRY_HARDER, true);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100 });
        controlsRef.current = await reader.decodeFromConstraints(
          { video: VIDEO_CONSTRAINTS },
          videoRef.current!,
          (result) => {
            if (result) {
              applyRaw(result.getText());
              stop();
            }
          },
        );
        setupTorch((videoRef.current!.srcObject as MediaStream | null)?.getVideoTracks()[0]);
      }
      startHintTimer();
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

  function stop() {
    scanningRef.current = false;
    controlsRef.current?.stop();
    controlsRef.current = null;
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
      });
      setMsg(`Received ${qty} × ${mpn.trim()} → on hand ${r.quantity}.`);
      setMpn("");
      setQty("");
      setScanInfo("");
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
        {scanning && hint && (
          <p className="mt-2 text-xs text-black/60 dark:text-white/60">{hint}</p>
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
