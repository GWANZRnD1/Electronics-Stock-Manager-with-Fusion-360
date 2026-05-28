"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ArucoMarker } from "@/components/ArucoMarker";
import { Nav } from "@/components/Nav";
import { arucoSvg, dictCapacity, type ArucoDictName } from "@/lib/aruco/marker";
import { jdel, jget, jpatch, jpost } from "@/lib/client";

interface Location {
  id: number;
  name: string;
  description: string;
  aruco: number | null;
}

interface ArucoConfig {
  dict: ArucoDictName;
  sizeMm: number;
}

const inputCls =
  "rounded-md border border-black/15 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-white/20";
const btnSm =
  "rounded-md border border-black/15 px-2.5 py-1 text-sm hover:bg-black/[0.03] disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/[0.04]";

/** Smallest unused marker id in [0, capacity), or null if the dictionary is full. */
function nextFreeId(locs: Location[], capacity: number): number | null {
  const used = new Set(locs.map((l) => l.aruco).filter((a): a is number => a !== null));
  for (let i = 0; i < capacity; i++) if (!used.has(i)) return i;
  return null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/**
 * Open a print window that tiles every given marker onto A4 pages (many per sheet,
 * to save paper). Works for one marker or a whole selection; locations without a
 * marker id are skipped. Each marker is sized in mm and kept whole across pages.
 */
function printMarkers(locs: Location[], cfg: ArucoConfig) {
  const withCodes = locs.filter((l): l is Location & { aruco: number } => l.aruco !== null);
  if (withCodes.length === 0) return;
  const cells = withCodes
    .map(
      (l) =>
        `<figure><div class="m">${arucoSvg(cfg.dict, l.aruco, { sizeMm: cfg.sizeMm, quiet: 2 })}</div>` +
        `<figcaption>${escapeHtml(l.name)} · ${cfg.dict} #${l.aruco}</figcaption></figure>`,
    )
    .join("");
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>ArUco markers (${withCodes.length})</title>` +
      `<style>` +
      `@page{size:A4;margin:10mm}` +
      `body{font-family:system-ui,sans-serif;margin:0}` +
      `.grid{display:flex;flex-wrap:wrap;gap:6mm;align-content:flex-start}` +
      `figure{margin:0;break-inside:avoid;text-align:center}` +
      `.m{line-height:0}` +
      `figcaption{margin-top:1.5mm;font-size:9pt;color:#333;max-width:${cfg.sizeMm + 10}mm;word-break:break-word}` +
      `</style></head><body><div class="grid">${cells}</div>` +
      `<script>window.onload=function(){window.print()}</script></body></html>`,
  );
  w.document.close();
}

function downloadMarker(loc: Location, cfg: ArucoConfig) {
  if (loc.aruco === null) return;
  const svg = arucoSvg(cfg.dict, loc.aruco, { sizeMm: cfg.sizeMm, quiet: 2 });
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `aruco-${cfg.dict}-${loc.aruco}-${loc.name.replace(/[^\w-]+/g, "_")}.svg`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Self-contained edit form for one location (its own draft state). */
function EditRow({
  loc,
  capacity,
  busy,
  onSave,
  onCancel,
}: {
  loc: Location;
  capacity: number;
  busy: boolean;
  onSave: (patch: { name: string; description: string; aruco: number | null }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(loc.name);
  const [notes, setNotes] = useState(loc.description);
  const [aruco, setAruco] = useState(loc.aruco === null ? "" : String(loc.aruco));

  const arucoNum = aruco.trim() === "" ? null : Number(aruco);
  const arucoBad = arucoNum !== null && (!Number.isInteger(arucoNum) || arucoNum < 0 || arucoNum >= capacity);
  const canSave = name.trim().length > 0 && !arucoBad && !busy;

  return (
    <div className="flex flex-1 flex-wrap items-center gap-2">
      <input
        autoFocus
        className={`${inputCls} min-w-[10rem] flex-1`}
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className={`${inputCls} min-w-[12rem] flex-[2]`}
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <input
        className={`${inputCls} w-28 ${arucoBad ? "border-red-500" : ""}`}
        type="number"
        min={0}
        max={capacity - 1}
        placeholder="ArUco id"
        value={aruco}
        onChange={(e) => setAruco(e.target.value)}
      />
      <button
        className={btnSm}
        disabled={!canSave}
        onClick={() => onSave({ name: name.trim(), description: notes.trim(), aruco: arucoNum })}
      >
        Save
      </button>
      <button className={btnSm} disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

export default function LocationsPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [cfg, setCfg] = useState<ArucoConfig | null>(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  // null = follow the suggested next-free id; a string = the user's manual override.
  const [arucoOverride, setArucoOverride] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const capacity = cfg ? dictCapacity(cfg.dict) : 0;
  const suggested = useMemo(() => nextFreeId(locations, capacity), [locations, capacity]);
  // Shown in the new-location field: the manual override if set, else the suggestion.
  const arucoValue = arucoOverride ?? (suggested === null ? "" : String(suggested));

  const reload = useCallback(async () => {
    const [locs, config] = await Promise.all([
      jget<Location[]>("/api/locations"),
      jget<ArucoConfig>("/api/settings/aruco"),
    ]);
    setLocations(locs);
    setCfg(config);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [locs, config] = await Promise.all([
          jget<Location[]>("/api/locations"),
          jget<ArucoConfig>("/api/settings/aruco"),
        ]);
        if (active) {
          setLocations(locs);
          setCfg(config);
        }
      } catch (e) {
        if (active && e instanceof Error && e.message !== "locked") setError(e.message);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      setEditingId(null);
      await reload();
    } catch (e) {
      if (e instanceof Error && e.message !== "locked") setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectUnmarked() {
    setSelected(new Set(locations.filter((l) => l.aruco === null).map((l) => l.id)));
  }

  async function assignSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    await run(async () => {
      const r = await jpost<{ assigned: number; alreadyHad: number; unassigned: number; full: boolean }>(
        "/api/locations/assign-aruco",
        { ids },
      );
      setSelected(new Set());
      setNotice(
        `Assigned ${r.assigned} code${r.assigned === 1 ? "" : "s"}` +
          (r.alreadyHad ? `, ${r.alreadyHad} already had one` : "") +
          (r.full ? ` — dictionary full, ${r.unassigned} left unassigned` : "") +
          ".",
      );
    });
  }

  function printSelected() {
    if (cfg) printMarkers(locations.filter((l) => selected.has(l.id)), cfg);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const arucoNum = arucoValue.trim() === "" ? null : Number(arucoValue);
    await run(async () => {
      await jpost("/api/locations", { name: name.trim(), description: notes.trim(), aruco: arucoNum });
      setName("");
      setNotes("");
      setArucoOverride(null); // re-sync the field to the next free id
    });
  }

  function remove(loc: Location) {
    if (!window.confirm(`Delete location "${loc.name}"?`)) return;
    void run(() => jdel(`/api/locations/${loc.id}`));
  }

  const arucoInvalid =
    arucoValue.trim() !== "" &&
    (!Number.isInteger(Number(arucoValue)) || Number(arucoValue) < 0 || Number(arucoValue) >= capacity);
  const full = suggested === null && arucoValue.trim() === "";

  const allSelected = locations.length > 0 && locations.every((l) => selected.has(l.id));
  const selectedWithCodes = locations.filter((l) => selected.has(l.id) && l.aruco !== null).length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(locations.map((l) => l.id)));

  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-5xl flex-1 p-6">
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Locations</h1>
          {cfg && (
            <p className="text-sm text-black/50 dark:text-white/50">
              ArUco dictionary <code>{cfg.dict}</code> ({capacity} ids) · {cfg.sizeMm}mm — change in{" "}
              <a href="/settings" className="underline">
                Settings
              </a>
            </p>
          )}
        </div>

        {error && (
          <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {notice && (
          <p className="mb-4 rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
            {notice}
          </p>
        )}

        <form onSubmit={create} className="mb-2 flex flex-wrap gap-2">
          <input
            className={`${inputCls} min-w-[10rem] flex-1`}
            placeholder="New location name (e.g. Shelf A1)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className={`${inputCls} min-w-[12rem] flex-[2]`}
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <input
            className={`${inputCls} w-28 ${arucoInvalid ? "border-red-500" : ""}`}
            type="number"
            min={0}
            max={Math.max(capacity - 1, 0)}
            placeholder="ArUco id"
            value={arucoValue}
            onChange={(e) => setArucoOverride(e.target.value)}
            title="Auto-filled to the next free id; clear it for no marker"
          />
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            disabled={busy || !name.trim() || arucoInvalid}
          >
            Add
          </button>
        </form>
        <p className="mb-6 text-sm text-black/50 dark:text-white/50">
          The ArUco id auto-fills to the next free marker (editable). Clear it to add a location without
          a marker. {full && <span className="text-amber-600 dark:text-amber-400">Dictionary is full.</span>}
        </p>

        {locations.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-black/10 px-3 py-2 text-sm dark:border-white/15">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="size-4" checked={allSelected} onChange={toggleAll} />
              <span>Select all</span>
            </label>
            <button className={btnSm} onClick={selectUnmarked} disabled={busy}>
              Select unmarked
            </button>
            <span className="text-black/50 dark:text-white/50">{selected.size} selected</span>
            <span className="ml-auto flex flex-wrap gap-2">
              <button className={btnSm} onClick={assignSelected} disabled={busy || selected.size === 0}>
                Assign ArUco codes
              </button>
              <button
                className={btnSm}
                onClick={printSelected}
                disabled={busy || selectedWithCodes === 0}
                title="Tile the selected markers onto A4 pages"
              >
                Print selected ({selectedWithCodes})
              </button>
              {selected.size > 0 && (
                <button className={btnSm} onClick={() => setSelected(new Set())} disabled={busy}>
                  Clear
                </button>
              )}
            </span>
          </div>
        )}

        {locations.length === 0 ? (
          <p className="text-sm text-black/60 dark:text-white/60">No locations yet.</p>
        ) : (
          <ul className="space-y-3">
            {locations.map((loc) => (
              <li
                key={loc.id}
                className="flex flex-wrap items-center gap-4 rounded-xl border border-black/10 p-4 dark:border-white/15"
              >
                <input
                  type="checkbox"
                  className="size-4 shrink-0"
                  checked={selected.has(loc.id)}
                  onChange={() => toggleOne(loc.id)}
                  aria-label={`Select ${loc.name}`}
                />
                {cfg && loc.aruco !== null ? (
                  <ArucoMarker dict={cfg.dict} id={loc.aruco} size={72} title={`${loc.name} marker`} />
                ) : (
                  <div className="grid h-[72px] w-[72px] place-items-center rounded border border-dashed border-black/15 text-center text-[10px] text-black/40 dark:border-white/20 dark:text-white/40">
                    no marker
                  </div>
                )}

                {editingId === loc.id && cfg ? (
                  <EditRow
                    loc={loc}
                    capacity={capacity}
                    busy={busy}
                    onSave={(patch) => run(() => jpatch(`/api/locations/${loc.id}`, patch))}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <>
                    <div className="min-w-[8rem] flex-1">
                      <div className="font-medium">{loc.name}</div>
                      <div className="text-sm text-black/55 dark:text-white/55">
                        {loc.description || <span className="italic opacity-60">no notes</span>}
                      </div>
                      <div className="mt-0.5 text-xs text-black/40 dark:text-white/40">
                        {loc.aruco !== null ? `ArUco #${loc.aruco}` : "no marker assigned"}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        className={btnSm}
                        disabled={busy || loc.aruco === null}
                        onClick={() => cfg && printMarkers([loc], cfg)}
                      >
                        Print
                      </button>
                      <button
                        className={btnSm}
                        disabled={busy || loc.aruco === null}
                        onClick={() => cfg && downloadMarker(loc, cfg)}
                      >
                        SVG
                      </button>
                      <button className={btnSm} disabled={busy} onClick={() => setEditingId(loc.id)}>
                        Edit
                      </button>
                      <button
                        className={`${btnSm} text-red-600 dark:text-red-400`}
                        disabled={busy}
                        onClick={() => remove(loc)}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
