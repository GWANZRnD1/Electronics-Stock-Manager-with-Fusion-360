"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Nav } from "@/components/Nav";
import { jget, jpost, jput } from "@/lib/client";
import { bomToText, parseBomText } from "@/lib/domain/bomText";

interface BomRow {
  id: number;
  partMpn: string | null;
  value: string;
  package: string;
  designators: string;
  qtyPerBoard: number;
}

interface ShortageLine {
  partKey: string;
  qtyPerBoard: number;
  required: number;
  available: number;
  shortage: number;
  reference: string;
  supplier?: string;
  bucket?: BuyBucket;
  buyLinks?: { digikey: string; mouser: string; lcsc: string } | null;
}

type BuyBucket = "digikey" | "mouser" | "lcsc" | "others";

const BUCKETS: { key: BuyBucket; label: string }[] = [
  { key: "digikey", label: "DigiKey" },
  { key: "mouser", label: "Mouser" },
  { key: "lcsc", label: "LCSC" },
  { key: "others", label: "Others" },
];

interface ShortageReport {
  boardCount: number;
  hasShortage: boolean;
  maxBuildable: number;
  lines: ShortageLine[];
  shortages: ShortageLine[];
}

interface BuildRow {
  id: number;
  quantity: number;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

// Real-MPN shortage keys only (not the synthetic "value|package" / "line-N"
// used for unmatched lines) — these are the parts that can be consumed/restored.
function isMpnKey(partKey: string): boolean {
  return !partKey.includes("|") && !partKey.startsWith("line-");
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Best-effort clipboard copy (secure-context only); returns whether it worked. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const inputClass =
  "w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-blue-500 dark:border-white/20";
const btnClass =
  "rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500 disabled:opacity-50";

export default function BoardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [boardName, setBoardName] = useState("");
  const [boardRev, setBoardRev] = useState("");
  const [siblings, setSiblings] = useState<{ id: number; revision: string }[]>([]);
  const [bomText, setBomText] = useState("");
  const [count, setCount] = useState("10");
  const [report, setReport] = useState<ShortageReport | null>(null);
  const [error, setError] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const [batchMsg, setBatchMsg] = useState("");
  // DigiKey bulk-add strings ("part,qty" per line). `raw` shows as soon as the
  // shortage report loads (jellybeans kept as descriptors); `resolved` is built
  // on batch click (jellybeans matched to real MPNs where possible).
  const [rawBatchText, setRawBatchText] = useState("");
  const [resolvedBatchText, setResolvedBatchText] = useState("");
  const [busy, setBusy] = useState(false);
  const [buildList, setBuildList] = useState<BuildRow[]>([]);
  const [buildMsg, setBuildMsg] = useState("");
  // Shortage lines (by partKey) ticked for build/cancel; reset to all on each check.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [boardList, bom, blds] = await Promise.all([
          jget<{ id: number; name: string; revision: string }[]>("/api/boards"),
          jget<BomRow[]>(`/api/boards/${id}/bom`),
          jget<BuildRow[]>(`/api/boards/${id}/builds`),
        ]);
        if (!active) return;
        const me = boardList.find((b) => String(b.id) === String(id));
        setBoardName(me?.name ?? `Board ${id}`);
        setBoardRev(me?.revision ?? "");
        setSiblings(
          me
            ? boardList
                .filter((b) => b.name === me.name)
                .map((b) => ({ id: b.id, revision: b.revision }))
                .sort((a, b) => a.id - b.id)
            : [],
        );
        setBomText(bomToText(bom));
        setBuildList(blds);
      } catch (e) {
        if (active && e instanceof Error && e.message !== "locked") setError(e.message);
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  async function saveBom() {
    setBusy(true);
    setError("");
    setSavedMsg("");
    try {
      const r = await jput<{ count: number }>(`/api/boards/${id}/bom`, {
        lines: parseBomText(bomText),
      });
      setSavedMsg(`Saved ${r.count} BOM lines.`);
      setReport(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    setBusy(true);
    setError("");
    setBatchMsg("");
    setResolvedBatchText("");
    try {
      const rep = await jget<ShortageReport>(`/api/boards/${id}/shortage?count=${Number(count) || 0}`);
      const keys = rep.lines.map((l) => l.partKey);
      const prevKeys = new Set((report?.lines ?? []).map((l) => l.partKey));
      setReport(rep);
      // Raw bulk-add list (DigiKey group, jellybeans as-is) — available immediately.
      const dkRaw = rep.shortages.filter((l) => l.bucket === "digikey");
      setRawBatchText(dkRaw.map((l) => `${l.partKey},${l.shortage}`).join("\n"));
      // First check: tick everything. Re-check: keep the user's ticks (drop lines
      // that vanished), and tick only lines that are new since the last check — so
      // unticking a part survives a re-check instead of snapping back to all.
      setSelected((prev) => {
        if (!report) return new Set(keys);
        const keySet = new Set(keys);
        const next = new Set([...prev].filter((k) => keySet.has(k)));
        for (const k of keys) if (!prevKeys.has(k)) next.add(k);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  // The ticked, MPN-matched shortage lines — the parts a build/cancel acts on.
  function selectedMpns(): string[] {
    if (!report) return [];
    return report.lines
      .filter((l) => selected.has(l.partKey) && isMpnKey(l.partKey))
      .map((l) => l.partKey);
  }

  function toggleLine(partKey: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(partKey)) next.delete(partKey);
      else next.add(partKey);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked && report ? new Set(report.lines.map((l) => l.partKey)) : new Set());
  }

  async function refreshBuilds() {
    try {
      setBuildList(await jget<BuildRow[]>(`/api/boards/${id}/builds`));
    } catch {
      /* ignore */
    }
  }

  async function buildNow() {
    const qty = Number(count) || 0;
    if (qty < 1) {
      setBuildMsg("Enter how many boards to build.");
      return;
    }
    if (!report) {
      setBuildMsg("Run 'Check shortage' first, then tick the parts to consume.");
      return;
    }
    const parts = selectedMpns();
    if (parts.length === 0) {
      setBuildMsg("Tick at least one tracked part (one with an MPN) to consume.");
      return;
    }
    setBusy(true);
    setBuildMsg("");
    try {
      // Direct fetch (not jpost) so we can read the 409 body's `shortages` and
      // name exactly which ticked parts blocked the build.
      const res = await fetch(`/api/boards/${id}/build`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quantity: qty, parts }),
      });
      if (res.status === 401) {
        window.location.href = "/unlock";
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        consumed?: { mpn: string }[];
        shortages?: { mpn: string; required: number; available: number }[];
        error?: string;
      };
      if (res.status === 409 && data.shortages?.length) {
        const list = data.shortages
          .map((s) => `${s.mpn} (need ${s.required}, have ${s.available})`)
          .join(", ");
        setBuildMsg(`Not enough stock to build ${qty}: ${list}. Untick those or lower the count.`);
        return;
      }
      if (!res.ok) {
        setBuildMsg(data.error ?? "Build failed.");
        return;
      }
      setBuildMsg(`Built ${qty} — consumed ${data.consumed?.length ?? 0} selected part type(s).`);
      await refreshBuilds();
      await check(); // re-run shortage to show updated stock
    } catch (e) {
      setBuildMsg(e instanceof Error ? e.message : "Build failed.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelBuild() {
    if (!report) {
      setBuildMsg("Run 'Check shortage' first, then tick the parts to restore.");
      return;
    }
    const parts = selectedMpns();
    if (parts.length === 0) {
      setBuildMsg("Tick at least one tracked part to restore.");
      return;
    }
    setBusy(true);
    setBuildMsg("");
    try {
      const r = await jpost<{ buildId: number; reversed: { mpn: string }[]; fullyCancelled: boolean }>(
        `/api/boards/${id}/build/cancel`,
        { parts },
      );
      setBuildMsg(
        `Restored ${r.reversed.length} part type(s) to stock (reversed build #${r.buildId}` +
          (r.fullyCancelled ? ", now fully cancelled)." : ")."),
      );
      await refreshBuilds();
      await check();
    } catch (e) {
      if (e instanceof Error && e.message === "no build to cancel") {
        setBuildMsg("No matching build to cancel — the ticked parts weren't in the last build.");
      } else {
        setBuildMsg(e instanceof Error ? e.message : "Cancel failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function digikeyBatch() {
    if (!report) return;
    const dk = report.shortages.filter((s) => s.bucket === "digikey" && s.buyLinks);
    if (dk.length === 0) {
      setBatchMsg("No DigiKey-group shortages to batch.");
      return;
    }
    setBatchMsg("Resolving jellybeans on DigiKey…");
    try {
      // Descriptors (e.g. "2.2 kOhm 0603 (1608 Metric)", with spaces) get resolved
      // to a real in-stock DigiKey MPN; real MPNs (single token) pass through.
      const isDescriptor = (key: string) => /\s/.test(key.trim());
      const jelly = dk.filter((s) => isDescriptor(s.partKey));

      const resolvedMap = new Map<string, string>(); // descriptor -> real MPN
      let unresolved = 0;
      let rateLimited = 0;
      if (jelly.length > 0) {
        const r = await jpost<{
          resolved: { descriptor: string; mpn: string | null; reason?: string }[];
        }>("/api/buy/resolve-jellybeans", {
          items: jelly.map((s) => ({ descriptor: s.partKey, quantity: s.shortage })),
        });
        for (const it of r.resolved) {
          if (it.mpn) resolvedMap.set(it.descriptor, it.mpn);
          else {
            unresolved += 1;
            if (it.reason === "rate_limited") rateLimited += 1;
          }
        }
      }

      // Final list: real MPNs as-is; jellybeans → resolved MPN, or kept AS the
      // descriptor when unmatched (an unresolved jellybean is never dropped).
      const items = dk.map((s) => ({
        partNumber: isDescriptor(s.partKey) ? (resolvedMap.get(s.partKey) ?? s.partKey) : s.partKey,
        quantity: s.shortage,
      }));
      const bulk = items.map((i) => `${i.partNumber},${i.quantity}`).join("\n");
      setResolvedBatchText(bulk);
      const copied = await copyToClipboard(bulk);

      const note =
        unresolved > 0
          ? ` — ${unresolved} jellybean(s) kept as-is (no DigiKey match` +
            (rateLimited > 0 ? `; ${rateLimited} rate-limited, retry soon` : "") +
            ")."
          : ".";

      try {
        const b = await jpost<{ url: string }>("/api/buy/digikey-batch", { items });
        window.open(b.url, "_blank", "noopener");
        setBatchMsg(
          `${copied ? "Copied the resolved list and opened" : "Opened"} a DigiKey list (${items.length} part type(s))${note}`,
        );
      } catch (e) {
        // API list failed, but the resolved bulk-add string is still copied/shown.
        setBatchMsg(
          `DigiKey list API unavailable (${e instanceof Error ? e.message : "error"}). ` +
            `The resolved bulk-add list is ${copied ? "copied" : "shown below"} — paste it into DigiKey's “Add Multiple Parts”.${note}`,
        );
      }
    } catch (e) {
      setBatchMsg(
        `DigiKey batch unavailable (${e instanceof Error ? e.message : "error"}). Use the bulk-add list or per-part links.`,
      );
    }
  }

  async function copyText(text: string) {
    if (!text) return;
    const ok = await copyToClipboard(text);
    setBatchMsg(
      ok ? "Copied to the clipboard." : "Copy failed — select the text and copy it.",
    );
  }

  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-5xl flex-1 p-6">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{boardName || "Board"}</h1>
          {siblings.length > 1 ? (
            <select
              className="rounded-md border border-black/15 bg-transparent px-2 py-1 text-sm outline-none focus:border-blue-500 dark:border-white/20"
              value={id}
              onChange={(e) => router.push(`/boards/${e.target.value}`)}
              aria-label="Switch revision"
            >
              {siblings.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.revision || "(no revision)"}
                </option>
              ))}
            </select>
          ) : (
            boardRev && (
              <span className="text-base font-normal text-black/50 dark:text-white/50">{boardRev}</span>
            )
          )}
        </div>
        <p className="mb-6 text-sm text-black/60 dark:text-white/60">
          Paste the BOM, then check how many you can build and what to buy.
        </p>

        {error && (
          <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <section className="mb-6 rounded-xl border border-black/10 p-5 dark:border-white/15">
          <h2 className="mb-1 font-medium">BOM</h2>
          <p className="mb-3 text-sm text-black/50 dark:text-white/50">
            One line per part: <code>MPN, qty, value, package, designators</code> (only MPN + qty
            needed). Lines without an MPN show as fully short.
          </p>
          <textarea
            className={`${inputClass} h-48 font-mono text-sm`}
            placeholder={"MCP2221A-I/SL, 1, , SOIC-14, U1\nC-100N, 4, 100nF, 0402, C1 C2 C3 C4"}
            value={bomText}
            onChange={(e) => setBomText(e.target.value)}
          />
          <div className="mt-3 flex items-center gap-3">
            <button className={btnClass} onClick={saveBom} disabled={busy}>
              {busy ? "Saving…" : "Save BOM"}
            </button>
            {savedMsg && <span className="text-sm text-black/70 dark:text-white/70">{savedMsg}</span>}
          </div>
        </section>

        <section className="rounded-xl border border-black/10 p-5 dark:border-white/15">
          <h2 className="mb-3 font-medium">Build check</h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-black/60 dark:text-white/60">Boards to build</span>
              <input
                className={`${inputClass} w-32`}
                type="number"
                min={0}
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            </label>
            <button className={btnClass} onClick={check} disabled={busy}>
              {busy ? "Checking…" : "Check shortage"}
            </button>
            <button
              className="rounded-md bg-green-700 px-4 py-2 font-medium text-white hover:bg-green-600 disabled:opacity-50"
              onClick={buildNow}
              disabled={busy}
            >
              Build &amp; consume
            </button>
            <button
              className="rounded-md border border-black/15 px-4 py-2 font-medium hover:bg-black/[0.03] disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/[0.04]"
              onClick={cancelBuild}
              disabled={busy}
            >
              Cancel build
            </button>
          </div>
          <p className="mt-2 text-xs text-black/45 dark:text-white/45">
            Check shortage first, then tick parts. Build &amp; consume draws only the ticked parts;
            Cancel build restores the ticked parts from the most recent build.
          </p>
          {buildMsg && <p className="mt-2 text-sm text-black/70 dark:text-white/70">{buildMsg}</p>}

          {report && (
            <ShortageView
              report={report}
              selected={selected}
              onToggle={toggleLine}
              onToggleAll={toggleAll}
              onDigikeyBatch={digikeyBatch}
              batchMsg={batchMsg}
              rawBatchText={rawBatchText}
              resolvedBatchText={resolvedBatchText}
              onCopy={copyText}
            />
          )}

          {buildList.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-2 font-medium">Build history</h3>
              <ul className="divide-y divide-black/10 rounded-lg border border-black/10 text-sm dark:divide-white/10 dark:border-white/15">
                {buildList.map((b) => (
                  <li key={b.id} className="flex items-center justify-between px-3 py-2">
                    <span>
                      {b.quantity} board(s)
                      {b.status === "cancelled" && (
                        <span className="ml-2 text-amber-600 dark:text-amber-400">cancelled</span>
                      )}
                    </span>
                    <span className="text-black/50 dark:text-white/50">
                      {fmtDate(b.completedAt ?? b.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </main>
    </>
  );
}

function ShortageView({
  report,
  selected,
  onToggle,
  onToggleAll,
  onDigikeyBatch,
  batchMsg,
  rawBatchText,
  resolvedBatchText,
  onCopy,
}: {
  report: ShortageReport;
  selected: Set<string>;
  onToggle: (partKey: string) => void;
  onToggleAll: (checked: boolean) => void;
  onDigikeyBatch: () => void;
  batchMsg: string;
  rawBatchText: string;
  resolvedBatchText: string;
  onCopy: (text: string) => void;
}) {
  const allChecked = report.lines.length > 0 && report.lines.every((l) => selected.has(l.partKey));
  return (
    <div className="mt-5">
      <p className="mb-4 text-sm">
        With current stock you can build{" "}
        <strong className="tabular-nums">{report.maxBuildable}</strong> board(s).{" "}
        {report.hasShortage ? (
          <span className="text-red-600 dark:text-red-400">
            {report.shortages.length} part(s) short for {report.boardCount}.
          </span>
        ) : (
          <span className="text-green-700 dark:text-green-400">
            Enough for {report.boardCount}. ✓
          </span>
        )}
      </p>

      {report.lines.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-black/50 dark:text-white/50">
              <tr className="border-b border-black/10 dark:border-white/15">
                <th className="py-2 pr-3">
                  <input
                    type="checkbox"
                    aria-label="Select all parts"
                    checked={allChecked}
                    onChange={(e) => onToggleAll(e.target.checked)}
                  />
                </th>
                <th className="py-2 pr-4 font-medium">Part</th>
                <th className="py-2 pr-4 text-right font-medium">Per board</th>
                <th className="py-2 pr-4 text-right font-medium">Required</th>
                <th className="py-2 pr-4 text-right font-medium">Available</th>
                <th className="py-2 pr-4 text-right font-medium">Short</th>
              </tr>
            </thead>
            <tbody>
              {report.lines.map((l) => (
                <tr key={l.partKey} className="border-b border-black/5 dark:border-white/10">
                  <td className="py-2 pr-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${l.partKey}`}
                      checked={selected.has(l.partKey)}
                      onChange={() => onToggle(l.partKey)}
                    />
                  </td>
                  <td className="py-2 pr-4">
                    <span className="font-mono">{l.partKey}</span>
                    {l.reference && (
                      <span className="ml-2 text-black/40 dark:text-white/40">{l.reference}</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{l.qtyPerBoard}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{l.required}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{l.available}</td>
                  <td
                    className={`py-2 pr-4 text-right tabular-nums ${
                      l.shortage > 0 ? "font-semibold text-red-600 dark:text-red-400" : ""
                    }`}
                  >
                    {l.shortage > 0 ? l.shortage : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report.shortages.length > 0 && (
        <div className="mt-6 rounded-lg border border-black/10 p-4 dark:border-white/15">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h3 className="font-medium">Buy shortages</h3>
            {report.shortages.some((s) => s.bucket === "digikey") && (
              <button
                className="rounded-md bg-[#cc0000] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#b30000]"
                onClick={onDigikeyBatch}
              >
                DigiKey batch list →
              </button>
            )}
            {batchMsg && <span className="text-sm text-black/60 dark:text-white/60">{batchMsg}</span>}
          </div>

          <BulkAddBox
            label="Bulk-add list — as-is (jellybeans kept as descriptors). Paste into DigiKey “Add Multiple Parts” (part,qty)"
            text={rawBatchText}
            onCopy={onCopy}
          />
          <BulkAddBox
            label="Bulk-add list — DigiKey-resolved (jellybeans matched to real MPNs where possible)"
            text={resolvedBatchText}
            onCopy={onCopy}
          />

          <div className="space-y-4">
            {BUCKETS.map(({ key, label }) => {
              const items = report.shortages.filter((s) => (s.bucket ?? "others") === key);
              if (items.length === 0) return null;
              return (
                <div key={key}>
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-black/45 dark:text-white/45">
                    {label} <span className="font-normal">({items.length})</span>
                  </h4>
                  <ul className="space-y-2 text-sm">
                    {items.map((s) => (
                      <li key={s.partKey} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-mono">{s.partKey}</span>
                        <span className="text-black/50 dark:text-white/50">need {s.shortage}</span>
                        <BuyLinks bucket={key} links={s.buyLinks} />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function BuyLinks({
  bucket,
  links,
}: {
  bucket: BuyBucket;
  links?: { digikey: string; mouser: string; lcsc: string } | null;
}) {
  if (!links) {
    return <span className="text-amber-600 dark:text-amber-400">no MPN — match needed</span>;
  }
  const cls = "text-blue-600 hover:underline dark:text-blue-400";
  if (bucket === "digikey")
    return (
      <a className={cls} href={links.digikey} target="_blank" rel="noopener">
        DigiKey →
      </a>
    );
  if (bucket === "mouser")
    return (
      <a className={cls} href={links.mouser} target="_blank" rel="noopener">
        Mouser →
      </a>
    );
  if (bucket === "lcsc")
    return (
      <a className={cls} href={links.lcsc} target="_blank" rel="noopener">
        LCSC →
      </a>
    );
  return (
    <span className="flex gap-2">
      <a className={cls} href={links.digikey} target="_blank" rel="noopener">
        DigiKey
      </a>
      <a className={cls} href={links.mouser} target="_blank" rel="noopener">
        Mouser
      </a>
      <a className={cls} href={links.lcsc} target="_blank" rel="noopener">
        LCSC
      </a>
    </span>
  );
}

function BulkAddBox({
  label,
  text,
  onCopy,
}: {
  label: string;
  text: string;
  onCopy: (text: string) => void;
}) {
  if (!text) return null;
  return (
    <div className="mb-4">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium text-black/50 dark:text-white/50">{label}</span>
        <button
          className="rounded border border-black/15 px-2 py-0.5 text-xs hover:bg-black/[0.03] dark:border-white/20 dark:hover:bg-white/[0.04]"
          onClick={() => onCopy(text)}
        >
          Copy
        </button>
      </div>
      <textarea
        readOnly
        className="h-28 w-full rounded-md border border-black/15 bg-transparent p-2 font-mono text-xs outline-none dark:border-white/20"
        value={text}
        onFocus={(e) => e.currentTarget.select()}
      />
    </div>
  );
}
