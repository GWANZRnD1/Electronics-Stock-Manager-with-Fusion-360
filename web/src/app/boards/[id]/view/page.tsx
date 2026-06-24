"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReaderOptions } from "zxing-wasm/reader";

import { Nav } from "@/components/Nav";
import { jget, jput, jupload } from "@/lib/client";
import { decodeScannedBytes, parseLabel } from "@/lib/domain/barcode";

// ---------------------------------------------------------------------------
// Types (mirror the API shapes)
// ---------------------------------------------------------------------------
type Side = "top" | "bottom";

interface BomRow {
  id: number;
  partMpn: string | null;
  value: string;
  package: string;
  designators: string;
  qtyPerBoard: number;
}

interface Placement {
  id: number;
  designator: string;
  x: number;
  y: number;
  angle: number;
  side: Side;
  package: string;
  mpn: string | null;
}

interface Outline {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface CalPoint {
  frac: { x: number; y: number };
  mm: { x: number; y: number };
}

interface ImageInfo {
  side: Side;
  width: number;
  height: number;
  calibration: [CalPoint, CalPoint] | null;
}

interface Bundle {
  outline: Outline | null;
  placements: Placement[];
  images: ImageInfo[];
}

// ---------------------------------------------------------------------------
// Coordinate mapping: board mm -> image fraction (0..1). Uses a manual 2-point
// calibration when present, otherwise auto-crop (image == board outline bbox).
// ---------------------------------------------------------------------------
function makeMapper(
  side: Side,
  outline: Outline | null,
  cal: [CalPoint, CalPoint] | null,
): ((x: number, y: number) => { fx: number; fy: number }) | null {
  if (cal && cal.length === 2) {
    const [a, b] = cal;
    const dmx = a.mm.x - b.mm.x;
    const dmy = a.mm.y - b.mm.y;
    const ax = dmx !== 0 ? (a.frac.x - b.frac.x) / dmx : 0;
    const ay = dmy !== 0 ? (a.frac.y - b.frac.y) / dmy : 0;
    const bx = a.frac.x - ax * a.mm.x;
    const by = a.frac.y - ay * a.mm.y;
    return (x, y) => ({ fx: ax * x + bx, fy: ay * y + by });
  }
  if (!outline) return null;
  const w = outline.maxX - outline.minX;
  const h = outline.maxY - outline.minY;
  if (w <= 0 || h <= 0) return null;
  return (x, y) => ({
    fx: side === "bottom" ? (outline.maxX - x) / w : (x - outline.minX) / w,
    fy: (outline.maxY - y) / h,
  });
}

const norm = (s: string) => s.trim().toUpperCase();
const splitDesignators = (s: string): string[] =>
  s.split(/[\s,]+/).map((d) => d.trim()).filter(Boolean);

const btn =
  "rounded-md border border-black/15 px-2.5 py-1 text-sm hover:bg-black/[0.03] disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/[0.04]";

// ===========================================================================
// Page
// ===========================================================================
export default function BoardViewPage() {
  const { id } = useParams<{ id: string }>();
  const [boardName, setBoardName] = useState("");
  const [boardRev, setBoardRev] = useState("");
  const [bom, setBom] = useState<BomRow[]>([]);
  const [bundle, setBundle] = useState<Bundle>({ outline: null, placements: [], images: [] });
  const [side, setSide] = useState<Side>("top");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Selection: highlighted designators (uppercase) + a label for the header.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionLabel, setSelectionLabel] = useState("");

  // BOM list controls.
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<"designators" | "partMpn" | "value" | "package" | "qtyPerBoard">(
    "designators",
  );
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  // Calibration + scanning UI.
  const [calStep, setCalStep] = useState<0 | 1 | 2>(0); // 0 off, 1 click first, 2 click second
  const calRefsRef = useRef<{ a?: CalPoint; b?: CalPoint }>({});
  const gerberRef = useRef<HTMLInputElement>(null);
  const [calTargets, setCalTargets] = useState<[Placement, Placement] | null>(null);
  const [scanOpen, setScanOpen] = useState(false);

