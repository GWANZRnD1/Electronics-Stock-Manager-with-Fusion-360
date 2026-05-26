# Architecture

## Overview

```
Fusion 360 (desktop)
  ┌────────────────┐   CSV/JSON   ┌──────────────────────┐
  │ custom ULP      │ ───────────► │ Python add-in         │
  │ (run in schem.) │ refdes,value │ (UI button + HTTPS)   │
  │                │ package,MPN  │                       │
  └────────────────┘              └──────────┬────────────┘
                                             │ HTTPS + token
                                             ▼
  ┌───────────────────────────────────────────────────────┐
  │ Next.js web app (Vercel)                               │
  │  API routes (backend):                                 │
  │   · auth (e.g. GitHub OAuth)                           │
  │   · inventory (Part / StockItem / Location / Txn)      │
  │   · BOM (Board / BomLine / shortage calc)              │
  │   · builds (Build / Consumption / history)             │
  │   · distributor adapters (DigiKey / Mouser / LCSC)     │
  │   · barcode parser (ECIA DataMatrix + LCSC QR)         │
  │  frontend (PWA): BOM / inventory / scan / build views  │
  │            │ Drizzle ORM                               │
  │            ▼                                           │
  │  Neon Postgres                                         │
  └───────────────────────────────────────────────────────┘
        ▲ same origin (API routes)          ▲
   PWA mobile (camera scan, @zxing)     PWA desktop
```

## Key constraint: Fusion 360 ECAD has no Python API

Fusion 360's public Python API (`adsk.core` / `adsk.fusion` / `adsk.cam`)
exposes **only the mechanical design workspace**. The Electronics (ECAD)
workspace — schematic, board, components, nets, MPN — **cannot be read from
Python** (Autodesk: "being worked on, no timeline"). Therefore:

- **BOM extraction = a custom ULP** (the Eagle-heritage scripting language). Run
  in the schematic, it reads refdes/value/package plus **user-defined library
  attributes (incl. MPN)** and writes a deterministic JSON/CSV to a known path.
  (The schematic carries richer attributes than the board.)
- **Python add-in** = orchestration only. Detect the Electronics workspace /
  active document, provide a "Sync to Inventory" button, read the ULP output
  file, and POST it to a web-app API route over HTTPS. `requests`/`certifi` are
  not in Fusion's bundled Python, so vendor them in the add-in's `lib/`.
  Reference: [invenhost/F360-InvenTree](https://github.com/invenhost/F360-InvenTree) (MIT).
- The add-in ⇄ web app link is plain HTTP (JSON), so the **backend language
  (TypeScript) is irrelevant** to it. The add-in is a machine, so it
  authenticates with an **API token**, not interactive OAuth.
- ⚠️ **MPN only exists if the library part has it populated** — it is frequently
  missing and field names are not standardized. The backend needs a **part
  matching/enrichment** step (refdes+value+package → candidate MPN, user
  confirms). Do not assume MPN is present.

> Note: Autodesk has been testing an "enhanced BOM experience" that generates a
> BOM from board files too (non-GA as of late 2025). If it ships, this path may
> simplify — worth tracking.

## Data model (draft — implemented as Drizzle schema)

- **Part** — canonical component: `mpn`, `manufacturer`, `description`.
- **Location** — a storage place/bin: `name`, `description`.
- **StockItem** — on-hand quantity per `(part, location)`.
- **InventoryTxn** — audit log of every stock change (receive/issue/build/adjust):
  `delta`, `reason`, `ref`, `actor`.
- **Board** — a Fusion board/project: `name`, `fusionDocId`, `revision`.
- **BomLine** — one BOM row: `value`, `package`, `designators`, `qtyPerBoard`,
  `partMpn` (nullable), `matchedPartId` (nullable).
- **Build** — a "make N boards" job: `board`, `quantity`, `status`,
  `completedAt`, `actor`.
- **BuildConsumption** — a part quantity drawn from a location for a build.

Invariant: change stock only by **appending an InventoryTxn**; derive/refresh
`StockItem.quantity` from the sum (audit trail + easy rollback). Record `actor`
on mutations for multi-user support.

## Distributor integration (verified)

| | Auth / key | Price & stock | Barcode | Batch buy |
|---|---|---|---|---|
| **DigiKey** | OAuth2 client_credentials (free) | Products v4 `~120/min · ~1000/day` | Barcode v3 API + local parse | **MyLists 3rd-party API (no key, `singleUseUrl`)** — only true one-click of the three |
| **Mouser** | API key in query string (free) | Search v2 `~30/min · 1000/day`, max 50/call | no API → parse locally | per-part links (batch needs Cart API + account) |
| **LCSC** | no public API | jlcsearch / EasyEDA (C-number) — **unofficial** | QR `{pc:Cxxxx,pm:MPN,qty:n}` | per-part links + CSV |

- **Barcodes**: DigiKey/Mouser use the ECIA EIGP 114 / ANSI MH10.8.2
  **DataMatrix** (header `[)>{RS}06{GS}`, fields split on GS `\x1d`, DI map
  `1P`=MPN, `P`=part#, `Q`=qty, ...). LCSC uses a brace-wrapped QR. In the
  browser, `@zxing/library` decodes both DataMatrix + QR (PWA requires HTTPS).
  Parser: `web/src/lib/domain/barcode.ts`.
- **LCSC key insight**: there is no official API, but the **QR carries the MPN
  (`pm`)**, so look that MPN up via the official DigiKey/Mouser APIs to fill
  price/stock. Enrich LCSC-specific data best-effort via EasyEDA (C-number) /
  jlcsearch and label it "unofficial".
- **Rate limits**: cache price/stock aggressively. If keys are absent, adapters
  fall back to sandbox/mock.

## Deployment (Vercel + Neon)

- **Web app → Vercel**: PWA frontend + API routes deploy as one project.
  Automatic HTTPS (required for camera scanning).
- **DB → Neon Postgres** (serverless). On Vercel serverless functions, use
  Neon's **pooled** connection string (`-pooler`).
- **Staying free**: connect only one Vercel account (collaborate on GitHub).
  Multiple people *managing* the Vercel project requires Pro.

## Security principles

- All secrets (distributor keys, DB URL, API token) live in **server-only env
  vars** (in Next.js, anything without the `NEXT_PUBLIC_` prefix is server-only).
  Never hardcode.
- Fusion add-in → web app authenticates with a shared token (`FUSION_API_TOKEN`)
  in Phase 1; hardened to user auth in Phase 4.
- Validate input at every boundary (add-in upload, scanned barcode, distributor
  responses).
