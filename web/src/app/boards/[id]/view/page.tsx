"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReaderOptions } from "zxing-wasm/reader";

import { Nav } from "@/components/Nav";
import { StockEditorModal } from "@/components/StockEditor";
import { Modal } from "@/components/ui";
import { jget, jpost, jput, jupload } from "@/lib/client";
import { decodeScannedBytes, parseLabel } from "@/lib/domain/barcode";
import { normalizePartIdentifier as normalizePartIdentifierForDisplay } from "@/lib/domain/jellybeanMatch";
import { isKeyboardInput } from "@/lib/keyboard";

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
  // Enriched from the catalog (via ?detail=1); absent until that fetch resolves.
  manufacturer?: string;
  supplier?: string;
  spn?: string; // supplier part number, e.g. the DigiKey code
  unitCost?: string | null;
  onHand?: number;
  resolvedPartId?: number | null;
  resolvedMpn?: string | null;
  matchType?: "explicit" | "exact" | "compatible" | "unmatched";
  matchNotes?: string[];
  projectQuantity?: number;
  stockLocations?: {
    locationId: number;
    location: string;
    quantity: number;
    projectLocation: boolean;
    lastConfirmedAt: string | null;
  }[];
  alternatives?: {
    id: number;
    mpn: string;
    onHand: number;
    projectQuantity: number;
    stockLocations: {
      locationId: number;
      location: string;
      quantity: number;
      projectLocation: boolean;
      lastConfirmedAt: string | null;
    }[];
  }[];
}

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
const countDesignators = (s: string): number => splitDesignators(s).length;

// A distributor product link for a supplier part number, when we recognise the
// supplier; otherwise null (we just show the code as text).
function supplierUrl(supplier: string, spn: string): string | null {
  if (!spn) return null;
  const s = supplier.toLowerCase();
  if (s.includes("digikey") || s.includes("digi-key"))
    return `https://www.digikey.com/en/products/result?keywords=${encodeURIComponent(spn)}`;
  if (s.includes("mouser"))
    return `https://www.mouser.com/c/?q=${encodeURIComponent(spn)}`;
  if (s.includes("lcsc"))
    return `https://www.lcsc.com/search?q=${encodeURIComponent(spn)}`;
  return null;
}

function verificationLabel(value: string | null): string {
  if (!value) return "never verified";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "verification unknown";
  return `verified ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date)}`;
}

