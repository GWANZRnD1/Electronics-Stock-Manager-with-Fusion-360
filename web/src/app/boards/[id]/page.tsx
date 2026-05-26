"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Nav } from "@/components/Nav";
import { jget, jpost, jput } from "@/lib/client";

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
  buyLinks?: { digikey: string; mouser: string; lcsc: string } | null;
}

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

interface BomLineInput {
  partMpn: string | null;
  value: string;
  package: string;
  designators: string;
  qtyPerBoard: number;
}

// One line per part: "MPN, qty, value, package, designators" (only MPN + qty required).
function parseBom(text: string): BomLineInput[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const [mpn, qty, value, pkg, des] = line.split(",").map((s) => s.trim());
      return {
        partMpn: mpn || null,
        qtyPerBoard: Math.max(1, parseInt(qty || "1", 10) || 1),
        value: value ?? "",
        package: pkg ?? "",
        designators: des ?? "",
      };
    });
}

function bomToText(rows: BomRow[]): string {
  return rows
    .map((r) => [r.partMpn ?? "", r.qtyPerBoard, r.value, r.package, r.designators].join(", "))
    .join("\n");
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

const inputClass =
  "w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-blue-500 dark:border-white/20";
const btnClass =
  "rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500 disabled:opacity-50";

export default function BoardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [boardName, setBoardName] = useState("");
  const [bomText, setBomText] = useState("");
  const [count, setCount] = useState("10");
  const [report, setReport] = useState<ShortageReport | null>(null);
  const [error, setError] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const [batchMsg, setBatchMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [buildList, setBuildList] = useState<BuildRow[]>([]);
  const [buildMsg, setBuildMsg] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [boardList, bom, blds] = await Promise.all([
          jget<{ id: number; name: string }[]>("/api/boards"),
          jget<BomRow[]>(`/api/boards/${id}/bom`),
          jget<BuildRow[]>(`/api/boards/${id}/builds`),
        ]);
        if (!active) return;
        setBoardName(boardList.find((b) => String(b.id) === String(id))?.name ?? `Board ${id}`);
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
      const r = await jput<{ count: number }>(`/api/boards/${id}/bom`, { lines: parseBom(bomText) });
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
    try {
      setReport(await jget<ShortageReport>(`/api/boards/${id}/shortage?count=${Number(count) || 0}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
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
    setBusy(true);
    setBuildMsg("");
    try {
      const r = await jpost<{ consumed: { mpn: string }[]; untracked: number }>(
        `/api/boards/${id}/build`,
        { quantity: qty },
      );
      setBuildMsg(
        `Built ${qty} — consumed ${r.consumed.length} part type(s)` +
          (r.untracked ? `, ${r.untracked} untracked (no MPN).` : "."),
      );
      await refreshBuilds();
      await check(); // re-run shortage to show updated stock
    } catch (e) {
      if (e instanceof Error && e.message === "insufficient stock") {
        setBuildMsg("Not enough stock — run 'Check shortage' to see what's missing.");
      } else {
        setBuildMsg(e instanceof Error ? e.message : "Build failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function digikeyBatch() {
    if (!report) return;
    const items = report.shortages
      .filter((s) => s.buyLinks)
      .map((s) => ({ partNumber: s.partKey, quantity: s.shortage }));
    if (items.length === 0) {
      setBatchMsg("No MPN-matched shortages to batch.");
      return;
    }
    setBatchMsg("Building DigiKey list…");
    try {
      const r = await jpost<{ url: string }>("/api/buy/digikey-batch", { items });
      window.open(r.url, "_blank", "noopener");
      setBatchMsg("Opened a DigiKey list (with all shortages) in a new tab.");
    } catch (e) {
      setBatchMsg(
        `DigiKey batch unavailable (${e instanceof Error ? e.message : "error"}). Use per-part links below.`,
      );
    }
  }

  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-5xl flex-1 p-6">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">{boardName || "Board"}</h1>
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
          </div>
          {buildMsg && <p className="mt-2 text-sm text-black/70 dark:text-white/70">{buildMsg}</p>}

          {report && <ShortageView report={report} onDigikeyBatch={digikeyBatch} batchMsg={batchMsg} />}

          {buildList.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-2 font-medium">Build history</h3>
              <ul className="divide-y divide-black/10 rounded-lg border border-black/10 text-sm dark:divide-white/10 dark:border-white/15">
                {buildList.map((b) => (
                  <li key={b.id} className="flex items-center justify-between px-3 py-2">
                    <span>{b.quantity} board(s)</span>
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
  onDigikeyBatch,
  batchMsg,
}: {
  report: ShortageReport;
  onDigikeyBatch: () => void;
  batchMsg: string;
}) {
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
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h3 className="font-medium">Buy shortages</h3>
            <button
              className="rounded-md bg-[#cc0000] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#b30000]"
              onClick={onDigikeyBatch}
            >
              DigiKey batch list →
            </button>
            {batchMsg && <span className="text-sm text-black/60 dark:text-white/60">{batchMsg}</span>}
          </div>
          <ul className="space-y-2 text-sm">
            {report.shortages.map((s) => (
              <li key={s.partKey} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono">{s.partKey}</span>
                <span className="text-black/50 dark:text-white/50">need {s.shortage}</span>
                {s.buyLinks ? (
                  <span className="flex gap-2">
                    <a className="text-blue-600 hover:underline dark:text-blue-400" href={s.buyLinks.digikey} target="_blank" rel="noopener">DigiKey</a>
                    <a className="text-blue-600 hover:underline dark:text-blue-400" href={s.buyLinks.mouser} target="_blank" rel="noopener">Mouser</a>
                    <a className="text-blue-600 hover:underline dark:text-blue-400" href={s.buyLinks.lcsc} target="_blank" rel="noopener">LCSC</a>
                  </span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400">no MPN — match needed</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
