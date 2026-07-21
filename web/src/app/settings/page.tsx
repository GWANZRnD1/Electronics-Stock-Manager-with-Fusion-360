"use client";

import { useEffect, useState } from "react";

import { ArucoMarker } from "@/components/ArucoMarker";
import { Nav } from "@/components/Nav";
import { Modal, btn, btnSecondary, cardClass, inputClass } from "@/components/ui";
import { ARUCO_DICT_NAMES, dictCapacity, type ArucoDictName } from "@/lib/aruco/marker";
import { jget, jpatch, jpost, jpostText, jput } from "@/lib/client";

interface SessionUser {
  name: string;
  isRoot: boolean;
  gateEnabled: boolean;
}

export default function SettingsPage() {
  const [importOpen, setImportOpen] = useState(false);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let active = true;
    void jget<{ user: SessionUser }>("/api/auth/session")
      .then((result) => active && setSessionUser(result.user))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">
        <h1 className="mb-4 text-2xl font-semibold tracking-tight">Settings</h1>
        <div className="space-y-4">
          {sessionUser && <AccountPanel user={sessionUser} />}
          {sessionUser?.isRoot && <UserAccessPanel gateEnabled={sessionUser.gateEnabled} />}
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
          <PurchasingPanel />
          <SyncPanel />
          <UlpPanel />
          <ArucoPanel />
        </div>
      </main>

      {importOpen && <ImportModal onClose={() => setImportOpen(false)} onDone={() => setImportOpen(false)} />}
    </>
  );
}

function AccountPanel({ user }: { user: SessionUser }) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await jpost("/api/auth/logout", {});
    } finally {
      window.location.href = "/unlock";
    }
  }

  return (
    <section className={cardClass}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Signed in
          </p>
          <h2 className="mt-1 font-medium">
            {user.name} {user.isRoot && <span className="text-sm text-blue-700 dark:text-blue-300">· Root</span>}
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Board population checklists are saved separately for this account.
          </p>
        </div>
        <button className={btnSecondary} disabled={busy} onClick={() => void signOut()}>
          {busy ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </section>
  );
}