// Per-board "populated" build progress lives in localStorage (a workshop session
// state, not catalog data) — keyed by board id, storing the populated BOM line ids.
const populatedKey = (boardId: string) => `ecsm:populated:${boardId}`;
function loadPopulated(boardId: string): Set<number> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(populatedKey(boardId));
    return new Set(raw ? (JSON.parse(raw) as number[]) : []);
  } catch {
    return new Set();
  }
}
const btn =
  "min-h-11 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium hover:bg-[var(--surface-subtle)] disabled:opacity-50";

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
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  // Bumped on every bundle reload so the board <img> URL changes after an
  // upload/calibration/delete and the browser refetches the new bytes
  // (the GET is cache-control: max-age=60 on a fixed URL otherwise).
  const [imgVersion, setImgVersion] = useState(0);

  // Selection: highlighted designators (uppercase) + a label for the header.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusedDesignator, setFocusedDesignator] = useState<string | null>(null);
  const [selectionLabel, setSelectionLabel] = useState("");
  const [scanNotes, setScanNotes] = useState<string[]>([]);
  // The BOM line whose detail card is shown (set when a single line is selected).
  const [detailRow, setDetailRow] = useState<BomRow | null>(null);
  const [stockEditorRow, setStockEditorRow] = useState<BomRow | null>(null);
  const [mobilePane, setMobilePane] = useState<"board" | "parts">("parts");
  const [mobileDetailExpanded, setMobileDetailExpanded] = useState(false);

  // Build progress: which BOM lines are populated (persisted per board locally).
  const [populated, setPopulated] = useState<Set<number>>(new Set());
  const populatedRef = useRef<Set<number>>(new Set());
  const progressQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [progressReady, setProgressReady] = useState(false);
  const [hidePopulated, setHidePopulated] = useState(false);
  const [consumeMsg, setConsumeMsg] = useState("");
  const [consuming, setConsuming] = useState(false);

  // BOM list controls.
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<
    "designators" | "partMpn" | "value" | "package" | "qtyPerBoard" | "side"
  >("designators");
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
    setImgVersion((v) => v + 1);
  }, [id]);

  const reloadBom = useCallback(async () => {
    const rows = await jget<BomRow[]>(`/api/boards/${id}/bom?detail=1`);
    setBom(rows);
    return rows;
  }, [id]);

  // Load this board's saved populated set once on mount (client-only — read from
  // localStorage after hydration to avoid an SSR/client mismatch).
  const applyProgress = useCallback((lineIds: number[]) => {
    const next = new Set(lineIds);
    populatedRef.current = next;
    setPopulated(next);
  }, []);

  // Requests from this tab stay ordered. The server also serializes writes for
  // the same user and board across multiple tabs and devices.
  const persistProgress = useCallback(
    (lineIds: number[], on: boolean) => {
      const run = progressQueueRef.current.then(async () => {
        try {
          await jput(`/api/boards/${id}/progress`, { lineIds, populated: on });
        } catch (reason) {
          const latest = await jget<{ lineIds: number[] }>(`/api/boards/${id}/progress`);
          applyProgress(latest.lineIds);
          setConsumeMsg(
            reason instanceof Error
              ? `Progress was refreshed after a sync problem: ${reason.message}`
              : "Progress was refreshed after a sync problem.",
          );
        }
      });
      progressQueueRef.current = run.catch(() => undefined);
    },
    [applyProgress, id],
  );

  const togglePopulated = useCallback(
    (rowId: number) => {
      if (!progressReady) return;
      const next = new Set(populatedRef.current);
      const on = !next.has(rowId);
      if (on) next.add(rowId);
      else next.delete(rowId);
      populatedRef.current = next;
      setPopulated(next);
      persistProgress([rowId], on);
    },
    [persistProgress, progressReady],
  );

  const setManyPopulated = useCallback(
    (rowIds: number[], on: boolean) => {
      if (!progressReady) return;
      const next = new Set(populatedRef.current);
      for (const rowId of rowIds) {
        if (on) next.add(rowId);
        else next.delete(rowId);
      }
      populatedRef.current = next;
      setPopulated(next);
      persistProgress(rowIds, on);
    },
    [persistProgress, progressReady],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [boardList, bomRows, b, progress] = await Promise.all([
          jget<{ id: number; name: string; revision: string }[]>("/api/boards"),
          jget<BomRow[]>(`/api/boards/${id}/bom?detail=1`),
          jget<Bundle>(`/api/boards/${id}/placements`),
          jget<{ lineIds: number[]; user: { name: string; isRoot: boolean } }>(
            `/api/boards/${id}/progress`,
          ),
        ]);
        if (!active) return;
        const me = boardList.find((x) => String(x.id) === String(id));
        setBoardName(me?.name ?? `Board ${id}`);
        setBoardRev(me?.revision ?? "");
        setBom(bomRows);
        setBundle(b);
        let progressIds = progress.lineIds;
        if (progress.user.isRoot) {
          const validIds = new Set(bomRows.map((row) => row.id));
          const legacyIds = [...loadPopulated(String(id))].filter((lineId) => validIds.has(lineId));
          const missing = legacyIds.filter((lineId) => !progressIds.includes(lineId));
          if (missing.length > 0) {
            const imported = await jput<{ lineIds: number[] }>(`/api/boards/${id}/progress`, {
              lineIds: missing,
              populated: true,
            });
            progressIds = imported.lineIds;
          }
          window.localStorage.removeItem(populatedKey(String(id)));
        }
        if (!active) return;
        applyProgress(progressIds);
        setProgressReady(true);
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
  }, [applyProgress, id]);

  // designator (uppercase) -> the BOM row that lists it.
  const designatorToBom = useMemo(() => {
    const m = new Map<string, BomRow>();
    for (const row of bom) for (const d of splitDesignators(row.designators)) m.set(norm(d), row);
    return m;
  }, [bom]);

  // designator (uppercase) -> which side it's placed on (from the placements).
  const designatorSide = useMemo(() => {
    const m = new Map<string, Side>();
    for (const p of bundle.placements) m.set(norm(p.designator), p.side);
    return m;
  }, [bundle.placements]);

  // A BOM line's side label, aggregated over its designators' placements.
  const sideLabel = useCallback(
    (row: BomRow): string => {
      let top = false;
      let bottom = false;
      for (const d of splitDesignators(row.designators)) {
        const s = designatorSide.get(norm(d));
        if (s === "top") top = true;
        else if (s === "bottom") bottom = true;
      }
      if (top && bottom) return "Both";
      if (top) return "Top";
      if (bottom) return "Bottom";
      return "—";
    },
    [designatorSide],
  );

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
    (designators: string[], label: string, preferredSide?: Side) => {
      const set = new Set(designators.map(norm));
      setSelected(set);
      setSelectionLabel(label);
      if (preferredSide) {
        setSide(preferredSide);
        return;
      }
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
    (row: BomRow, focus?: Placement) => {
      setScanNotes([]);
      setDetailRow(row);
      setMobileDetailExpanded(false);
      setFocusedDesignator(focus?.designator ?? null);
      setMobilePane("board");
      selectDesignators(
        splitDesignators(row.designators),
        row.partMpn || row.value || "part",
        focus?.side,
      );
    },
    [selectDesignators],
  );

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setSelectionLabel("");
    setScanNotes([]);
    setDetailRow(null);
    setMobileDetailExpanded(false);
    setFocusedDesignator(null);
  }, []);

  // Click a placement dot -> select its whole BOM line (or just that part).
  const selectPlacement = useCallback(
    (p: Placement) => {
      const row = designatorToBom.get(norm(p.designator));
      if (row) selectBomRow(row, p);
      else {
        setFocusedDesignator(p.designator);
        selectDesignators([p.designator], p.designator, p.side);
      }
    },
    [designatorToBom, selectBomRow, selectDesignators],
  );

  // Fast local exact-MPN path; the stock-aware API below handles real labels
  // that correspond to a generic resistor/capacitor BOM descriptor.
  const highlightExactMpn = useCallback(
    (mpn: string) => {
      const m = norm(mpn);
      const rows = bom.filter((r) => r.partMpn && norm(r.partMpn) === m);
      const designators = rows.length
        ? rows.flatMap((r) => splitDesignators(r.designators))
        : bundle.placements.filter((p) => p.mpn && norm(p.mpn) === m).map((p) => p.designator);
      if (designators.length === 0) return false;
      setError("");
      setScanNotes([]);
      setFocusedDesignator(null);
      setMobileDetailExpanded(false);
      setDetailRow(rows.length === 1 ? rows[0] : null);
      selectDesignators(designators, mpn);
      return true;
    },
    [bom, bundle.placements, selectDesignators],
  );

  const identifyScan = useCallback(
    async (raw: string): Promise<boolean> => {
      try {
        const label = parseLabel(raw);
        const identifiers = [
          label.mpn,
          label.distributorPart,
          label.labelFormat === "bare" ? raw : null,
        ].filter((value): value is string => Boolean(value?.trim()));
        const display = identifiers[0] ?? raw;

        if (identifiers.some((identifier) => highlightExactMpn(identifier))) return true;

        const result = await jpost<{
          matches: {
            lineId: number;
            designators: string;
            resolvedMpn: string | null;
            matchType: "label" | "electrical";
            matchNotes: string[];
          }[];
        }>(`/api/boards/${id}/identify`, { identifiers });
        if (result.matches.length === 0) {
          setScanNotes([]);
          setError(`Scanned ${display} — not on this board's BOM.`);
          return false;
        }

        const rowIds = new Set(result.matches.map((match) => match.lineId));
        const rows = bom.filter((row) => rowIds.has(row.id));
        const designators = result.matches.flatMap((match) =>
          splitDesignators(match.designators),
        );
        setError("");
        setFocusedDesignator(null);
        setMobileDetailExpanded(false);
        setDetailRow(rows.length === 1 ? rows[0] : null);
        const compatible = result.matches.some((match) => match.matchType === "electrical");
        setScanNotes([
          ...new Set(result.matches.flatMap((match) => match.matchNotes ?? [])),
        ]);
        selectDesignators(
          designators,
          compatible ? `${display} · compatible jellybean` : display,
        );
        return true;
      } catch (e) {
        setScanNotes([]);
        setError(e instanceof Error ? e.message : "Could not identify that code.");
        return false;
      }
    },
    [bom, highlightExactMpn, id, selectDesignators],
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

  // Render top/bottom from a Gerber zip. The server returns the SVGs; we
  // rasterize each to a compact WebP in the browser (keeps the server under its
  // memory limit), upload it, and set the render's mm bbox as calibration.
  async function uploadGerber(file: File) {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const form = new FormData();
      form.set("file", file);
      const r = await jupload<{
        renders: { side: Side; svg: string; mmBbox: Outline }[];
        placements: number;
        ignored?: string[];
        classification?: { file: string; type: string | null; side: string | null; rendered: boolean }[];
      }>(`/api/boards/${id}/image/gerber`, form);

      for (const ren of r.renders) {
        const ras = await rasterizeSvg(ren.svg);
        const f = new FormData();
        const ext = ras.blob.type === "image/webp" ? "webp" : "png";
        f.set("file", new File([ras.blob], `${ren.side}.${ext}`, { type: ras.blob.type }));
        f.set("side", ren.side);
        f.set("width", String(ras.width));
        f.set("height", String(ras.height));
        await jupload(`/api/boards/${id}/image`, f);
        await jput(`/api/boards/${id}/image/calibration`, {
          side: ren.side,
          calibration: bboxToCalibration(ren.side, ren.mmBbox),
        });
      }

      await reloadBundle();
      const sides = r.renders.map((x) => x.side);
      if (sides.length) setSide(sides.includes(side) ? side : sides[0]);
      setInfo(
        `Rendered ${sides.join(" + ")}.` +
          (r.placements
            ? ` Imported ${r.placements} placements from the pick-and-place file.`
            : " No pick-and-place file in the zip — import placements with extract-board.ulp to enable highlighting.") +
          (r.ignored?.length ? ` Skipped (not part of the picture): ${r.ignored.join(", ")}.` : ""),
      );
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

  // --- Build progress (qty-weighted across BOM lines) --------------------
  const progress = useMemo(() => {
    let totalParts = 0;
    let doneParts = 0;
    let doneLines = 0;
    for (const r of bom) {
      const n = countDesignators(r.designators) || r.qtyPerBoard || 0;
      totalParts += n;
      if (populated.has(r.id)) {
        doneParts += n;
        doneLines += 1;
      }
    }
    return {
      totalLines: bom.length,
      doneLines,
      totalParts,
      doneParts,
      pct: totalParts > 0 ? Math.round((doneParts / totalParts) * 100) : 0,
    };
  }, [bom, populated]);

  async function consumeCompletedBoard() {
    const resolved = [...new Set(bom.map((row) => row.resolvedMpn).filter(Boolean))] as string[];
    if (resolved.length === 0) {
      setConsumeMsg("No BOM lines are matched to inventory stock yet.");
      return;
    }
    if (
      !window.confirm(
        `Consume stock for one completed ${boardName || "board"}? This will deduct ${resolved.length} matched part type(s).`,
      )
    ) {
      return;
    }

    setConsuming(true);
    setConsumeMsg("");
    try {
      const response = await fetch(`/api/boards/${id}/build`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quantity: 1, parts: resolved }),
      });
      if (response.status === 401) {
        window.location.href = "/unlock";
        return;
      }
      const result = (await response.json().catch(() => ({}))) as {
        consumed?: { mpn: string; qty: number }[];
        shortages?: { mpn: string; required: number; available: number }[];
        error?: string;
      };
      if (response.status === 409 && result.shortages?.length) {
        setConsumeMsg(
          "Not enough stock: " +
            result.shortages
              .map((item) => `${item.mpn} (need ${item.required}, have ${item.available})`)
              .join(", "),
        );
        return;
      }
      if (!response.ok) throw new Error(result.error ?? "Could not consume stock.");

      const refreshed = await jget<BomRow[]>(`/api/boards/${id}/bom?detail=1`);
      setBom(refreshed);
      applyProgress([]);
      setConsumeMsg(
        `Stock consumed for one board (${result.consumed?.length ?? 0} matched part type(s)); progress reset for the next board.`,
      );
    } catch (e) {
      setConsumeMsg(e instanceof Error ? e.message : "Could not consume stock.");
    } finally {
      setConsuming(false);
    }
  }

  // --- BOM list (filter + sort) ------------------------------------------
  const filteredBom = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = q
      ? bom.filter((r) =>
          [
            r.partMpn ?? "",
            r.resolvedMpn ?? "",
            r.value,
            r.package,
            r.designators,
            r.spn ?? "",
            ...(r.stockLocations ?? []).map((location) => location.location),
          ].some((f) =>
            f.toLowerCase().includes(q),
          ),
        )
      : bom;
    if (hidePopulated) rows = rows.filter((r) => !populated.has(r.id));
    const sorted = [...rows].sort((a, b) => {
      if (sortKey === "qtyPerBoard") return (a.qtyPerBoard - b.qtyPerBoard) * sortDir;
      const av = sortKey === "side" ? sideLabel(a) : ((a[sortKey] ?? "") as string);
      const bv = sortKey === "side" ? sideLabel(b) : ((b[sortKey] ?? "") as string);
      return av.localeCompare(bv, undefined, { numeric: true }) * sortDir;
    });
    return sorted;
  }, [bom, query, sortKey, sortDir, sideLabel, hidePopulated, populated]);

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

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isKeyboardInput(event.target) ||
        document.querySelector('[role="dialog"][aria-modal="true"]')
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "escape") {
        if (calStep > 0) {
          event.preventDefault();
          setCalStep(0);
          setCalTargets(null);
          calRefsRef.current = {};
          clearSelection();
        } else if (mobileDetailExpanded) {
          event.preventDefault();
          setMobileDetailExpanded(false);
        } else if (detailRow || selected.size > 0) {
          event.preventDefault();
          clearSelection();
        } else if (mobilePane === "board") {
          event.preventDefault();
          setMobilePane("parts");
        }
        return;
      }

      if ((key === "j" || key === "k") && filteredBom.length > 0) {
        event.preventDefault();
        const current = detailRow ? filteredBom.findIndex((row) => row.id === detailRow.id) : -1;
        const next = current < 0
          ? (key === "j" ? 0 : filteredBom.length - 1)
          : (current + (key === "j" ? 1 : -1) + filteredBom.length) % filteredBom.length;
        const row = filteredBom[next];
        selectBomRow(row);
        window.requestAnimationFrame(() => {
          const matches = [...document.querySelectorAll<HTMLElement>(`[data-bom-row-id="${row.id}"]`)];
          matches.find((element) => element.offsetParent !== null)?.scrollIntoView({ block: "nearest" });
        });
        return;
      }

      if (event.code === "Space" && detailRow) {
        event.preventDefault();
        togglePopulated(detailRow.id);
        return;
      }

      if (key === "t" || key === "b") {
        event.preventDefault();
        setSide(key === "t" ? "top" : "bottom");
        setMobilePane("board");
        return;
      }

      if (key === "s") {
        event.preventDefault();
        setScanOpen(true);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    calStep,
    clearSelection,
    detailRow,
    filteredBom,
    mobileDetailExpanded,
    mobilePane,
    selectBomRow,
    selected.size,
    togglePopulated,
  ]);

  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Link href={`/boards/${id}`} className="inline-flex min-h-11 items-center text-sm text-blue-600 hover:underline dark:text-blue-400">
            ← {boardName || "Board"}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Assembly view</h1>
          {boardRev && (
            <span className="text-base text-black/50 dark:text-white/50">{boardRev}</span>
          )}
          <Link className={`${btn} ml-auto inline-flex items-center`} href={`/stocktake?board=${id}&return=${encodeURIComponent(`/boards/${id}/view`)}`}>
            Stocktake before build
          </Link>
        </div>
        <p className="mb-4 text-sm text-black/60 dark:text-white/60">
          Select a BOM part to find it on the board, or scan the component in your hand. Progress is saved to your account.
        </p>

        <div className="mb-4 grid grid-cols-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 lg:hidden" aria-label="Assembly workspace">
          <button className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${mobilePane === "parts" ? "bg-blue-700 text-white dark:bg-blue-400 dark:text-slate-950" : "text-[var(--muted)]"}`} onClick={() => setMobilePane("parts")}>Parts list</button>
          <button className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${mobilePane === "board" ? "bg-blue-700 text-white dark:bg-blue-400 dark:text-slate-950" : "text-[var(--muted)]"}`} onClick={() => setMobilePane("board")}>Board view</button>
        </div>

        {error && (
          <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {info && (
          <p className="mb-4 rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
            {info}
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
          <section className={`${mobilePane === "board" ? "block" : "hidden"} lg:block`}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <div className="flex overflow-hidden rounded-md border border-black/15 dark:border-white/20">
                {(["top", "bottom"] as Side[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSide(s)}
                    aria-keyshortcuts={s === "top" ? "T" : "B"}
                    title={`${s === "top" ? "Top" : "Bottom"} side (${s === "top" ? "T" : "B"})`}
                    className={`min-h-11 px-3 py-2 text-sm capitalize ${
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
              <button className={btn} onClick={() => setScanOpen(true)} aria-keyshortcuts="S" title="Scan barcode (S)">
                Scan barcode
              </button>
            </div>

            {selectionLabel && (
              <>
                <p className="mb-2 text-sm">
                  <span className="text-black/50 dark:text-white/50">Selected: </span>
                  <span className="font-medium">{selectionLabel}</span>{" "}
                  <button className="text-blue-600 underline dark:text-blue-400" onClick={clearSelection}>
                    clear
                  </button>
                </p>
                {scanNotes.length > 0 && (
                  <div className="mb-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                    <p className="font-medium">Scanned jellybean reminders</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {scanNotes.map((note) => <li key={note}>{note}</li>)}
                    </ul>
                  </div>
                )}
              </>
            )}

            <BoardCanvas
              boardId={Number(id)}
              side={side}
              imgVersion={imgVersion}
              hasTop={hasTop}
              hasBottom={hasBottom}
              mapper={mapper}
              placements={placementsThisSide}
              selected={selected}
              focusedDesignator={focusedDesignator}
              calibrating={calStep > 0}
              onPlacementClick={selectPlacement}
              onImageClick={calStep > 0 ? handleCalibrationClick : undefined}
            />

            {detailRow && (
              <div
                className={`assembly-detail-sheet fixed inset-x-3 z-50 rounded-xl bg-[var(--surface)] shadow-2xl sm:left-auto sm:right-4 sm:w-96 lg:hidden ${
                  mobileDetailExpanded ? "max-h-[52dvh] overflow-y-auto" : ""
                }`}
                aria-live="polite"
              >
                {mobileDetailExpanded ? (
                  <ComponentCard
                    row={detailRow}
                    side={sideLabel(detailRow)}
                    count={countDesignators(detailRow.designators)}
                    populated={populated.has(detailRow.id)}
                    onTogglePopulated={() => togglePopulated(detailRow.id)}
                    onManageStock={detailRow.resolvedPartId ? () => setStockEditorRow(detailRow) : undefined}
                    onClose={() => setMobileDetailExpanded(false)}
                  />
                ) : (
                  <MobileComponentPeek
                    row={detailRow}
                    side={sideLabel(detailRow)}
                    count={countDesignators(detailRow.designators)}
                    populated={populated.has(detailRow.id)}
                    onTogglePopulated={() => togglePopulated(detailRow.id)}
                    onExpand={() => setMobileDetailExpanded(true)}
                    onManageStock={detailRow.resolvedPartId ? () => setStockEditorRow(detailRow) : undefined}
                    onClose={clearSelection}
                  />
                )}
              </div>
            )}

            <details className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Board image &amp; alignment setup</summary>
              <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                className={btn}
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
              {image && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
                  <button className={btn} disabled={busy} onClick={startCalibration}>{image.calibration ? "Re-calibrate image" : "Calibrate image"}</button>
                  {image.calibration && <button className={btn} disabled={busy} onClick={clearCalibration}>Clear calibration</button>}
                </div>
              )}
            </details>
          </section>

          {/* BOM list */}
          <section className={`${mobilePane === "parts" ? "block" : "hidden"} min-w-0 lg:block`}>
            {/* Build progress */}
            <ProgressBar progress={progress} />
            {progress.totalParts > 0 && progress.doneParts === progress.totalParts && (
              <div className="mb-3 rounded-lg border border-green-500/30 bg-green-500/[0.06] p-3">
                <button
                  className="rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-50"
                  disabled={consuming}
                  onClick={() => void consumeCompletedBoard()}
                >
                  {consuming ? "Consuming stock…" : "Consume stock for this board"}
                </button>
                <p className="mt-1 text-xs text-black/55 dark:text-white/55">
                  Deducts one board&rsquo;s matched parts from inventory and records a reversible build.
                </p>
              </div>
            )}
            {consumeMsg && (
              <p className="mb-3 rounded-md bg-black/[0.04] px-3 py-2 text-sm text-black/70 dark:bg-white/[0.05] dark:text-white/70">
                {consumeMsg}
              </p>
            )}

            {/* Selected component detail card */}
            {detailRow && (
              <ComponentCard
                row={detailRow}
                side={sideLabel(detailRow)}
                count={countDesignators(detailRow.designators)}
                populated={populated.has(detailRow.id)}
                onTogglePopulated={() => togglePopulated(detailRow.id)}
                onManageStock={detailRow.resolvedPartId ? () => setStockEditorRow(detailRow) : undefined}
                onClose={clearSelection}
              />
            )}

            {/* Filter */}
            <div className="mb-2 flex items-center gap-2">
              <input
                data-shortcut-search
                aria-keyshortcuts="/"
                className="min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
                placeholder="Filter by MPN, value, package, designator, DigiKey…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            {/* Count + bulk actions */}
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-black/55 dark:text-white/55">
              <span>
                {filteredBom.length} of {bom.length} line(s)
              </span>
              <label className="flex min-h-11 cursor-pointer select-none items-center gap-1.5">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={hidePopulated}
                  onChange={(e) => setHidePopulated(e.target.checked)}
                />
                Hide populated
              </label>
              <button
                className="min-h-11 text-blue-600 hover:underline disabled:opacity-40 dark:text-blue-400"
                disabled={filteredBom.length === 0}
                onClick={() => setManyPopulated(filteredBom.map((r) => r.id), true)}
              >
                Mark shown done
              </button>
              <button
                className="min-h-11 text-blue-600 hover:underline disabled:opacity-40 dark:text-blue-400"
                disabled={progress.doneLines === 0}
                onClick={() => {
                  if (window.confirm("Reset build progress for this board?"))
                    setManyPopulated(bom.map((r) => r.id), false);
                }}
              >
                Reset all
              </button>
            </div>

            <ul className="space-y-2 sm:hidden">
              {filteredBom.map((row) => {
                const done = populated.has(row.id);
                const isSelected = selected.size > 0 && splitDesignators(row.designators).some((designator) => selected.has(norm(designator)));
                return (
                  <li key={row.id} data-bom-row-id={row.id} className={`rounded-xl border bg-[var(--surface)] shadow-sm ${isSelected ? "border-blue-500" : done ? "border-emerald-400" : "border-[var(--border)]"}`}>
                    <div className="flex items-stretch">
                      <button className="min-w-0 flex-1 p-3 text-left" onClick={() => selectBomRow(row)}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className={`break-all font-mono text-sm font-semibold ${done ? "line-through text-[var(--muted)]" : ""}`}>{row.partMpn || row.resolvedMpn || row.value || "Unmatched part"}</p>
                            <p className="mt-1 break-words text-xs text-[var(--muted)]">{row.designators || "No designators"} · {sideLabel(row)}</p>
                          </div>
                          <div className="shrink-0 text-right"><p className="text-lg font-semibold tabular-nums">{row.qtyPerBoard}</p><p className="text-[10px] uppercase text-[var(--muted)]">per board</p></div>
                        </div>
                        <p className="mt-2 text-xs text-[var(--muted)]">{[row.value, row.package, row.onHand != null ? `${row.onHand} on hand` : ""].filter(Boolean).join(" · ")}</p>
                      </button>
                      <label className="grid min-w-14 cursor-pointer place-items-center border-l border-[var(--border)]" aria-label={done ? `Mark ${row.partMpn || row.value} not populated` : `Mark ${row.partMpn || row.value} populated`}>
                        <input type="checkbox" className="h-6 w-6 accent-emerald-600" checked={done} onChange={() => togglePopulated(row.id)} />
                      </label>
                    </div>
                  </li>
                );
              })}
              {filteredBom.length === 0 && <li className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">{bom.length === 0 ? "No BOM imported for this board." : hidePopulated && progress.doneLines === progress.totalLines ? "All components populated 🎉" : "No matches."}</li>}
            </ul>

            <div className="hidden max-h-[70vh] overflow-auto rounded-lg border border-black/10 sm:block dark:border-white/15">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 z-[1] bg-[var(--background)] text-black/50 dark:text-white/50">
                  <tr className="border-b border-black/10 dark:border-white/15">
                    <th className="px-2 py-2 text-center font-medium" title="Populated">
                      ✓
                    </th>
                    {([
                      ["qtyPerBoard", "Qty"],
                      ["designators", "Designators"],
                      ["side", "Top/Bottom"],
                      ["partMpn", "Part"],
                      ["value", "Value"],
                      ["package", "Pkg"],
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
                    const done = populated.has(row.id);
                    const dim = done ? "text-black/40 dark:text-white/40" : "";
                    return (
                      <tr
                        key={row.id}
                        data-bom-row-id={row.id}
                        onClick={() => selectBomRow(row)}
                        className={`cursor-pointer border-b border-black/5 dark:border-white/10 ${
                          isSel
                            ? "bg-blue-500/15"
                            : done
                              ? "bg-green-500/[0.07]"
                              : "hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                        }`}
                      >
                        <td className="px-2 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer align-middle accent-green-600"
                            checked={done}
                            onChange={() => togglePopulated(row.id)}
                            title={done ? "Mark not populated" : "Mark populated"}
                          />
                        </td>
                        <td className={`px-2 py-1.5 text-right tabular-nums ${dim}`}>{row.qtyPerBoard}</td>
                        <td
                          className={`px-2 py-1.5 text-xs ${
                            done ? "text-black/40 line-through dark:text-white/40" : "text-black/60 dark:text-white/60"
                          }`}
                        >
                          {row.designators}
                        </td>
                        <td className={`px-2 py-1.5 whitespace-nowrap ${dim}`}>{sideLabel(row)}</td>
                        <td className={`px-2 py-1.5 font-mono ${dim}`}>
                          <span>{row.partMpn || row.resolvedMpn || "—"}</span>
                          {row.resolvedMpn &&
                            normalizePartIdentifierForDisplay(row.resolvedMpn) !==
                              normalizePartIdentifierForDisplay(row.partMpn ?? "") && (
                              <span className="block text-[10px] text-emerald-700 dark:text-emerald-400">
                                stock: {row.resolvedMpn}
                              </span>
                            )}
                          {(row.matchNotes?.length ?? 0) > 0 && (
                            <span className="block text-[10px] text-amber-700 dark:text-amber-400">
                              review {row.matchNotes?.length} spec reminder
                              {row.matchNotes?.length === 1 ? "" : "s"}
                            </span>
                          )}
                        </td>
                        <td className={`px-2 py-1.5 ${dim}`}>{row.value}</td>
                        <td className={`px-2 py-1.5 ${dim}`}>{row.package}</td>
                      </tr>
                    );
                  })}
                  {filteredBom.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-2 py-6 text-center text-black/40 dark:text-white/40">
                        {bom.length === 0
                          ? "No BOM imported for this board."
                          : hidePopulated && progress.doneLines === progress.totalLines
                            ? "All components populated 🎉"
                            : "No matches."}
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
          onDetect={async (raw) => {
            const ok = await identifyScan(raw);
            if (ok) setScanOpen(false);
            return ok;
          }}
        />
      )}

      {stockEditorRow?.resolvedPartId && (
        <StockEditorModal
          partId={stockEditorRow.resolvedPartId}
          boardId={Number(id)}
          partLabel={stockEditorRow.resolvedMpn || stockEditorRow.partMpn || stockEditorRow.value}
          onClose={() => setStockEditorRow(null)}
          onChanged={() => {
            void reloadBom().then((rows) => {
              const refreshed = rows.find((row) => row.id === stockEditorRow.id);
              if (refreshed) {
                setDetailRow(refreshed);
                setStockEditorRow(refreshed);
              }
            });
          }}
        />
      )}
    </>
  );
}

// ===========================================================================
// Build progress bar
// ===========================================================================
function ProgressBar({
  progress,
}: {
  progress: { doneParts: number; totalParts: number; doneLines: number; totalLines: number; pct: number };
}) {
  const done = progress.totalParts > 0 && progress.doneParts === progress.totalParts;
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-medium">
          {done ? "Build complete 🎉" : "Build progress"}
        </span>
        <span className="tabular-nums text-black/55 dark:text-white/55">
          {progress.doneParts}/{progress.totalParts} parts · {progress.doneLines}/{progress.totalLines} lines ·{" "}
          {progress.pct}%
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${done ? "bg-green-500" : "bg-blue-500"}`}
          style={{ width: `${progress.pct}%` }}
        />
      </div>
    </div>
  );
}

// ===========================================================================
// Selected component detail card
// ===========================================================================
function MobileComponentPeek({
  row,
  side,
  count,
  populated,
  onTogglePopulated,
  onExpand,
  onManageStock,
  onClose,
}: {
  row: BomRow;
  side: string;
  count: number;
  populated: boolean;
  onTogglePopulated: () => void;
  onExpand: () => void;
  onManageStock?: () => void;
  onClose: () => void;
}) {
  const title = row.resolvedMpn || row.partMpn || row.value || "Component";
  const descriptor = [row.manufacturer, row.value, row.package].filter(Boolean).join(" · ");
  const actionClass =
    "min-h-11 rounded-lg border border-[var(--border)] px-2 text-sm font-semibold hover:bg-[var(--surface-subtle)]";
  return (
    <div className="rounded-xl border border-blue-500/40 bg-[var(--surface)] p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm font-semibold">{title}</p>
          {descriptor && <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{descriptor}</p>}
        </div>
        <button
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-xl text-[var(--muted)] hover:bg-[var(--surface-subtle)]"
          onClick={onClose}
          aria-label="Clear component selection"
        >
          ×
        </button>
      </div>
      <dl
        className="mt-2 grid gap-2 text-xs"
        style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}
      >
        <div className="min-w-0">
          <dt className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Designators</dt>
          <dd className="truncate font-medium">{row.designators || "—"}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Placements</dt>
          <dd className="font-medium tabular-nums">{count || row.qtyPerBoard}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Side</dt>
          <dd className="font-medium">{side}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-[var(--muted)]">On hand</dt>
          <dd className="font-medium tabular-nums">{row.onHand}</dd>
        </div>
      </dl>
      <div
        className="mt-3 grid gap-2"
        style={{ gridTemplateColumns: `repeat(${onManageStock ? 3 : 2}, minmax(0, 1fr))` }}
      >
        <button className={actionClass} onClick={onExpand}>Details</button>
        {onManageStock && <button className={actionClass} onClick={onManageStock}>Stock</button>}
        <button
          className={`${actionClass} ${populated ? "border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200" : ""}`}
          onClick={onTogglePopulated}
        >
          {populated ? "Populated ✓" : "Mark done"}
        </button>
      </div>
    </div>
  );
}

function ComponentCard({
  row,
  side,
  count,
  populated,
  onTogglePopulated,
  onManageStock,
  onClose,
}: {
  row: BomRow;
  side: string;
  count: number;
  populated: boolean;
  onTogglePopulated: () => void;
  onManageStock?: () => void;
  onClose: () => void;
}) {
  const url = row.supplier && row.spn ? supplierUrl(row.supplier, row.spn) : null;
  const cost = row.unitCost != null && row.unitCost !== "" ? Number(row.unitCost) : null;
  const field = (label: string, value: ReactNode) =>
    value || value === 0 ? (
      <div className="min-w-0">
        <dt className="text-[10px] uppercase tracking-wide text-black/40 dark:text-white/40">{label}</dt>
        <dd className="truncate text-sm">{value}</dd>
      </div>
    ) : null;

  return (
    <div
      className={`mb-3 rounded-lg border p-3 ${
        populated
          ? "border-green-500/30 bg-green-500/[0.06]"
          : "border-blue-500/30 bg-blue-500/[0.06]"
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-medium">{row.partMpn || row.value || "Component"}</p>
          {row.manufacturer && (
            <p className="truncate text-xs text-black/50 dark:text-white/50">{row.manufacturer}</p>
          )}
        </div>
        <button
          className="shrink-0 text-black/40 hover:text-black dark:text-white/40 dark:hover:text-white"
          onClick={onClose}
          title="Close"
        >
          ✕
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
        {field("Designators", <span className="break-words">{row.designators || "—"}</span>)}
        {field("Side", side)}
        {field("Qty / board", count || row.qtyPerBoard)}
        {field("Value", row.value)}
        {field("Package", row.package)}
        {field("On hand", row.onHand)}
        {field(
          row.matchType === "compatible" ? "Compatible stock" : "Inventory match",
          row.resolvedMpn &&
            normalizePartIdentifierForDisplay(row.resolvedMpn) !==
              normalizePartIdentifierForDisplay(row.partMpn ?? "")
            ? row.resolvedMpn
            : null,
        )}
        {field(
          row.supplier ? `${row.supplier} #` : "Supplier #",
          url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline dark:text-blue-400"
              onClick={(e) => e.stopPropagation()}
            >
              {row.spn}
            </a>
          ) : (
            row.spn
          ),
        )}
        {field("Unit cost", cost != null ? `$${cost.toFixed(4)}` : null)}
      </dl>

      {(row.stockLocations?.length ?? 0) > 0 && (
        <div
          className={`mt-3 rounded-md px-2.5 py-2 text-xs ${
            (row.projectQuantity ?? 0) > 0
              ? "bg-green-500/10 text-green-800 dark:text-green-300"
              : "bg-amber-500/10 text-amber-800 dark:text-amber-300"
          }`}
        >
          <p className="font-medium">
            {(row.projectQuantity ?? 0) > 0
              ? `In project location: ${row.projectQuantity}`
              : "Not in this project location — pick from:"}
          </p>
          <ul className="mt-2 space-y-1">
            {row.stockLocations?.map((location) => (
              <li key={location.locationId} className="flex items-baseline justify-between gap-3">
                <span>
                  {location.location}
                  {location.projectLocation && <span className="ml-1 font-semibold">· board match</span>}
                  <span className="ml-1 opacity-70">· {verificationLabel(location.lastConfirmedAt)}</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{location.quantity}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(row.stockLocations?.length ?? 0) === 0 && row.resolvedMpn && (
        <p className="mt-3 rounded-md bg-amber-500/10 px-2.5 py-2 text-xs text-amber-800 dark:text-amber-300">
          Matched in the catalog, but no stock location currently has this part.
        </p>
      )}
      {(row.matchNotes?.length ?? 0) > 0 && (
        <div className="mt-3 rounded-md bg-amber-500/10 px-2.5 py-2 text-xs text-amber-900 dark:text-amber-200">
          <p className="font-medium">Jellybean reminders</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {row.matchNotes?.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </div>
      )}

      {onManageStock ? (
        <button className="mt-3 min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-subtle)]" onClick={onManageStock}>
          Count / adjust this stock
        </button>
      ) : (
        <p className="mt-3 rounded-lg bg-[var(--surface-subtle)] px-3 py-2 text-xs text-[var(--muted)]">
          Match this BOM line to an inventory part before adjusting its stock.
        </p>
      )}

      <label className="mt-3 flex cursor-pointer select-none items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 cursor-pointer accent-green-600"
          checked={populated}
          onChange={onTogglePopulated}
        />
        Populated on this board
      </label>
    </div>
  );
}

// ===========================================================================
// Board canvas: zoom/pan image + highlight overlay
// ===========================================================================
// Cheap, memoized click-target layer: renders once per placements/mapper change
// (NOT on every selection) and dots scale with the zoom container, so there's no
// per-marker work while zooming. Selection draws a separate box overlay on top.
const PlacementDots = memo(function PlacementDots({
  placements,
  mapper,
  scale,
  calibrating,
  onPlacementClick,
}: {
  placements: Placement[];
  mapper: (x: number, y: number) => { fx: number; fy: number };
  scale: number;
  calibrating: boolean;
  onPlacementClick: (p: Placement) => void;
}) {
  return (
    <>
      {placements.map((p) => {
        const { fx, fy } = mapper(p.x, p.y);
        if (!Number.isFinite(fx) || !Number.isFinite(fy)) return null;
        return (
          <button
            key={p.id}
            title={`${p.designator}${p.mpn ? ` · ${p.mpn}` : ""}`}
            aria-label={`Select ${p.designator}${p.mpn ? `, ${p.mpn}` : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              if (!calibrating) onPlacementClick(p);
            }}
            className="absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full"
            style={{ left: `${fx * 100}%`, top: `${fy * 100}%`, width: 44 / Math.max(scale, 0.01), height: 44 / Math.max(scale, 0.01) }}
          >
            <span className="block rounded-full bg-sky-500/70 ring-1 ring-white/70 hover:bg-sky-400" style={{ width: 8 / Math.max(scale, 0.01), height: 8 / Math.max(scale, 0.01) }} />
          </button>
        );
      })}
    </>
  );
});

function BoardCanvas({
  boardId,
  side,
  imgVersion,
  hasTop,
  hasBottom,
  mapper,
  placements,
  selected,
  focusedDesignator,
  calibrating,
  onPlacementClick,
  onImageClick,
}: {
  boardId: number;
  side: Side;
  imgVersion: number;
  hasTop: boolean;
  hasBottom: boolean;
  mapper: ((x: number, y: number) => { fx: number; fy: number }) | null;
  placements: Placement[];
  selected: Set<string>;
  focusedDesignator: string | null;
  calibrating: boolean;
  onPlacementClick: (p: Placement) => void;
  onImageClick?: (frac: { x: number; y: number }) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null); // inline-block holding the image + overlay
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const [animate, setAnimate] = useState(false); // CSS transition only for programmatic moves
  const [contentH, setContentH] = useState(675);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { mode: "pan"; pointerId: number; x: number; y: number; tx: number; ty: number; moved: boolean }
    | { mode: "pinch"; distance: number; midX: number; midY: number; scale: number; tx: number; ty: number; moved: boolean }
    | null
  >(null);
  const suppressClick = useRef(false);

  const W0 = 900; // the board is laid out at a fixed 900px width; height tracks aspect
  const hasActiveImage = side === "top" ? hasTop : hasBottom;

  const fitView = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const s = Math.min(r.width / W0, r.height / contentH);
    setAnimate(true);
    setView({ scale: s, tx: (r.width - s * W0) / 2, ty: (r.height - s * contentH) / 2 });
  }, [contentH]);

  // The mobile board pane starts hidden while the parts list is active. Refit
  // when it becomes visible (or rotates/resizes) so it never retains a zero-size
  // transform measured while display:none.
  useEffect(() => {
    const element = viewportRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) fitView();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fitView]);

  const measure = useCallback(() => {
    const h = contentRef.current?.offsetHeight;
    if (h) setContentH(h);
  }, []);

  // Selecting a part does NOT change the zoom/pan — the highlight is drawn in
  // place so the current view is preserved (no jarring zoom-out on every click).

  // Re-fit when the side changes. Both side images stay mounted (toggled with CSS),
  // so switching never reloads — we just re-measure the now-active image's height
  // and fit it. (For a side with no image we fall back to the placeholder height.)
  useEffect(() => {
    if (hasActiveImage) {
      measure();
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setContentH(675);
    }
    if (selected.size === 0) fitView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, hasActiveImage]);

  // Wheel zoom toward the cursor (non-passive so we can preventDefault).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setAnimate(false);
      setView((v) => {
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const scale = Math.min(20, Math.max(0.15, v.scale * factor));
        const k = scale / v.scale;
        return { scale, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    try {
      // Preserve the original hit target. Capturing on the viewport retargets
      // marker taps away from their button and prevents component selection.
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      // Synthetic/testing pointer events may not register an active native
      // pointer. The gesture still works; capture is only for leaving the box.
    }
    setAnimate(false);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const points = [...pointers.current.values()];
    if (points.length === 1) {
      gesture.current = { mode: "pan", pointerId: e.pointerId, x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false };
    } else if (points.length >= 2) {
      const [a, b] = points;
      gesture.current = {
        mode: "pinch",
        distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
        scale: view.scale,
        tx: view.tx,
        ty: view.ty,
        moved: false,
      };
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const activeGesture = gesture.current;
    if (!activeGesture) return;

    const points = [...pointers.current.values()];
    if (activeGesture.mode === "pinch" && points.length >= 2) {
      const [a, b] = points;
      const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      if (Math.abs(distance - activeGesture.distance) + Math.abs(midX - activeGesture.midX) + Math.abs(midY - activeGesture.midY) > 3) {
        activeGesture.moved = true;
        suppressClick.current = true;
      }
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const scale = Math.min(20, Math.max(0.15, activeGesture.scale * (distance / activeGesture.distance)));
      const contentX = (activeGesture.midX - rect.left - activeGesture.tx) / activeGesture.scale;
      const contentY = (activeGesture.midY - rect.top - activeGesture.ty) / activeGesture.scale;
      setView({
        scale,
        tx: midX - rect.left - contentX * scale,
        ty: midY - rect.top - contentY * scale,
      });
      return;
    }

    if (activeGesture.mode === "pan" && activeGesture.pointerId === e.pointerId) {
      const dx = e.clientX - activeGesture.x;
      const dy = e.clientY - activeGesture.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) {
        activeGesture.moved = true;
        suppressClick.current = true;
      }
      setView((current) => ({ ...current, tx: activeGesture.tx + dx, ty: activeGesture.ty + dy }));
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    const remaining = [...pointers.current.entries()];
    if (remaining.length === 1) {
      const [pointerId, point] = remaining[0];
      gesture.current = { mode: "pan", pointerId, x: point.x, y: point.y, tx: view.tx, ty: view.ty, moved: true };
    } else {
      gesture.current = null;
    }
  }

  // Click on the board surface (used only in calibration mode).
  function onSurfaceClick(e: React.MouseEvent) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (!onImageClick) return;
    const c = contentRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    if (fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1) onImageClick({ x: fx, y: fy });
  }

  function handlePlacementClick(placement: Placement) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onPlacementClick(placement);
  }

  const zoomBy = useCallback((k: number) =>
    setView((v) => {
      setAnimate(true);
      const r = viewportRef.current?.getBoundingClientRect();
      const cx = r ? r.width / 2 : 0;
      const cy = r ? r.height / 2 : 0;
      const scale = Math.min(20, Math.max(0.15, v.scale * k));
      const f = scale / v.scale;
      return { scale, tx: cx - (cx - v.tx) * f, ty: cy - (cy - v.ty) * f };
    }), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isKeyboardInput(event.target) ||
        document.querySelector('[role="dialog"][aria-modal="true"]')
      ) {
        return;
      }

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomBy(1.25);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomBy(1 / 1.25);
      } else if (event.key === "0") {
        event.preventDefault();
        fitView();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [fitView, zoomBy]);

  return (
    <div className="relative">
      <div className="absolute right-2 top-2 z-10 flex gap-1">
        <button className="grid h-11 w-11 place-items-center rounded-lg bg-slate-950/70 text-xl text-white" aria-label="Zoom in" aria-keyshortcuts="=" title="Zoom in (+)" onClick={() => zoomBy(1.25)}>
          +
        </button>
        <button className="grid h-11 w-11 place-items-center rounded-lg bg-slate-950/70 text-xl text-white" aria-label="Zoom out" aria-keyshortcuts="-" title="Zoom out (−)" onClick={() => zoomBy(1 / 1.25)}>
          −
        </button>
        <button className="min-h-11 rounded-lg bg-slate-950/70 px-3 text-sm font-medium text-white" onClick={fitView} aria-keyshortcuts="0" title="Fit board image (0)">
          Fit
        </button>
      </div>

      <div
        ref={viewportRef}
        className={`relative aspect-[4/3] w-full touch-none select-none overflow-hidden overscroll-contain rounded-xl border border-black/10 bg-neutral-100 dark:border-white/15 dark:bg-neutral-900 ${
          calibrating ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onSurfaceClick}
      >
        {!hasActiveImage && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6 text-center text-sm text-black/40 dark:text-white/40">
            No {side} image uploaded. {mapper ? "Highlights still work on the placement grid." : ""}
          </div>
        )}
        <div
          className="absolute left-0 top-0 origin-top-left will-change-transform"
          style={{
            transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
            transition: animate ? "transform 350ms ease" : "none",
          }}
        >
          <div ref={contentRef} className="relative inline-block">
            {/* Both sides stay mounted so switching is a pure CSS swap (no reload /
                re-decode). The active side is shown and drives the layout height;
                the other is display:none but already loaded and ready. */}
            {(["top", "bottom"] as Side[]).map((s) =>
              (s === "top" ? hasTop : hasBottom) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={s}
                  src={`/api/boards/${boardId}/image?side=${s}&v=${imgVersion}`}
                  alt={`${s} of board`}
                  draggable={false}
                  onLoad={() => {
                    if (s !== side) return;
                    measure();
                    if (selected.size === 0) fitView();
                  }}
                  className={`max-w-none select-none ${s === side ? "block" : "hidden"}`}
                  style={{ width: "900px", height: "auto" }}
                />
              ) : null,
            )}
            {!hasActiveImage && (
              <div style={{ width: 900, height: 675 }} className="bg-neutral-200/40 dark:bg-neutral-800/40" />
            )}

            {/* Click targets (memoized — cheap, doesn't re-render on selection) */}
            {mapper && (
              <PlacementDots
                placements={placements}
                mapper={mapper}
                scale={view.scale}
                calibrating={calibrating}
                onPlacementClick={handlePlacementClick}
              />
            )}

            {/* Red arrow(s) from the board centre to the selected part(s) */}
            {mapper &&
              (() => {
                const selectedPlacements = placements.filter((p) => selected.has(norm(p.designator)));
                const focused = focusedDesignator
                  ? selectedPlacements.filter((p) => norm(p.designator) === norm(focusedDesignator))
                  : [];
                const sel = focused.length > 0 ? focused : selectedPlacements;
                if (sel.length === 0) return null;
                const arrowMarkerId = `arrowhead-${boardId}-${side}`;
                return (
                  <svg
                    className="pointer-events-none absolute left-0 top-0"
                    width={W0}
                    height={contentH}
                    viewBox={`0 0 ${W0} ${contentH}`}
                  >
                    <defs>
                      <marker
                        id={arrowMarkerId}
                        markerUnits="strokeWidth"
                        markerWidth="4"
                        markerHeight="4"
                        refX="3.2"
                        refY="2"
                        orient="auto"
                        viewBox="0 0 4 4"
                      >
                        <path d="M0,0 L4,2 L0,4 Z" fill="#ef4444" />
                      </marker>
                    </defs>
                    {sel.map((p) => {
                      const { fx, fy } = mapper(p.x, p.y);
                      if (!Number.isFinite(fx) || !Number.isFinite(fy)) return null;
                      const x1 = W0 / 2;
                      const y1 = contentH / 2;
                      const targetX = fx * W0;
                      const targetY = fy * contentH;
                      const dx = targetX - x1;
                      const dy = targetY - y1;
                      const distance = Math.max(1, Math.hypot(dx, dy));
                      const targetInset = Math.min(distance / 3, 22 / Math.max(view.scale, 0.01));
                      return (
                        <line
                          key={p.id}
                          x1={x1}
                          y1={y1}
                          x2={targetX - (dx / distance) * targetInset}
                          y2={targetY - (dy / distance) * targetInset}
                          stroke="#ef4444"
                          strokeWidth={4 / Math.max(view.scale, 0.01)}
                          strokeLinecap="round"
                          markerEnd={`url(#${arrowMarkerId})`}
                        />
                      );
                    })}
                  </svg>
                );
              })()}

            {/* Selected part box(es) */}
            {mapper &&
              placements
                .filter((p) => selected.has(norm(p.designator)))
                .map((p) => {
                  const { fx, fy } = mapper(p.x, p.y);
                  if (!Number.isFinite(fx) || !Number.isFinite(fy)) return null;
                  return (
                    <div
                      key={p.id}
                      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                      style={{ left: `${fx * 100}%`, top: `${fy * 100}%` }}
                    >
                      <div
                        className="rounded-[3px] border-red-500 bg-red-500/20"
                        style={{
                          width: 34 / Math.max(view.scale, 0.01),
                          height: 34 / Math.max(view.scale, 0.01),
                          borderWidth: 2 / Math.max(view.scale, 0.01),
                          boxShadow: `0 0 0 ${2 / Math.max(view.scale, 0.01)}px rgba(0,0,0,0.55)`,
                        }}
                      />
                    </div>
                  );
                })}
          </div>
        </div>
      </div>
      <p className="mt-1 text-xs text-black/40 dark:text-white/40">
        Pinch or scroll to zoom · drag to pan · tap a part to select · Fit resets the view.
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
  tryDownscale: true,
  tryDenoise: true,
  maxNumberOfSymbols: 1,
};

function BarcodeScanModal({
  onClose,
  onDetect,
}: {
  onClose: () => void;
  onDetect: (raw: string) => Promise<boolean>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fullCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const readerRef = useRef<typeof import("zxing-wasm/reader") | null>(null);
  const loopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const onDetectRef = useRef(onDetect);
  const frameRef = useRef(0);
  const [hint, setHint] = useState("Starting camera…");
  const [manual, setManual] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number } | null>(null);
  const [zoom, setZoom] = useState(0);

  useEffect(() => {
    onDetectRef.current = onDetect;
  }, [onDetect]);

  const stop = useCallback(() => {
    runningRef.current = false;
    if (loopRef.current) clearTimeout(loopRef.current);
    loopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    trackRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
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
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 2560 },
            height: { ideal: 1440 },
          },
        });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play().catch(() => {});
        const track = stream.getVideoTracks()[0];
        trackRef.current = track ?? null;
        const caps = track?.getCapabilities?.() as TrackCapabilities | undefined;
        setTorchSupported(Boolean(caps?.torch));
        if (track && caps?.focusMode?.includes("continuous")) {
          await track
            .applyConstraints({
              advanced: [{ focusMode: "continuous" } as TrackConstraintSet],
            })
            .catch(() => {});
        }
        if (track && caps?.zoom && caps.zoom.max > caps.zoom.min) {
          const step =
            caps.zoom.step && caps.zoom.step > 0
              ? caps.zoom.step
              : (caps.zoom.max - caps.zoom.min) / 100;
          const initial = Math.min(
            caps.zoom.max,
            caps.zoom.min + (caps.zoom.max - caps.zoom.min) * 0.35,
          );
          setZoomRange({ min: caps.zoom.min, max: caps.zoom.max, step });
          setZoom(initial);
          await track
            .applyConstraints({ advanced: [{ zoom: initial } as TrackConstraintSet] })
            .catch(() => {});
        }
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
        setHint("Fill the guide with the QR / DataMatrix and hold steady.");
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
          const canvas = (fullCanvasRef.current ??= document.createElement("canvas"));
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            let hit = (await reader.readBarcodes(img, READER_OPTIONS)).find(
              (r) => r.bytes?.length || r.text,
            );
            // Every third frame, also upscale the central guide. Tiny, clean QR
            // codes often fail only because too few camera pixels cover a module.
            frameRef.current += 1;
            if (!hit && frameRef.current % 3 === 0) {
              const side = Math.floor(Math.min(video.videoWidth, video.videoHeight) * 0.72);
              const sx = Math.floor((video.videoWidth - side) / 2);
              const sy = Math.floor((video.videoHeight - side) / 2);
              const crop = (cropCanvasRef.current ??= document.createElement("canvas"));
              const output = Math.max(1200, side);
              crop.width = output;
              crop.height = output;
              const cropCtx = crop.getContext("2d", { willReadFrequently: true });
              if (cropCtx) {
                cropCtx.drawImage(video, sx, sy, side, side, 0, 0, output, output);
                const cropImage = cropCtx.getImageData(0, 0, output, output);
                hit = (await reader.readBarcodes(cropImage, READER_OPTIONS)).find(
                  (result) => result.bytes?.length || result.text,
                );
              }
            }
            if (hit) {
              const raw = decodeScannedBytes(hit.bytes, hit.text);
              runningRef.current = false;
              setHint("Code read — identifying the part…");
              const accepted = await onDetectRef.current(raw);
              if (!accepted && active) {
                runningRef.current = true;
                setHint("Code read, but it did not match this BOM. Try another label or enter it below.");
                loopRef.current = setTimeout(() => void loop(), 900);
              }
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
  }, [stop]);

  async function toggleTorch() {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as TrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setHint("This camera could not toggle its light.");
    }
  }

  async function changeZoom(value: number) {
    setZoom(value);
    await trackRef.current
      ?.applyConstraints({ advanced: [{ zoom: value } as TrackConstraintSet] })
      .catch(() => {});
  }

  async function detectRaw(raw: string) {
    if (!raw.trim()) return;
    setHint("Identifying the part…");
    const accepted = await onDetectRef.current(raw.trim());
    if (!accepted) setHint("That code did not match this board's BOM.");
  }

  async function captureDecode() {
    const reader = readerRef.current;
    if (!reader || capturing) return;
    setCapturing(true);
    setHint("Capturing a sharp photo…");
    try {
      let raw = "";
      const track = trackRef.current;
      const imageCapture = window as unknown as {
        ImageCapture?: new (track: MediaStreamTrack) => { takePhoto: () => Promise<Blob> };
      };
      if (track && imageCapture.ImageCapture) {
        try {
          const blob = await new imageCapture.ImageCapture(track).takePhoto();
          const hit = (await reader.readBarcodes(blob, READER_OPTIONS)).find(
            (result) => result.bytes?.length || result.text,
          );
          if (hit) raw = decodeScannedBytes(hit.bytes, hit.text);
        } catch {
          // Fall back to the current full-resolution video frame below.
        }
      }
      if (!raw) {
        const video = videoRef.current;
        if (video?.videoWidth) {
          const canvas = (fullCanvasRef.current ??= document.createElement("canvas"));
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
          if (ctx) {
            const hit = (
              await reader.readBarcodes(
                ctx.getImageData(0, 0, canvas.width, canvas.height),
                READER_OPTIONS,
              )
            ).find((result) => result.bytes?.length || result.text);
            if (hit) raw = decodeScannedBytes(hit.bytes, hit.text);
          }
        }
      }
      if (raw) await detectRaw(raw);
      else setHint("No code found. Fill the guide, steady the camera, and try again.");
    } finally {
      setCapturing(false);
    }
  }

  return (
    <Modal title="Scan a component" onClose={onClose}>
        <div className="relative overflow-hidden rounded-xl border border-black/10 bg-black dark:border-white/15">
          <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[72%] w-[72%] rounded-lg border-2 border-white/75 shadow-[0_0_0_9999px_rgba(0,0,0,0.28)]" />
          </div>
        </div>
        {zoomRange && (
          <label className="mt-3 flex items-center gap-3 text-xs text-black/60 dark:text-white/60">
            <span>Zoom</span>
            <input
              type="range"
              className="flex-1"
              min={zoomRange.min}
              max={zoomRange.max}
              step={zoomRange.step}
              value={zoom}
              onChange={(event) => void changeZoom(Number(event.target.value))}
            />
          </label>
        )}
        <div className="mt-3 flex gap-2">
          <button className={`${btn} flex-1`} disabled={capturing} onClick={() => void captureDecode()}>
            {capturing ? "Reading…" : "Capture sharp photo"}
          </button>
          {torchSupported && (
            <button className={btn} onClick={() => void toggleTorch()}>
              {torchOn ? "Light off" : "Light on"}
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-black/60 dark:text-white/60">{hint}</p>
        <div className="mt-3 flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-white/20"
            placeholder="…or paste/scan label text"
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void detectRaw(manual);
            }}
          />
          <button className={btn} disabled={!manual.trim()} onClick={() => void detectRaw(manual)}>
            Identify
          </button>
        </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Encode a render's mm bounding box as the 2-point calibration (image corner ↔
// board-mm corner). The bottom render is mirrored, so its top-left corner maps
// to board (maxX, maxY) rather than (minX, maxY).
function bboxToCalibration(side: Side, b: Outline): [CalPoint, CalPoint] {
  return side === "bottom"
    ? [
        { frac: { x: 0, y: 0 }, mm: { x: b.maxX, y: b.maxY } },
        { frac: { x: 1, y: 1 }, mm: { x: b.minX, y: b.minY } },
      ]
    : [
        { frac: { x: 0, y: 0 }, mm: { x: b.minX, y: b.maxY } },
        { frac: { x: 1, y: 1 }, mm: { x: b.maxX, y: b.minY } },
      ];
}

// Rasterize a board SVG to a compact WebP in the browser (one-time draw to a
// canvas, then discard) — the live viewer only ever shows the light WebP.
async function rasterizeSvg(
  svg: string,
  targetLong = 1800,
): Promise<{ blob: Blob; width: number; height: number }> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("could not render the board SVG"));
      img.src = url;
    });
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (!w || !h) {
      w = targetLong;
      h = targetLong;
    }
    const scale = targetLong / Math.max(w, h);
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.drawImage(img, 0, 0, cw, ch);
    const blob =
      (await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.8))) ??
      (await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png")));
    if (!blob) throw new Error("rasterization failed");
    return { blob, width: cw, height: ch };
  } finally {
    URL.revokeObjectURL(url);
  }
}

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