  const reloadBundle = useCallback(async () => {
    const b = await jget<Bundle>(`/api/boards/${id}/placements`);
    setBundle(b);
  }, [id]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [boardList, bomRows, b] = await Promise.all([
          jget<{ id: number; name: string; revision: string }[]>("/api/boards"),
          jget<BomRow[]>(`/api/boards/${id}/bom`),
          jget<Bundle>(`/api/boards/${id}/placements`),
        ]);
        if (!active) return;
        const me = boardList.find((x) => String(x.id) === String(id));
        setBoardName(me?.name ?? `Board ${id}`);
        setBoardRev(me?.revision ?? "");
        setBom(bomRows);
        setBundle(b);
        // Default to whichever side has an image / placements.
        if (!b.images.some((im) => im.side === "top") && b.images.some((im) => im.side === "bottom")) {
          setSide("bottom");
        }
      } catch (e) {
        if (active && e instanceof Error && e.message !== "locked") setError(e.message);
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  // designator (uppercase) -> the BOM row that lists it.
  const designatorToBom = useMemo(() => {
    const m = new Map<string, BomRow>();
    for (const row of bom) for (const d of splitDesignators(row.designators)) m.set(norm(d), row);
    return m;
  }, [bom]);

  const image = bundle.images.find((im) => im.side === side) ?? null;
  const outline = bundle.outline;
  const mapper = useMemo(
    () => makeMapper(side, outline, image?.calibration ?? null),
    [side, outline, image],
  );

  const placementsThisSide = useMemo(
    () => bundle.placements.filter((p) => p.side === side),
    [bundle.placements, side],
  );

  // Selecting a designator set: highlight + jump to the side that shows most of them.
  const selectDesignators = useCallback(
    (designators: string[], label: string) => {
      const set = new Set(designators.map(norm));
      setSelected(set);
      setSelectionLabel(label);
      const onTop = bundle.placements.filter((p) => p.side === "top" && set.has(norm(p.designator))).length;
      const onBottom = bundle.placements.filter(
        (p) => p.side === "bottom" && set.has(norm(p.designator)),
      ).length;
      if (onBottom > onTop) setSide("bottom");
      else if (onTop > 0) setSide("top");
    },
    [bundle.placements],
  );

  const selectBomRow = useCallback(
    (row: BomRow) => {
      selectDesignators(splitDesignators(row.designators), row.partMpn || row.value || "part");
    },
    [selectDesignators],
  );

  // Click a placement dot -> select its whole BOM line (or just that part).
  const selectPlacement = useCallback(
    (p: Placement) => {
      const row = designatorToBom.get(norm(p.designator));
      if (row) selectBomRow(row);
      else selectDesignators([p.designator], p.designator);
    },
    [designatorToBom, selectBomRow, selectDesignators],
  );

  // Resolve a scanned MPN to designators and highlight them.
  const highlightByMpn = useCallback(
    (mpn: string) => {
      const m = norm(mpn);
      const rows = bom.filter((r) => r.partMpn && norm(r.partMpn) === m);
      const designators = rows.length
        ? rows.flatMap((r) => splitDesignators(r.designators))
        : bundle.placements.filter((p) => p.mpn && norm(p.mpn) === m).map((p) => p.designator);
      if (designators.length === 0) {
        setError(`Scanned ${mpn} — not on this board's BOM.`);
        return false;
      }
      setError("");
      selectDesignators(designators, mpn);
      return true;
    },
    [bom, bundle.placements, selectDesignators],
  );

  // --- Image upload -------------------------------------------------------
  async function uploadImage(file: File, forSide: Side) {
    setBusy(true);
    setError("");
    try {
      const dims = await imageDimensions(file);
      const form = new FormData();
      form.set("file", file);
      form.set("side", forSide);
      form.set("width", String(dims.w));
      form.set("height", String(dims.h));
      await jupload(`/api/boards/${id}/image`, form);
      await reloadBundle();
      setSide(forSide);
    } catch (e) {
      if (e instanceof Error && e.message !== "locked") setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Render top/bottom from a Gerber zip — auto-aligned (no calibration needed).
  async function uploadGerber(file: File) {
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      const r = await jupload<{ sides: Side[] }>(`/api/boards/${id}/image/gerber`, form);
      await reloadBundle();
      if (r.sides.length) setSide(r.sides.includes(side) ? side : r.sides[0]);
    } catch (e) {
      if (e instanceof Error && e.message !== "locked") setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeImage(forSide: Side) {
    if (!window.confirm(`Remove the ${forSide} board image?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/boards/${id}/image?side=${forSide}`, { method: "DELETE" });
      await reloadBundle();
    } finally {
      setBusy(false);
    }
  }

  // --- Calibration --------------------------------------------------------
  function startCalibration() {
    if (placementsThisSide.length < 2) {
      setError("Need at least two placed components on this side to calibrate.");
      return;
    }
    // Pick two well-separated reference components (max span on each axis).
    const byX = [...placementsThisSide].sort((a, b) => a.x - b.x);
    const byY = [...placementsThisSide].sort((a, b) => a.y - b.y);
    const a = byX[0];
    const b = byX[byX.length - 1].id !== a.id ? byX[byX.length - 1] : byY[byY.length - 1];
    calRefsRef.current = {};
    setCalTargets([a, b]);
    setCalStep(1);
    setSelected(new Set([norm(a.designator)]));
    setSelectionLabel(`Calibrate: click ${a.designator}`);
  }

  async function handleCalibrationClick(frac: { x: number; y: number }) {
    if (!calTargets) return;
    if (calStep === 1) {
      calRefsRef.current.a = { frac, mm: { x: calTargets[0].x, y: calTargets[0].y } };
      setCalStep(2);
      setSelected(new Set([norm(calTargets[1].designator)]));
      setSelectionLabel(`Calibrate: click ${calTargets[1].designator}`);
    } else if (calStep === 2) {
      calRefsRef.current.b = { frac, mm: { x: calTargets[1].x, y: calTargets[1].y } };
      const { a, b } = calRefsRef.current;
      if (a && b) {
        setBusy(true);
        try {
          await jput(`/api/boards/${id}/image/calibration`, { side, calibration: [a, b] });
          await reloadBundle();
          setSelectionLabel("Alignment calibrated ✓");
        } catch (e) {
          if (e instanceof Error && e.message !== "locked") setError(e.message);
        } finally {
          setBusy(false);
        }
      }
      setCalStep(0);
      setCalTargets(null);
      setSelected(new Set());
    }
  }

  async function clearCalibration() {
    setBusy(true);
    try {
      await jput(`/api/boards/${id}/image/calibration`, { side, calibration: null });
      await reloadBundle();
    } finally {
      setBusy(false);
    }
  }

  // --- BOM list (filter + sort) ------------------------------------------
  const filteredBom = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? bom.filter((r) =>
          [r.partMpn ?? "", r.value, r.package, r.designators].some((f) =>
            f.toLowerCase().includes(q),
          ),
        )
      : bom;
    const sorted = [...rows].sort((a, b) => {
      if (sortKey === "qtyPerBoard") return (a.qtyPerBoard - b.qtyPerBoard) * sortDir;
      const av = (a[sortKey] ?? "") as string;
      const bv = (b[sortKey] ?? "") as string;
      return av.localeCompare(bv, undefined, { numeric: true }) * sortDir;
    });
    return sorted;
  }, [bom, query, sortKey, sortDir]);

  function toggleSort(key: typeof sortKey) {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(1);
    }
  }

  const hasTop = bundle.images.some((im) => im.side === "top");
  const hasBottom = bundle.images.some((im) => im.side === "bottom");
  const placedCount = placementsThisSide.length;

  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Link href={`/boards/${id}`} className="text-sm text-blue-600 hover:underline dark:text-blue-400">
            ← {boardName || "Board"}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Assembly view</h1>
          {boardRev && (
            <span className="text-base text-black/50 dark:text-white/50">{boardRev}</span>
          )}
        </div>
        <p className="mb-4 text-sm text-black/60 dark:text-white/60">
          Click a BOM part to highlight it on the board, or scan a component&rsquo;s barcode. Import
          placements with <code>extract-placements.ulp</code> (Board editor) and upload top/bottom
          pictures below.
        </p>

        {error && (
          <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        {!outline && bundle.placements.length === 0 && (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
            No placements imported yet. In Fusion, run <code>extract-placements.ulp</code> from the
            Board editor, then import the <code>.json</code> on the{" "}
            <Link href={`/boards/${id}`} className="text-blue-600 underline dark:text-blue-400">
              board page
            </Link>
            . You can still upload pictures below.
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          {/* Board viewer */}
          <section>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <div className="flex overflow-hidden rounded-md border border-black/15 dark:border-white/20">
                {(["top", "bottom"] as Side[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSide(s)}
                    className={`px-3 py-1 text-sm capitalize ${
                      side === s ? "bg-blue-600 text-white" : "hover:bg-black/5 dark:hover:bg-white/10"
                    }`}
                  >
                    {s}
                    {(s === "top" ? hasTop : hasBottom) ? "" : " (no image)"}
                  </button>
                ))}
              </div>
              <span className="text-xs text-black/50 dark:text-white/50">
                {placedCount} part(s) this side
              </span>
              <button className={btn} onClick={() => setScanOpen(true)}>
                Scan barcode
              </button>
              {image && (
                <>
                  <button className={btn} disabled={busy} onClick={startCalibration}>
                    {image.calibration ? "Re-calibrate" : "Calibrate"}
                  </button>
                  {image.calibration && (
                    <button className={btn} disabled={busy} onClick={clearCalibration}>
                      Clear calibration
                    </button>
                  )}
                </>
              )}
            </div>

            {selectionLabel && (
              <p className="mb-2 text-sm">
                <span className="text-black/50 dark:text-white/50">Selected: </span>
                <span className="font-medium">{selectionLabel}</span>{" "}
                <button
                  className="text-blue-600 underline dark:text-blue-400"
                  onClick={() => {
                    setSelected(new Set());
                    setSelectionLabel("");
                  }}
                >
                  clear
                </button>
              </p>
            )}

            <BoardCanvas
              key={side}
              boardId={Number(id)}
              side={side}
              hasImage={Boolean(image)}
              mapper={mapper}
              placements={placementsThisSide}
              selected={selected}
              calibrating={calStep > 0}
              onPlacementClick={selectPlacement}
              onImageClick={calStep > 0 ? handleCalibrationClick : undefined}
            />

            {/* Upload controls */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                className="rounded-md bg-blue-600 px-2.5 py-1 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                disabled={busy}
                onClick={() => gerberRef.current?.click()}
              >
                {busy ? "Working…" : "Upload Gerber zip (auto-align)"}
              </button>
              <input
                ref={gerberRef}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) uploadGerber(f);
                }}
              />
              <span className="text-xs text-black/40 dark:text-white/40">
                renders top + bottom, aligned automatically
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <ImageUploader label={hasTop ? "Replace top image" : "Upload top image"} side="top" busy={busy} onPick={uploadImage} />
              {hasTop && (
                <button className={btn} disabled={busy} onClick={() => removeImage("top")}>
                  Remove top
                </button>
              )}
              <ImageUploader
                label={hasBottom ? "Replace bottom image" : "Upload bottom image"}
                side="bottom"
                busy={busy}
                onPick={uploadImage}
              />
              {hasBottom && (
                <button className={btn} disabled={busy} onClick={() => removeImage("bottom")}>
                  Remove bottom
                </button>
              )}
            </div>
          </section>

          {/* BOM list */}
          <section className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <input
                className="w-full rounded-md border border-black/15 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-white/20"
                placeholder="Filter by MPN, value, package, designator…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <p className="mb-1 text-xs text-black/45 dark:text-white/45">
              {filteredBom.length} of {bom.length} line(s)
            </p>
            <div className="max-h-[70vh] overflow-auto rounded-lg border border-black/10 dark:border-white/15">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-[var(--background)] text-black/50 dark:text-white/50">
                  <tr className="border-b border-black/10 dark:border-white/15">
                    {([
                      ["partMpn", "Part"],
                      ["value", "Value"],
                      ["package", "Pkg"],
                      ["qtyPerBoard", "Qty"],
                      ["designators", "Designators"],
                    ] as [typeof sortKey, string][]).map(([key, label]) => (
                      <th
                        key={key}
                        className="cursor-pointer select-none px-2 py-2 font-medium hover:text-black dark:hover:text-white"
                        onClick={() => toggleSort(key)}
                      >
                        {label}
                        {sortKey === key ? (sortDir === 1 ? " ▲" : " ▼") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredBom.map((row) => {
                    const isSel =
                      selected.size > 0 &&
                      splitDesignators(row.designators).some((d) => selected.has(norm(d)));
                    return (
                      <tr
                        key={row.id}
                        onClick={() => selectBomRow(row)}
                        className={`cursor-pointer border-b border-black/5 dark:border-white/10 ${
                          isSel ? "bg-blue-500/15" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                        }`}
                      >
                        <td className="px-2 py-1.5 font-mono">{row.partMpn || "—"}</td>
                        <td className="px-2 py-1.5">{row.value}</td>
                        <td className="px-2 py-1.5">{row.package}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{row.qtyPerBoard}</td>
                        <td className="px-2 py-1.5 text-xs text-black/60 dark:text-white/60">
                          {row.designators}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredBom.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-2 py-6 text-center text-black/40 dark:text-white/40">
                        {bom.length === 0 ? "No BOM imported for this board." : "No matches."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>

      {scanOpen && (
        <BarcodeScanModal
          onClose={() => setScanOpen(false)}
          onDetect={(raw) => {
            try {
              const label = parseLabel(raw);
              const mpn = label.mpn || label.distributorPart || raw;
              const ok = highlightByMpn(mpn);
              if (ok) setScanOpen(false);
            } catch {
              setError("Could not parse that code.");
            }
          }}
        />
      )}
    </>
  );
}

// ===========================================================================
// Board canvas: zoom/pan image + highlight overlay
// ===========================================================================
function BoardCanvas({
  boardId,
  side,
  hasImage,
  mapper,
  placements,
  selected,
  calibrating,
  onPlacementClick,
  onImageClick,
}: {
  boardId: number;
  side: Side;
  hasImage: boolean;
  mapper: ((x: number, y: number) => { fx: number; fy: number }) | null;
  placements: Placement[];
  selected: Set<string>;
  calibrating: boolean;
  onPlacementClick: (p: Placement) => void;
  onImageClick?: (frac: { x: number; y: number }) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);

  // Wheel zoom toward the cursor (non-passive so we can preventDefault).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => {
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const scale = Math.min(20, Math.max(0.2, v.scale * factor));
        const k = scale / v.scale;
        return { scale, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
    setView((v) => ({ ...v, tx: drag.current!.tx + dx, ty: drag.current!.ty + dy }));
  }
  function onPointerUp() {
    drag.current = null;
  }

  // Click on the image surface (used only in calibration mode).
  function onSurfaceClick(e: React.MouseEvent) {
    if (drag.current?.moved) return;
    if (!onImageClick || !imgRef.current) return;
    const r = imgRef.current.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    if (fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1) onImageClick({ x: fx, y: fy });
  }

  const reset = () => setView({ scale: 1, tx: 0, ty: 0 });

  return (
    <div className="relative">
      <div className="absolute right-2 top-2 z-10 flex gap-1">
        <button
          className="rounded bg-black/50 px-2 py-0.5 text-sm text-white"
          onClick={() => setView((v) => ({ ...v, scale: Math.min(20, v.scale * 1.25) }))}
        >
          +
        </button>
        <button
          className="rounded bg-black/50 px-2 py-0.5 text-sm text-white"
          onClick={() => setView((v) => ({ ...v, scale: Math.max(0.2, v.scale / 1.25) }))}
        >
          −
        </button>
        <button className="rounded bg-black/50 px-2 py-0.5 text-xs text-white" onClick={reset}>
          Fit
        </button>
      </div>

      <div
        ref={viewportRef}
        className={`relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-black/10 bg-neutral-100 dark:border-white/15 dark:bg-neutral-900 ${
          calibrating ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onClick={onSurfaceClick}
      >
        {!hasImage && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-black/40 dark:text-white/40">
            No {side} image uploaded. {mapper ? "Highlights still work on the placement grid below." : ""}
          </div>
        )}
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}
        >
          <div className="relative inline-block">
            {hasImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={imgRef}
                src={`/api/boards/${boardId}/image?side=${side}`}
                alt={`${side} of board`}
                draggable={false}
                className="block max-w-none select-none"
                style={{ width: "900px", height: "auto" }}
              />
            ) : (
              // No image: render a neutral board-sized rectangle so dots have a surface.
              <div ref={imgRef as unknown as React.RefObject<HTMLDivElement>} style={{ width: 900, height: 675 }} />
            )}

            {/* Highlight overlay */}
            {mapper &&
              placements.map((p) => {
                const { fx, fy } = mapper(p.x, p.y);
                if (!Number.isFinite(fx) || !Number.isFinite(fy)) return null;
                const isSel = selected.has(norm(p.designator));
                return (
                  <button
                    key={p.id}
                    title={`${p.designator}${p.mpn ? ` · ${p.mpn}` : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!calibrating) onPlacementClick(p);
                    }}
                    className="absolute"
                    style={{
                      left: `${fx * 100}%`,
                      top: `${fy * 100}%`,
                      transform: `translate(-50%, -50%) scale(${1 / view.scale})`,
                    }}
                  >
                    <span
                      className={`block rounded-full border ${
                        isSel
                          ? "h-4 w-4 border-white bg-red-500 shadow-[0_0_0_2px_rgba(239,68,68,0.5)]"
                          : "h-2.5 w-2.5 border-white/80 bg-blue-500/70 hover:bg-blue-400"
                      }`}
                    />
                    {isSel && (
                      <span className="pointer-events-none absolute left-1/2 top-full -translate-x-1/2 whitespace-nowrap rounded bg-red-600 px-1 text-[10px] font-medium text-white">
                        {p.designator}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        </div>
      </div>
      <p className="mt-1 text-xs text-black/40 dark:text-white/40">
        Scroll to zoom · drag to pan · click a dot to select.
      </p>
    </div>
  );
}

// ===========================================================================
// Image uploader button
// ===========================================================================
function ImageUploader({
  label,
  side,
  busy,
  onPick,
}: {
  label: string;
  side: Side;
  busy: boolean;
  onPick: (file: File, side: Side) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className={btn} disabled={busy} onClick={() => ref.current?.click()}>
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onPick(f, side);
        }}
      />
    </>
  );
}

// ===========================================================================
// Barcode scan modal (camera + ZXing-WASM, reuses the barcode parser)
// ===========================================================================
const READER_OPTIONS: ReaderOptions = {
  formats: ["QRCode", "MicroQRCode", "DataMatrix"],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  maxNumberOfSymbols: 1,
};

function BarcodeScanModal({
  onClose,
  onDetect,
}: {
  onClose: () => void;
  onDetect: (raw: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const readerRef = useRef<typeof import("zxing-wasm/reader") | null>(null);
  const loopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const [hint, setHint] = useState("Starting camera…");

  const stop = useCallback(() => {
    runningRef.current = false;
    if (loopRef.current) clearTimeout(loopRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setHint("Camera needs an HTTPS connection (or localhost).");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play().catch(() => {});
        const reader = await import("zxing-wasm/reader");
        reader.prepareZXingModule({
          overrides: {
            locateFile: (path, prefix) =>
              path.endsWith(".wasm") ? "/zxing_reader.wasm" : prefix + path,
          },
          fireImmediately: true,
        });
        readerRef.current = reader;
        runningRef.current = true;
        setHint("Point at the component's QR / DataMatrix label.");
        void loop();
      } catch {
        setHint("Couldn't open the camera.");
      }
    })();

    async function loop() {
      if (!runningRef.current) return;
      try {
        const reader = readerRef.current;
        const video = videoRef.current;
        if (reader && video && video.videoWidth) {
          const canvas = (canvasRef.current ??= document.createElement("canvas"));
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(video, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const hit = (await reader.readBarcodes(img, READER_OPTIONS)).find(
              (r) => r.bytes?.length || r.text,
            );
            if (hit) {
              const raw = decodeScannedBytes(hit.bytes, hit.text);
              onDetect(raw);
              return;
            }
          }
        }
      } catch {
        /* keep scanning */
      }
      if (runningRef.current) loopRef.current = setTimeout(() => void loop(), 180);
    }

    return () => {
      active = false;
      stop();
    };
  }, [onDetect, stop]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-black/10 bg-[var(--background)] p-5 sm:rounded-2xl dark:border-white/15"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Scan a component</h2>
          <button className="text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="overflow-hidden rounded-xl border border-black/10 bg-black dark:border-white/15">
          <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
        </div>
        <p className="mt-2 text-xs text-black/60 dark:text-white/60">{hint}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
async function imageDimensions(file: File): Promise<{ w: number; h: number }> {
  try {
    const bmp = await createImageBitmap(file);
    const dims = { w: bmp.width, h: bmp.height };
    bmp.close();
    return dims;
  } catch {
    return { w: 0, h: 0 };
  }
}
