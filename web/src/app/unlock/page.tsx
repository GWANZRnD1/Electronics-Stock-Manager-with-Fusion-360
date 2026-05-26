"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function UnlockPage() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        const next = new URLSearchParams(window.location.search).get("next") || "/";
        router.replace(next);
        router.refresh();
      } else {
        setError(res.status === 401 ? "Incorrect PIN." : "Something went wrong.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-black/10 p-6 dark:border-white/15"
      >
        <h1 className="text-lg font-semibold">Electronics Stock Manager</h1>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          Enter the access PIN to continue.
        </p>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN"
          className="mt-4 w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-blue-500 dark:border-white/20"
        />
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy || pin.length === 0}
          className="mt-4 w-full rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </form>
    </main>
  );
}
