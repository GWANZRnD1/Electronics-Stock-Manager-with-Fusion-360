"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { jdel, jget, jpatch, jpost } from "@/lib/client";
import { stockLocationOrder } from "@/lib/domain/stockRanking";

import { Modal, btn, btnSecondary, inputClass } from "./ui";

export interface PartStockRow {
  locationId: number;
  location: string;
  quantity: number;
  lastConfirmedAt: string | null;
  projectLocation: boolean;
}

interface Location {
  id: number;
  name: string;
}

function countLabel(value: string | null) {
  if (!value) return "Never physically counted";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Count date unavailable";
  return `Counted ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date)}`;
}

function StockLocation({
  row,
  locations,
  busy,
  onSave,
  onConfirm,
  onMove,
  onRemove,
}: {
  row: PartStockRow;
  locations: Location[];
  busy: boolean;
  onSave: (quantity: number) => Promise<void>;
  onConfirm: () => Promise<void>;
  onMove: (toLocationId: number) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(String(row.quantity));
  const [moving, setMoving] = useState(false);
  const [moveTo, setMoveTo] = useState<number | "">("");
  const quantity = Number(draft);
  const valid = Number.isInteger(quantity) && quantity >= 0 && quantity <= 1_000_000;
  const changed = valid && quantity !== row.quantity;
  const targets = locations.filter((location) => location.id !== row.locationId);

  return (
    <li className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {row.location}
            {row.projectLocation && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-800 dark:bg-blue-500/20 dark:text-blue-200">
                Board location
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">{countLabel(row.lastConfirmedAt)}</p>
        </div>
        <label className="shrink-0 text-right text-xs font-medium text-[var(--muted)]">
          On hand
          <input
            className={`mt-1 block h-11 w-28 rounded-lg border bg-[var(--surface)] px-3 text-right text-lg font-semibold tabular-nums outline-none focus:ring-2 ${
              valid ? "border-[var(--border)] focus:border-blue-600 focus:ring-blue-600/20" : "border-red-500 focus:ring-red-500/20"
            }`}
            inputMode="numeric"
            value={draft}
            disabled={busy}
            aria-invalid={!valid}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraft(event.target.value.replace(/\D/g, ""))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && changed) {
                event.preventDefault();
                void onSave(quantity);
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setDraft(String(row.quantity));
                event.currentTarget.blur();
              }
            }}
            aria-keyshortcuts="Enter Escape"
            title="Enter to save · Esc to restore"
          />
        </label>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <button className={changed ? btn : btnSecondary} disabled={busy || !changed} onClick={() => void onSave(quantity)}>
          Save count
        </button>
        <button className={btnSecondary} disabled={busy || changed} onClick={() => void onConfirm()}>
          Confirm unchanged
        </button>
        <button className={btnSecondary} disabled={busy || targets.length === 0} onClick={() => setMoving((value) => !value)}>
          Move all
        </button>
        <button className={`${btnSecondary} text-red-700 dark:text-red-300`} disabled={busy} onClick={() => void onRemove()}>
          Remove
        </button>
      </div>

      {moving && (
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 sm:flex-row">
          <label className="sr-only" htmlFor={`move-stock-${row.locationId}`}>Move stock to</label>
          <select
            id={`move-stock-${row.locationId}`}
            className={inputClass}
            value={moveTo}
            disabled={busy}
            onChange={(event) => setMoveTo(event.target.value ? Number(event.target.value) : "")}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setMoving(false);
                setMoveTo("");
              }
            }}
          >
            <option value="">Choose destination…</option>
            {targets.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
          <button className={btn} disabled={busy || !moveTo} onClick={() => moveTo && void onMove(moveTo)}>Move</button>
        </div>
      )}
    </li>
  );
}

