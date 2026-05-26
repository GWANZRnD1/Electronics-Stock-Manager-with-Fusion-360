"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Nav } from "@/components/Nav";
import { jget, jpost } from "@/lib/client";

interface Board {
  id: number;
  name: string;
  revision: string;
}

export default function BoardsPage() {
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

        <form onSubmit={create} className="mb-6 flex gap-2">
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
