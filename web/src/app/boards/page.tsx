"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Nav } from "@/components/Nav";
import { jget, jpost } from "@/lib/client";

interface Board {
  id: number;
  name: string;
  revision: string;
}

/**
 * Read an uploaded BOM JSON. Fusion's ULP `output()` writes in the OS ANSI code
 * page, not UTF-8 — on Korean Windows that's cp949/EUC-KR (so `µ`→μ, `Ω`, `±`
 * come out as multi-byte EUC-KR). Try UTF-8 strictly, then EUC-KR, then a final
 * windows-1252 safety net (never throws), and use whichever decodes cleanly.
 */
async function readBomJson(file: File): Promise<unknown> {
  const buf = await file.arrayBuffer();
  for (const label of ["utf-8", "euc-kr"]) {
    try {
      const text = new TextDecoder(label, { fatal: true }).decode(buf);
      return JSON.parse(text.replace(/^﻿/, "")); // strip a leading BOM
    } catch (e) {
      if (e instanceof SyntaxError) throw e; // decoded fine but isn't valid JSON
      // otherwise this encoding didn't fit — try the next one
    }
  }
  const text = new TextDecoder("windows-1252").decode(buf);
  return JSON.parse(text.replace(/^﻿/, ""));
}

export default function BoardsPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
      await jpost("/api/boards", { name: name.trim() });
      setName("");
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

  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-5xl flex-1 p-6">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Boards</h1>

        {error && (
          <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="mb-2 flex flex-wrap gap-2">
          <form onSubmit={create} className="flex min-w-[16rem] flex-1 gap-2">
            <input
              className="flex-1 rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-blue-500 dark:border-white/20"
              placeholder="New board name (e.g. Sensor Rev B)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              disabled={busy || !name.trim()}
            >
              Create
            </button>
          </form>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-md border border-black/15 px-4 py-2 font-medium hover:bg-black/[0.03] disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/[0.04]"
            disabled={busy}
          >
            {busy ? "Importing…" : "Import BOM (.json)"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={importBom}
          />
        </div>
        <p className="mb-6 text-sm text-black/50 dark:text-white/50">
          Import the <code>.json</code> from Fusion&rsquo;s <code>extract-bom.ulp</code> — it
          creates (or updates) the board and opens it.
        </p>

        {boards.length === 0 ? (
          <p className="text-sm text-black/60 dark:text-white/60">No boards yet.</p>
        ) : (
          <ul className="divide-y divide-black/10 rounded-xl border border-black/10 dark:divide-white/10 dark:border-white/15">
            {boards.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/boards/${b.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                >
                  <span className="font-medium">{b.name}</span>
                  <span className="text-sm text-black/50 dark:text-white/50">Open →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
