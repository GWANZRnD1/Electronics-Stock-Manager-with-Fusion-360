"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Nav } from "@/components/Nav";
import { jdel, jget, jpatch, jpost } from "@/lib/client";

interface Board {
  id: number;
  name: string;
  revision: string;
  archived: boolean;
  createdAt: string;
}

interface Family {
  name: string;
  revisions: Board[]; // newest first
}

/**
 * Read an uploaded BOM JSON. Fusion's ULP `output()` writes the OS ANSI code
 * page, not UTF-8 — in practice Latin-1/Windows-1252, so e.g. `µ` is the single
 * byte 0xB5. Try UTF-8 strictly first; if that fails, fall back to Windows-1252,
 * which never throws and maps 0x80–0xFF straight to their Latin-1 characters.
 * We deliberately do NOT try EUC-KR: it would greedily pair a stray high byte
 * with the following ASCII byte and mint a bogus Hangul syllable (e.g. "µF" →
 * "킚") — the exact corruption this used to produce. (The ULP now also emits
 * plain ASCII, so a clean export decodes as UTF-8 and never needs the fallback.)
 */
async function readBomJson(file: File): Promise<unknown> {
  const buf = await file.arrayBuffer();
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return JSON.parse(text.replace(/^﻿/, "")); // strip a leading BOM
  } catch (e) {
    if (e instanceof SyntaxError) throw e; // decoded fine but isn't valid JSON
    // not valid UTF-8 — fall through to the Latin-1 reading
  }
  const text = new TextDecoder("windows-1252").decode(buf);
  return JSON.parse(text.replace(/^﻿/, ""));
}

