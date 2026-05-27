# Fusion 360 → Electronics Stock Manager

One-click sync of your Fusion **Electronics shared component library** into the
app's part catalog. (Fusion has no library "part added" event or write API, so
this is a manual one-click sync rather than truly automatic — re-run it after
adding parts; it's idempotent.)

## Files

- `ulp/stocktaker-library.ulp` — run in the **Library editor**; exports each
  part's `mpn` + `manufacturer` to a `.txt` (TSV).
- `ulp/extract-bom.ulp` — run in the **Schematic/Board editor**; extracts the open
  design's BOM (grouped, with quantity + designators) to a `.json` + `.csv`.
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

## Extract a board's BOM (for shortage / build planning)

`ulp/extract-bom.ulp` reads the **open design** and writes its bill of materials —
grouped by part, with a per-line quantity and designator list. This feeds the
app's board → shortage → buy-links flow (separate from the library catalog sync).

1. Open the design and switch to the **Schematic** editor (preferred — it has the
   richest attributes; the **Board** editor also works as a fallback).
2. **Automate → Run ULP →** `ulp/extract-bom.ulp` → choose a save name. It writes
   two files side by side:
   - `<name>-bom.json` — matches the app's BOM payload exactly (`{ board, lines[] }`).
   - `<name>-bom.csv` — `MPN, qty, value, package, designators`, an alternative for
     pasting by hand.
3. In the app, go to **Boards → Import BOM (.json)** and pick the `.json`. It
   creates (or updates) the board and opens it with the BOM loaded. (Or open a
   board and paste the `.csv` into its BOM box; or POST the JSON to
   `/api/fusion/bom` from an add-in / `curl`.)

What it does:

- **Groups identical parts** into one line (by MPN if present, else
  value + package + deviceset) and sums the quantity, joining their designators.
- **Skips** parts set to *do-not-populate* and pure schematic symbols with no
  physical package (GND/VCC/frames) — those aren't real components.
- Reads the MPN from the usual attribute names (`MPN`, `MANUFACTURER_PART_NUMBER`,
  `MFR_PN`, …); lines without one still export (matched by value/package later).
- **Read-only** — it never modifies the design.

> Designators in the CSV are space-joined (not comma) on purpose: the paste box
> splits each line on `,`, so a comma inside a field would shift the columns.

## Bulk-rename library attributes (e.g. `Digikey` → `SPN`)

`ulp/rename-library-attributes.ulp` renames a device attribute across **every**
part in the open library. Fusion has no Python ECAD write API, but the Eagle
ULP→SCR→`ATTRIBUTE` path is the supported way to bulk-edit a library.

1. Edit the **RENAMES table** at the top of the ULP (seeded with `Digikey`→`SPN`;
   add more `OLD_NAME`/`NEW_NAME` rows and bump `RENAME_COUNT`).
2. Open your shared library in the **Library editor** (managed library: Library
   manager → right-click → **Edit**).
3. **Automate → Run ULP →** `rename-library-attributes.ulp`. It's a **dry run**:
   it previews what will change and saves a `.scr` (changes nothing yet). If
   nothing matches, it lists every attribute name it actually found so you can
   fix the table.
4. **Back up the library**, then **File → Execute Script →** the saved `.scr` to
   apply. Save the library.

Caveats: attributes edited in a schematic/board do **not** propagate back to the
library (by design) — that's why this runs in the **Library editor**. Editing a
managed library makes a new version; dependent designs get an "update available"
prompt. Verify on a copy first — the generated commands follow the documented
`EDIT/PACKAGE/TECHNOLOGY/ATTRIBUTE` structure but should be confirmed in your
Fusion version.

## Round-trip attribute management (export → edit JSON → apply)

For managing attributes across the whole library as versioned text (rename,
classify supplier, normalize, fill blanks) rather than one-off ULPs:

- `ulp/export-library.ulp` — Library editor → dumps every deviceset/variant/
  technology/attribute to `library.json`.
- `tools/fusion_attr_gui.py` — **GUI** spreadsheet editor (needs `tksheet`): open
  the JSON, edit cells, rename/add/delete attribute columns, rule-based bulk fill
  (e.g. SUPPLIER=Digikey where SPN ~ `-ND$`), then Export `apply.scr`.
- `tools/fusion_attr_editor.py` — **CLI** core (stdlib only): `to-csv` (edit in
  Excel) + `to-scr` (diff → `apply.scr`). The GUI reuses its diff/SCR engine.

See `tools/README.md` for both workflows. Fusion is only the in/out gate (Run ULP
to export, Run Script to apply); all edits happen in the GUI / CSV.

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
