# Electronics Stock Manager with Fusion 360

An electronics-component inventory manager for people who design PCBs in Autodesk
**Fusion 360 (Electronics)**. Track parts and stock, search by any attribute,
sync parts from your Fusion library, scan reels to receive stock, plan board
builds against live stock, get **DigiKey / Mouser / LCSC** purchase links for
shortages, and "build" a board to auto-decrement stock with history. Installable
as a mobile PWA.

## Features

- **Inventory** — searchable table (category, name, manufacturer, MPN, size,
  location, qty) with per-attribute advanced search; bottom-right **+** speed-dial
  to add a part or location; **add-part auto-fills** from DigiKey/Mouser by MPN.
- **Scan & receive** — phone camera reads DigiKey/Mouser DataMatrix or LCSC QR
  (`@zxing`), prefills MPN/qty, pick a location, receive into stock.
- **Boards & shortage** — paste/import a BOM, enter how many to build, see
  per-part shortage (~6 ms on 50k rows), and one-click DigiKey batch list + per-part
  DigiKey/Mouser/LCSC links.
- **Build & consume** — build N boards: checks stock, decrements it (with audit
  trail), records build history; blocks if short.
- **Part lookup** — live price/stock from DigiKey + Mouser by MPN (LCSC = link only).
- **Fusion sync** — a ULP exports your Electronics **library** and a Fusion script
  pushes it into the catalog (`fusion/`).
- **PWA** — installable, mobile-first, offline shell; shared-PIN gate.

## Stack

- **Web app (`web/`)** — Next.js (App Router, TypeScript): PWA frontend + API
  routes (integrated backend), **Supabase Postgres + Drizzle ORM**
- **Fusion (`fusion/`)** — custom **ULP** (library export) + **Python script**
  (HTTPS sync to the backend)
- **Deploy** — Vercel (web app) + Supabase (database); keep-alive via Vercel Cron
- **Docs (`docs/`)** — architecture, deployment, distributor API-key setup

## Key design constraint (must read)

Fusion 360's public Python API **does not expose the Electronics (ECAD)
workspace**, so part/library data is exported via a **ULP** and POSTed to the
backend by a thin Python script. The script ⇄ web app link is plain HTTP, so the
backend language (TypeScript) is irrelevant to it. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start (web app)

```powershell
cd web
npm install
npm run db:migrate   # first time only — creates the tables (needs DATABASE_URL)
npm run dev          # http://localhost:3000  (enter the ACCESS_PIN)
npm run test         # vitest (domain-logic tests)
npm run db:reset     # optional: wipe seed/test data for a clean start
```

Full run/deploy instructions: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Fusion sync:
[fusion/README.md](fusion/README.md).

## Environment variables

Copy `web/.env.example` to `web/.env.local` (server-only secrets — never exposed
to the client):

- `DATABASE_URL` — Supabase Postgres **Transaction pooler** URI (port 6543)
- `ACCESS_PIN` — shared PIN that gates the app (unset ⇒ gate disabled)
- `CRON_SECRET` — secures the Vercel keep-alive cron
- `DIGIKEY_CLIENT_ID` / `DIGIKEY_CLIENT_SECRET` / `DIGIKEY_USE_SANDBOX`, `MOUSER_API_KEY`
  — optional; empty ⇒ sandbox/mock. Set `DIGIKEY_USE_SANDBOX=false` for live stock.
- `FUSION_API_TOKEN` — shared secret for the Fusion sync endpoints

See [docs/DISTRIBUTOR_API_SETUP.md](docs/DISTRIBUTOR_API_SETUP.md) for issuing keys.

## Status

Built & verified: inventory + advanced search, scan→receive, boards→shortage→buy
links, build/assembly, part lookup, Fusion library sync, installable PWA, LCSC
link-only. Auth = shared PIN by design. Remaining: deploy to Vercel/Supabase.

## License

[MIT](LICENSE) — free to use, modify, and distribute with attribution.