/** Collapse board rows into families keyed by name; revisions newest-first. */
function groupByName(boards: Board[]): Family[] {
  const map = new Map<string, Board[]>();
  for (const b of boards) {
    const arr = map.get(b.name) ?? [];
    arr.push(b);
    map.set(b.name, arr);
  }
  return [...map.entries()]
    .map(([name, revisions]) => ({
      name,
      revisions: [...revisions].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const inputCls =
  "min-h-11 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20";
const btnSm =
  "min-h-11 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium hover:bg-[var(--surface-subtle)] disabled:opacity-50";

/** A self-contained inline editor (its own draft state) used for name/revision. */
function InlineEdit({
  initial,
  placeholder,
  busy,
  onSave,
  onCancel,
}: {
  initial: string;
  placeholder?: string;
  busy: boolean;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <span className="flex items-center gap-1.5">
      <input
        autoFocus
        className={inputCls}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave(value.trim());
          if (e.key === "Escape") onCancel();
        }}
      />
      <button className={btnSm} disabled={busy} onClick={() => onSave(value.trim())}>
        Save
      </button>
      <button className={btnSm} disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </span>
  );
}

export default function BoardsPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [name, setName] = useState("");
  const [revision, setRevision] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Per-family selected revision (board id) and the single active inline edit.
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [edit, setEdit] = useState<{ id: number; field: "name" | "revision" } | null>(null);

  const reload = useCallback(async () => {
    try {
      setBoards(await jget<Board[]>("/api/boards"));
    } catch (e) {
      if (e instanceof Error && e.message !== "locked") setError(e.message);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await jget<Board[]>("/api/boards");
        if (active) setBoards(list);
      } catch (e) {
        if (active && e instanceof Error && e.message !== "locked") setError(e.message);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await jpost("/api/boards", { name: name.trim(), revision: revision.trim() });
      setName("");
      setRevision("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  async function importBom(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked later
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const payload = await readBomJson(file);
      const rev = window.prompt(
        "Revision for this import? (e.g. RevB, v1.2 — leave blank for none)\n" +
          "Re-importing the same revision updates it; a different revision is kept as a new entry.",
        "",
      );
      if (rev === null) {
        setBusy(false);
        return; // cancelled
      }
      if (payload && typeof payload === "object" && "board" in payload) {
        (payload as { board: { revision?: string } }).board.revision = rev.trim();
      }
      const res = await jpost<{ boardId: number; lines: number }>("/api/boards/import", payload);
      router.push(`/boards/${res.boardId}`); // open the board — its BOM loads on mount
    } catch (e) {
      if (e instanceof Error && e.message === "locked") return; // redirected to /unlock
      if (e instanceof SyntaxError) {
        setError("That file isn't valid JSON — pick the .json from extract-bom.ulp.");
      } else {
        setError(e instanceof Error ? e.message : "Import failed.");
      }
      setBusy(false);
    }
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setEdit(null);
      await reload();
    } catch (e) {
      if (e instanceof Error && e.message !== "locked") setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function removeRevision(b: Board) {
    const label = b.revision ? `${b.name} (${b.revision})` : b.name;
    if (!window.confirm(`Delete "${label}"? Its BOM and build history are removed too.`)) return;
    void run(() => jdel(`/api/boards/${b.id}`));
  }

  function removeFamily(fam: Family) {
    if (!window.confirm(`Delete "${fam.name}" and all ${fam.revisions.length} revision(s)?`)) return;
    void run(async () => {
      for (const b of fam.revisions) await jdel(`/api/boards/${b.id}`);
    });
  }

  const active = groupByName(boards.filter((b) => !b.archived));
  const archived = groupByName(boards.filter((b) => b.archived));

  const pickedBoard = (fam: Family): Board =>
    fam.revisions.find((r) => r.id === selected[fam.name]) ?? fam.revisions[0];

  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-5xl flex-1 p-4 sm:p-6">
        <header className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-blue-700 dark:text-blue-300">
            Production
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Assemble a board</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Choose a revision and go straight to the guided assembly workspace. BOM and image setup stays one action away.
          </p>
        </header>

        {error && (
          <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <details className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
          <summary className="flex min-h-12 cursor-pointer items-center px-4 py-3 text-sm font-semibold">
            Add or import a board
          </summary>
          <div className="border-t border-[var(--border)] p-4">
        <div className="mb-2 flex flex-wrap gap-2">
          <form onSubmit={create} className="flex min-w-[16rem] flex-1 flex-wrap gap-2">
            <input
              className="min-h-11 min-w-[10rem] flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
              aria-label="New board name"
              placeholder="New board name (e.g. Sensor)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="min-h-11 w-32 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
              aria-label="Board revision"
              placeholder="Revision"
              value={revision}
              onChange={(e) => setRevision(e.target.value)}
            />
            <button
              type="submit"
              className="min-h-11 rounded-lg bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:opacity-50 dark:bg-blue-400 dark:text-slate-950"
              disabled={busy || !name.trim() || !revision.trim()}
            >
              Create
            </button>
          </form>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={btnSm}
            disabled={busy}
          >
            {busy ? "Working…" : "Import board (.json)"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={importBom}
          />
        </div>
        <p className="mt-3 text-sm leading-5 text-[var(--muted)]">
          Import the <code>.json</code> from Fusion&rsquo;s <code>extract-board.ulp</code> (BOM +
          placements in one file) or <code>extract-bom.ulp</code> (BOM only) — you&rsquo;ll be asked
          for a revision, then it creates (or updates) that revision and opens it. Same name,
          different revision = a new revision under that board.
        </p>
          </div>
        </details>

        {active.length === 0 ? (
          <p className="text-sm text-black/60 dark:text-white/60">No boards yet.</p>
        ) : (
          <ul className="space-y-3">
            {active.map((fam) => {
              const sel = pickedBoard(fam);
              const editingName = edit?.id === sel.id && edit.field === "name";
              const editingRev = edit?.id === sel.id && edit.field === "revision";
              return (
                <li
                  key={fam.name}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    {editingName ? (
                      <InlineEdit
                        initial={fam.name}
                        placeholder="board name"
                        busy={busy}
                        onSave={(v) => v && run(() => jpatch(`/api/boards/${sel.id}`, { name: v }))}
                        onCancel={() => setEdit(null)}
                      />
                    ) : (
                      <Link
                        href={`/boards/${sel.id}/view`}
                        className="text-lg font-medium tracking-tight hover:underline"
                      >
                        {fam.name}
                      </Link>
                    )}

                    {editingRev ? (
                      <InlineEdit
                        initial={sel.revision}
                        placeholder="revision (e.g. Rev B)"
                        busy={busy}
                        onSave={(v) => run(() => jpatch(`/api/boards/${sel.id}`, { revision: v }))}
                        onCancel={() => setEdit(null)}
                      />
                    ) : fam.revisions.length > 1 ? (
                      <select
                        className={inputCls}
                        value={sel.id}
                        onChange={(e) =>
                          setSelected((p) => ({ ...p, [fam.name]: Number(e.target.value) }))
                        }
                      >
                        {fam.revisions.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.revision || "(no revision)"}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-sm text-black/50 dark:text-white/50">
                        {sel.revision || "(no revision)"}
                      </span>
                    )}

                    {!editingName && !editingRev && (
                      <span className="ml-auto flex flex-wrap items-center gap-2">
                        <Link
                          href={`/boards/${sel.id}/view`}
                          className="flex min-h-11 items-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 dark:bg-blue-400 dark:text-slate-950"
                        >
                          Start assembly →
                        </Link>
                        <Link href={`/boards/${sel.id}`} className={btnSm}>
                          BOM &amp; setup
                        </Link>
                        <details className="relative">
                          <summary className={`${btnSm} flex cursor-pointer list-none items-center`}>Manage</summary>
                          <div className="absolute right-0 top-12 z-20 grid min-w-40 gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-xl">
                            <button className={`${btnSm} text-left`} disabled={busy} onClick={() => setEdit({ id: sel.id, field: "name" })}>Rename board</button>
                            <button className={`${btnSm} text-left`} disabled={busy} onClick={() => setEdit({ id: sel.id, field: "revision" })}>Edit revision</button>
                            <button className={`${btnSm} text-left`} disabled={busy} onClick={() => run(() => jpatch(`/api/boards/${sel.id}`, { archived: true }))}>Archive</button>
                            <button className={`${btnSm} text-left text-red-600 dark:text-red-400`} disabled={busy} onClick={() => removeRevision(sel)}>Delete revision</button>
                          </div>
                        </details>
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {archived.length > 0 && (
          <details className="mt-6 rounded-xl border border-black/10 dark:border-white/15">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-black/60 dark:text-white/60">
              Archived ({archived.length})
            </summary>
            <ul className="divide-y divide-black/10 border-t border-black/10 dark:divide-white/10 dark:border-white/15">
              {archived.map((fam) => {
                const sel = pickedBoard(fam);
                return (
                  <li
                    key={fam.name}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 text-sm"
                  >
                    <Link href={`/boards/${sel.id}/view`} className="font-medium hover:underline">
                      {fam.name}
                    </Link>
                    {fam.revisions.length > 1 ? (
                      <select
                        className={inputCls}
                        value={sel.id}
                        onChange={(e) =>
                          setSelected((p) => ({ ...p, [fam.name]: Number(e.target.value) }))
                        }
                      >
                        {fam.revisions.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.revision || "(no revision)"}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-black/40 dark:text-white/40">
                        {sel.revision || "(no revision)"}
                      </span>
                    )}
                    <span className="ml-auto flex gap-2">
                      <Link href={`/boards/${sel.id}/view`} className={btnSm}>
                        Assemble
                      </Link>
                      <Link href={`/boards/${sel.id}`} className={btnSm}>
                        BOM &amp; setup
                      </Link>
                      <button
                        className={btnSm}
                        disabled={busy}
                        onClick={() =>
                          run(() => jpatch(`/api/boards/${fam.revisions[0].id}`, { archived: false }))
                        }
                      >
                        Unarchive
                      </button>
                      <button
                        className={`${btnSm} text-red-600 dark:text-red-400`}
                        disabled={busy}
                        onClick={() => removeFamily(fam)}
                      >
                        Delete
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </main>
    </>
  );
}