interface ManagedUser {
  id: number;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

function UserAccessPanel({ gateEnabled }: { gateEnabled: boolean }) {
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [resetId, setResetId] = useState<number | null>(null);
  const [resetPin, setResetPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const reload = async () => {
    const result = await jget<{ users: ManagedUser[] }>("/api/settings/users");
    setUsers(result.users);
  };

  useEffect(() => {
    let active = true;
    void jget<{ users: ManagedUser[] }>("/api/settings/users")
      .then((result) => {
        if (active) setUsers(result.users);
      })
      .catch((error) => {
        if (active) {
          setMessage(error instanceof Error ? error.message : "Could not load users.");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function addUser(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await jpost("/api/settings/users", { name, pin });
      setName("");
      setPin("");
      await reload();
      setMessage("User added. They can sign in immediately with their PIN.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add user.");
    } finally {
      setBusy(false);
    }
  }

  async function setActive(user: ManagedUser, active: boolean) {
    setBusy(true);
    setMessage("");
    try {
      await jpatch(`/api/settings/users/${user.id}`, { active });
      await reload();
      setMessage(active ? `${user.name} can sign in again.` : `${user.name} was signed out on all devices.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update user.");
    } finally {
      setBusy(false);
    }
  }

  async function saveReset(user: ManagedUser) {
    setBusy(true);
    setMessage("");
    try {
      await jpatch(`/api/settings/users/${user.id}`, { pin: resetPin });
      setResetId(null);
      setResetPin("");
      await reload();
      setMessage(`${user.name}'s PIN changed; their other sessions were signed out.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reset PIN.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cardClass}>
      <h2 className="font-medium">User access</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        The root master PIN remains the current <code>ACCESS_PIN</code>. Extra PINs are stored as
        salted hashes and each user gets an independent assembly checklist.
      </p>
      {!gateEnabled && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          Access control is currently disabled because <code>ACCESS_PIN</code> is not configured.
          Extra users can be prepared here, but their PINs take effect only after the root PIN is set.
        </p>
      )}

      <div className="mt-4 space-y-2">
        {users === null ? (
          <p className="text-sm text-[var(--muted)]">Loading users…</p>
        ) : users.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--border)] p-3 text-sm text-[var(--muted)]">
            No additional users yet.
          </p>
        ) : (
          users.map((user) => (
            <div key={user.id} className="rounded-xl border border-[var(--border)] p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{user.name}</p>
                  <p className={`text-xs ${user.active ? "text-emerald-700 dark:text-emerald-300" : "text-[var(--muted)]"}`}>
                    {user.active ? "Active" : "Access paused"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className={btnSecondary} disabled={busy} onClick={() => {
                    setResetId(resetId === user.id ? null : user.id);
                    setResetPin("");
                  }}>
                    Reset PIN
                  </button>
                  <button className={btnSecondary} disabled={busy} onClick={() => void setActive(user, !user.active)}>
                    {user.active ? "Pause access" : "Restore access"}
                  </button>
                </div>
              </div>
              {resetId === user.id && (
                <div className="mt-3 flex flex-col gap-2 border-t border-[var(--border)] pt-3 sm:flex-row">
                  <label className="flex-1 text-sm font-medium">
                    New 4–12 digit PIN
                    <input
                      className={`${inputClass} mt-1`}
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="new-password"
                      value={resetPin}
                      onChange={(event) => setResetPin(event.target.value.replace(/\D/g, "").slice(0, 12))}
                    />
                  </label>
                  <button className={`${btn} sm:self-end`} disabled={busy || resetPin.length < 4} onClick={() => void saveReset(user)}>
                    Save new PIN
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <form className="mt-4 rounded-xl bg-[var(--surface-subtle)] p-3" onSubmit={(event) => void addUser(event)}>
        <h3 className="text-sm font-semibold">Add user</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="text-sm font-medium">
            Display name
            <input className={`${inputClass} mt-1`} autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="text-sm font-medium">
            4–12 digit PIN
            <input
              className={`${inputClass} mt-1`}
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="new-password"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 12))}
            />
          </label>
          <button className={btn} disabled={busy || !name.trim() || pin.length < 4} type="submit">
            {busy ? "Saving…" : "Add user"}
          </button>
        </div>
      </form>
      {message && <p className="mt-3 text-sm text-[var(--muted)]" role="status">{message}</p>}
    </section>
  );
}

interface PurchaseConfig {
  preferredSupplier: "digikey" | "lcsc";
  priceDifferenceThresholdPercent: number;
  normallyStockingOnly: boolean;
  excludeMarketplace: boolean;
  inStockOnly: boolean;
  minimumBoardCount: number;
  bulkOrderQuantities: number[];
  inexpensiveLineLimitUsd: number;
  takeNoExtraCostBreaks: boolean;
}

function PurchasingPanel() {
  const [config, setConfig] = useState<PurchaseConfig | null>(null);
  const [bulkDraft, setBulkDraft] = useState("");
  const [apis, setApis] = useState({ digikey: false, lcsc: false });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void jget<{ config: PurchaseConfig; apis: { digikey: boolean; lcsc: boolean } }>(
      "/api/settings/purchasing",
    )
      .then((result) => {
        if (active) {
          setConfig(result.config);
          setBulkDraft(result.config.bulkOrderQuantities.join(", "));
          setApis(result.apis);
        }
      })
      .catch((error) => {
        if (active && error instanceof Error && error.message !== "locked") {
          setMessage(error.message);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    if (!config) return;
    const bulkOrderQuantities = [
      ...new Set(
        bulkDraft
          .split(/[\s,]+/)
          .filter(Boolean)
          .map(Number),
      ),
    ].sort((a, b) => a - b);
    if (
      bulkOrderQuantities.length > 10 ||
      bulkOrderQuantities.some(
        (quantity) => !Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000,
      )
    ) {
      setMessage("Bulk quantities must be whole positive numbers, with at most 10 values.");
      return;
    }
    const nextConfig = { ...config, bulkOrderQuantities };
    setSaving(true);
    setMessage("");
    try {
      const result = await jput<{
        config: PurchaseConfig;
        apis: { digikey: boolean; lcsc: boolean };
      }>("/api/settings/purchasing", nextConfig);
      setConfig(result.config);
      setBulkDraft(result.config.bulkOrderQuantities.join(", "));
      setApis(result.apis);
      setMessage("Purchasing settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save purchasing settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={cardClass}>
      <h2 className="mb-1 font-medium">Purchasing comparison</h2>
      <p className="mb-3 text-sm text-black/60 dark:text-white/60">
        Build separate DigiKey and LCSC shortage lists. The preferred supplier is retained unless
        the other live offer is cheaper by at least this threshold. DigiKey searches use the NZ
        storefront; both APIs are requested in USD for comparison. Shipping, tax, and duties are
        not included.
      </p>
      {!config ? (
        <p className="text-sm text-black/50 dark:text-white/50">Loading…</p>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1 block text-black/60 dark:text-white/60">
                Preferred supplier
              </span>
              <select
                className={inputClass}
                value={config.preferredSupplier}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    preferredSupplier: event.target.value as "digikey" | "lcsc",
                  })
                }
              >
                <option value="digikey">DigiKey</option>
                <option value="lcsc">LCSC</option>
              </select>
            </label>
            <label>
              <span className="mb-1 block text-black/60 dark:text-white/60">
                Switch when cheaper by (%)
              </span>
              <input
                className={inputClass}
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={config.priceDifferenceThresholdPercent}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    priceDifferenceThresholdPercent: Number(event.target.value),
                  })
                }
              />
            </label>
          </div>
          <div className="rounded-xl border border-[var(--border)] p-3">
            <h3 className="text-sm font-semibold">Order quantity rules</h3>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Set the minimum workshop buffer and the price-break quantities the planner should test.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label>
                <span className="mb-1 block text-black/60 dark:text-white/60">Keep enough for boards</span>
                <input
                  className={inputClass}
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={config.minimumBoardCount}
                  onChange={(event) => setConfig({ ...config, minimumBoardCount: Number(event.target.value) })}
                />
              </label>
              <label>
                <span className="mb-1 block text-black/60 dark:text-white/60">Price-break quantities</span>
                <input
                  className={inputClass}
                  inputMode="numeric"
                  placeholder="25, 50, 100"
                  value={bulkDraft}
                  onChange={(event) => setBulkDraft(event.target.value)}
                />
              </label>
              <label>
                <span className="mb-1 block text-black/60 dark:text-white/60">Cheap line limit (USD)</span>
                <input
                  className={inputClass}
                  type="number"
                  min={0}
                  max={10000}
                  step={0.25}
                  value={config.inexpensiveLineLimitUsd}
                  onChange={(event) => setConfig({ ...config, inexpensiveLineLimitUsd: Number(event.target.value) })}
                />
              </label>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["normallyStockingOnly", "Normally stocking only"],
                ["excludeMarketplace", "Exclude marketplace"],
                ["inStockOnly", "In stock / enough quantity"],
                ["takeNoExtraCostBreaks", "Take larger quantity at no extra cost"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config[key]}
                  onChange={(event) => setConfig({ ...config, [key]: event.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
          <p className="text-xs text-black/50 dark:text-white/50">
            API status: DigiKey {apis.digikey ? "configured" : "not configured"} · LCSC{" "}
            {apis.lcsc ? "configured" : "not configured"}. LCSC comparison requires an approved
            LCSC API key.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button className={btn} onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save purchasing settings"}
            </button>
            {message && <span className="text-sm text-black/60 dark:text-white/60">{message}</span>}
          </div>
        </div>
      )}
    </section>
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
  rateLimited: boolean;
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
  const [rateLimited, setRateLimited] = useState(false);
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
    setRateLimited(false);
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
        if (res.rateLimited) setRateLimited(true);
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
        Look up DigiKey/Mouser/LCSC parts to fill details — one lookup per part, throttled to respect
        API rate limits.
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
              DigiKey/Mouser, plus LCSC via its C-number; unidentified parts are left unchanged.
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
          {done && !running && rateLimited && (
            <p className="mt-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              Stopped early: a distributor hit its <strong>daily rate limit (HTTP 429)</strong>. Your keys
              are fine — the quota is spent. Try again later (DigiKey resets daily); already-filled parts
              are skipped, so re-running picks up where this left off.
            </p>
          )}
          {done && !running && !rateLimited && live === 0 && (
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

/** The Fusion/EAGLE ULP scripts, served straight from /public so users can grab
 *  them here instead of hunting through the repo. Kept in sync with fusion/ulp/. */
const ULP_FILES: { file: string; title: string; blurb: string }[] = [
  {
    file: "extract-board.ulp",
    title: "extract-board.ulp",
    blurb: "Board editor → BOM + placements in one .json (import on the Boards page).",
  },
  {
    file: "extract-bom.ulp",
    title: "extract-bom.ulp",
    blurb: "Schematic or Board editor → grouped BOM (.json to import, .csv to paste).",
  },
  {
    file: "extract-placements.ulp",
    title: "extract-placements.ulp",
    blurb: "Board editor → placements + outline only (feeds the Assembly view).",
  },
  {
    file: "export-library.ulp",
    title: "export-library.ulp",
    blurb: "Library editor → library.json for the in-app Library editor round-trip.",
  },
];

/** Download links for the Fusion/EAGLE ULP scripts. */
function UlpPanel() {
  return (
    <section className={cardClass}>
      <h2 className="mb-1 font-medium">Fusion / EAGLE ULP scripts</h2>
      <p className="mb-3 text-sm text-black/60 dark:text-white/60">
        Download a script, then in Fusion&rsquo;s Electronics editor run{" "}
        <code>File → Execute ULP…</code> and pick it (or drop it in your ULP folder). Values are
        emitted as plain ASCII (e.g. <code>4.7kohm</code>, <code>4.7uF</code>) so symbols survive
        Excel/CSV round-trips.
      </p>
      <ul className="space-y-2 text-sm">
        {ULP_FILES.map((u) => (
          <li key={u.file} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <a href={`/ulp/${u.file}`} download className={btn}>
              {u.title}
            </a>
            <span className="text-black/60 dark:text-white/60">{u.blurb}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface ArucoConfig {
  dict: ArucoDictName;
  sizeMm: number;
}

/** Global ArUco settings: which dictionary location markers use, and their print size. */
function ArucoPanel() {
  const [dict, setDict] = useState<ArucoDictName>("6X6_250");
  const [sizeMm, setSizeMm] = useState(25);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const c = await jget<ArucoConfig>("/api/settings/aruco");
        if (active) {
          setDict(c.dict);
          setSizeMm(c.sizeMm);
          setLoaded(true);
        }
      } catch (e) {
        if (active && e instanceof Error && e.message !== "locked") setMsg(e.message);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      await jput("/api/settings/aruco", { dict, sizeMm });
      setMsg("Saved.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cardClass}>
      <h2 className="mb-1 font-medium">ArUco markers</h2>
      <p className="mb-3 text-sm text-black/60 dark:text-white/60">
        Dictionary and print size for the markers assigned to storage locations. Changing the
        dictionary affects how new markers are generated; re-print any markers you change.
      </p>
      <div className="flex flex-wrap items-end gap-4 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-black/60 dark:text-white/60">Dictionary</span>
          <select
            className={inputClass}
            value={dict}
            onChange={(e) => setDict(e.target.value as ArucoDictName)}
            disabled={!loaded || busy}
          >
            {ARUCO_DICT_NAMES.map((d) => (
              <option key={d} value={d}>
                {d} ({dictCapacity(d)} ids)
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-black/60 dark:text-white/60">Print size (mm)</span>
          <input
            className={inputClass}
            type="number"
            min={5}
            max={200}
            value={sizeMm}
            onChange={(e) => setSizeMm(Number(e.target.value))}
            disabled={!loaded || busy}
          />
        </label>
        <div className="flex flex-col items-center gap-1">
          <span className="text-black/60 dark:text-white/60">Preview (id 0)</span>
          <ArucoMarker dict={dict} id={0} size={64} />
        </div>
        <button className={btn} onClick={save} disabled={!loaded || busy || sizeMm < 5}>
          {busy ? "Saving…" : "Save"}
        </button>
        {msg && (
          <span
            className={
              msg === "Saved." ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"
            }
          >
            {msg}
          </span>
        )}
      </div>
    </section>
  );
}
