"use client";

import { useState } from "react";

import { Nav } from "@/components/Nav";
import { jget } from "@/lib/client";

interface PriceBreak {
  quantity: number;
  unitPrice: number;
  currency: string;
}

interface Offer {
  distributor: string;
  mpn: string;
  manufacturer: string;
  description: string;
  distributorPartNumber: string;
  stock: number;
  priceBreaks: PriceBreak[];
  productUrl: string;
  datasheetUrl: string | null;
  mock: boolean;
  note?: string;
}

interface Result {
  mpn: string;
  offers: Offer[];
}

export default function LookupPage() {
  const [mpn, setMpn] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setResult(await jget<Result>(`/api/parts/lookup?mpn=${encodeURIComponent(mpn.trim())}`));
    } catch (e) {
      if (e instanceof Error && e.message !== "locked") setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-5xl flex-1 p-6">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Part lookup</h1>
        <p className="mb-6 text-sm text-black/60 dark:text-white/60">
          Live price &amp; stock from DigiKey and Mouser by MPN.
        </p>

        <form onSubmit={search} className="mb-6 flex gap-2">
          <input
            data-shortcut-search
            aria-keyshortcuts="/"
            className="flex-1 rounded-md border border-black/15 bg-transparent px-3 py-2 font-mono outline-none focus:border-blue-500 dark:border-white/20"
            placeholder="MPN (e.g. MCP2221A-I/SL)"
            value={mpn}
            onChange={(e) => setMpn(e.target.value)}
          />
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            disabled={busy || !mpn.trim()}
          >
            {busy ? "Searching…" : "Search"}
          </button>
        </form>

        {error && (
          <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        {result && (
          <div className="space-y-3">
            {result.offers.length === 0 && (
              <p className="text-sm text-black/60 dark:text-white/60">No offers found.</p>
            )}
            {result.offers.map((o) => (
              <div
                key={o.distributor}
                className="rounded-xl border border-black/10 p-4 dark:border-white/15"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium capitalize">{o.distributor}</span>
                  {(o.note || o.mock) && (
                    <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">
                      {o.note ?? "mock — no API key"}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-sm text-black/70 dark:text-white/70">
                  {o.manufacturer && <span className="mr-2">{o.manufacturer}</span>}
                  {o.description}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <span>
                    Stock: <strong className="tabular-nums">{o.stock.toLocaleString()}</strong>
                  </span>
                  <span>From: {priceFrom(o)}</span>
                  <a
                    className="text-blue-600 hover:underline dark:text-blue-400"
                    href={o.productUrl}
                    target="_blank"
                    rel="noopener"
                  >
                    Product page →
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

function priceFrom(offer: Offer): string {
  if (offer.priceBreaks.length === 0) return "—";
  const min = offer.priceBreaks.reduce((a, b) => (b.unitPrice < a.unitPrice ? b : a));
  return `${min.unitPrice} ${min.currency} (@${min.quantity}+)`;
}