export function StockEditor({
  partId,
  boardId,
  onChanged,
}: {
  partId: number;
  boardId?: number;
  onChanged?: (rows: PartStockRow[]) => void;
}) {
  const [stock, setStock] = useState<PartStockRow[] | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [addLocationId, setAddLocationId] = useState<number | "">("");
  const [addQuantity, setAddQuantity] = useState("0");
  const stockUrl = `/api/parts/${partId}/stock${boardId ? `?boardId=${boardId}` : ""}`;

  const applyStock = useCallback((rows: PartStockRow[]) => {
    const sorted = [...rows].sort(stockLocationOrder);
    setStock(sorted);
    onChanged?.(sorted);
  }, [onChanged]);

  const refresh = useCallback(async () => {
    const rows = await jget<PartStockRow[]>(stockUrl);
    applyStock(rows);
  }, [applyStock, stockUrl]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      jget<PartStockRow[]>(stockUrl),
      jget<Location[]>("/api/locations"),
    ])
      .then(([stockRows, locationRows]) => {
        if (!active) return;
        setStock([...stockRows].sort(stockLocationOrder));
        setLocations(locationRows);
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : "Could not load stock."));
    return () => { active = false; };
  }, [stockUrl]);

  const assigned = useMemo(() => new Set(stock?.map((row) => row.locationId) ?? []), [stock]);
  const available = locations.filter((location) => !assigned.has(location.id));
  const total = stock?.reduce((sum, row) => sum + row.quantity, 0) ?? 0;

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error && reason.message !== "locked" ? reason.message : "Stock could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function addLocation(event: React.FormEvent) {
    event.preventDefault();
    const quantity = Number(addQuantity);
    if (!addLocationId || !Number.isInteger(quantity) || quantity < 0 || quantity > 1_000_000) {
      setError("Choose a location and enter a whole-number count.");
      return;
    }
    await act(async () => {
      await jpost(`/api/parts/${partId}/stock`, { locationId: addLocationId, quantity });
      setAdding(false);
      setAddLocationId("");
      setAddQuantity("0");
    });
  }

  if (stock === null) return <p className="py-6 text-center text-sm text-[var(--muted)]">Loading stock…</p>;

  return (
    <div>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            {boardId ? "Recommended pick order" : "Freshest counts first"}
          </p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums">{total} <span className="text-sm font-normal text-[var(--muted)]">on hand</span></p>
        </div>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300" role="alert">{error}</p>}

      {stock.length > 0 ? (
        <ul className="space-y-2">
          {stock.map((row) => (
            <StockLocation
              key={`${row.locationId}:${row.quantity}:${row.lastConfirmedAt ?? ""}`}
              row={row}
              locations={locations}
              busy={busy}
              onSave={(quantity) => act(() => jpatch(`/api/parts/${partId}/stock`, { locationId: row.locationId, quantity }))}
              onConfirm={() => act(() => jpost(`/api/parts/${partId}/confirm`, { locationId: row.locationId }))}
              onMove={(toLocationId) => act(() => jpost(`/api/parts/${partId}/stock/move`, { fromLocationId: row.locationId, toLocationId }))}
              onRemove={() => {
                const warning = row.quantity > 0
                  ? `Remove ${row.quantity} unit${row.quantity === 1 ? "" : "s"} from ${row.location} and delete this assignment?`
                  : `Remove the assignment to ${row.location}?`;
                if (!window.confirm(warning)) return Promise.resolve();
                return act(() => jdel(`/api/parts/${partId}/stock?locationId=${row.locationId}`));
              }}
            />
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-5 text-center">
          <p className="font-medium">No stock location assigned</p>
          <p className="mt-1 text-sm text-[var(--muted)]">Assign a location with a zero count, or enter what is physically present.</p>
        </div>
      )}

      {adding ? (
        <form
          className="mt-3 rounded-xl border border-[var(--border)] p-3"
          onSubmit={(event) => void addLocation(event)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setAdding(false);
              setAddLocationId("");
              setAddQuantity("0");
            }
          }}
        >
          <label className="text-sm font-medium" htmlFor={`add-location-${partId}`}>Location</label>
          <select id={`add-location-${partId}`} className={`${inputClass} mt-1`} value={addLocationId} disabled={busy} onChange={(event) => setAddLocationId(event.target.value ? Number(event.target.value) : "")}>
            <option value="">Choose location…</option>
            {available.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
          <label className="mt-3 block text-sm font-medium" htmlFor={`add-quantity-${partId}`}>Physical count</label>
          <input id={`add-quantity-${partId}`} className={`${inputClass} mt-1`} inputMode="numeric" value={addQuantity} disabled={busy} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setAddQuantity(event.target.value.replace(/\D/g, ""))} />
          <div className="mt-3 flex justify-end gap-2">
            <button className={btnSecondary} type="button" disabled={busy} onClick={() => setAdding(false)}>Cancel</button>
            <button className={btn} type="submit" disabled={busy || !addLocationId}>{busy ? "Adding…" : "Add location"}</button>
          </div>
        </form>
      ) : (
        <button className={`${btnSecondary} mt-3 w-full`} disabled={busy || available.length === 0} onClick={() => setAdding(true)}>
          + Add stock location
        </button>
      )}
    </div>
  );
}

export function StockEditorModal({
  partId,
  boardId,
  partLabel,
  onClose,
  onChanged,
}: {
  partId: number;
  boardId?: number;
  partLabel: string;
  onClose: () => void;
  onChanged?: (rows: PartStockRow[]) => void;
}) {
  return (
    <Modal title={`Stock · ${partLabel || "Component"}`} onClose={onClose}>
      <StockEditor partId={partId} boardId={boardId} onChanged={onChanged} />
    </Modal>
  );
}
