# Fusion 360 → Electronics Stock Manager

One-click sync of your Fusion **Electronics shared component library** into the
app's part catalog. (Fusion has no library "part added" event or write API, so
this is a manual one-click sync rather than truly automatic — re-run it after
adding parts; it's idempotent.)

## Files

- `ulp/stocktaker-library.ulp` — run in the **Library editor**; exports each
  part's `mpn` + `manufacturer` to a `.txt` (TSV).
- `addin/StocktakerSync/` — a Fusion **Script** that reads that file and uploads
  it to the app (`POST /api/fusion/library`).

## Setup (once)

1. Copy `addin/StocktakerSync/config.example.json` → `config.json` (same folder)
   and set:
   - `apiBaseUrl` — your deployed app URL (e.g. `https://your-app.vercel.app`),
     or `http://localhost:3000` for local.
   - `apiToken` — the **FUSION_API_TOKEN** value (see below). Leave empty if the
     server has none set (local dev).
2. In Fusion: **Utilities → Scripts and Add-Ins → the green `+`** → select the
   `addin/StocktakerSync` folder. (config.json stays local; it is gitignored.)

## Use (each sync)

1. Open your shared library in the **Library editor**.
2. **Automate → Run ULP →** `ulp/stocktaker-library.ulp` → save the `.txt`.
3. **Scripts and Add-Ins → Run** `StocktakerSync` → pick that `.txt`.
4. Open the app → **Catalog** → parts appear with stock (a number, or "none").

## What is `apiToken` / `FUSION_API_TOKEN`?

It is **not** an Autodesk/DigiKey/Mouser token — it's a shared secret **you
generate yourself** to protect the app's machine-to-machine endpoints
(`/api/fusion/*`), which bypass the browser PIN gate. Set the **same** value in:

- the server: env var `FUSION_API_TOKEN` (in `web/.env.local` and in Vercel), and
- this script: `apiToken` in `config.json`.

If `FUSION_API_TOKEN` is unset on the server, the endpoint is open (fine for local
dev) — **set it in production** so randoms can't POST to your catalog. Generate any
long random string, e.g. in PowerShell:
`[Convert]::ToHexString((1..32 | %{Get-Random -Max 256}))`.

## Notes

- Only parts with an **MPN attribute** are exported (the catalog keys on MPN). If
  your library stores the MPN under a different attribute name, add it to the list
  in the ULP, or share a sample export and we'll map it.
- Re-running is safe: upsert by MPN (no duplicates). Parts removed from the library
  are **not** deleted from the app (this preserves their stock and history).
- The first sync of a large library is sent in **batches of 500 with light pacing**
  so it doesn't overload the database/API.
- ECAD 3D models are **STEP**, not STL. Fetching footprints/3D by MPN is handled by
  external tools (SnapEDA / SamacSys / Ultra Librarian) — see project notes.
