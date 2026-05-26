# Electronics Stock Manager with Fusion 360

An electronics-component inventory manager. Pull a PCB BOM from Autodesk
**Fusion 360 (Electronics)**, check live stock, compute whether you have enough
parts to build *N* boards, and get **DigiKey / Mouser / LCSC** batch purchase
links for any shortages. Scan a component's barcode with your phone camera to
identify and receive it into a location; "build" a board to automatically
decrement stock and record history.

## Stack

- **Web app (`web/`)** — **Next.js (App Router, TypeScript)**: PWA frontend +
  API routes (integrated backend), **Neon Postgres + Drizzle ORM**
- **Fusion (`fusion/`)** — custom **ULP** (schematic BOM extraction) + **Python
  add-in** (HTTPS sync to the backend) — *planned*
- **Deploy** — Vercel (web app) + Neon (database)
- **Docs (`docs/`)** — architecture and distributor API-key setup guide

## Key design constraint (must read)

Fusion 360's public Python API **does not expose the Electronics (ECAD)
workspace** — you cannot read the schematic/board/components/MPN directly from
Python. BOM extraction is therefore done with a **custom ULP script** (run in
the schematic, emits JSON/CSV), and the **Python add-in** only provides the UI
and POSTs that file to the backend over HTTPS. The add-in ⇄ web app link is
plain HTTP, so the backend language (TypeScript) is irrelevant to it. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

## Quick start (web app)

```powershell
cd web
npm install
npm run dev      # http://localhost:3000
npm run test     # vitest (domain-logic tests)
```

## Environment variables

Copy `web/.env.example` to `web/.env.local` and fill it in (these are
server-only secrets — never exposed to the client). If distributor keys are
empty, the adapters run in sandbox/mock mode. For cloud deploys, set the same
values as Vercel project environment variables. See
[docs/DISTRIBUTOR_API_SETUP.md](docs/DISTRIBUTOR_API_SETUP.md) for how to issue
DigiKey/Mouser keys.

## Roadmap

- **Phase 0** — Foundation: scaffold, Next.js web app, core domain logic
  (barcode parser, shortage calc, buy links) + tests
- **Phase 1 (MVP)** — BOM ingest, shortage calc, price/stock lookup, batch buy
  links, Fusion ULP + add-in, PWA
- **Phase 2** — Inventory management + camera barcode scanning (receive/adjust)
- **Phase 3** — Build/assembly workflow (stock decrement + history)
- **Phase 4** — Auth (e.g. GitHub OAuth), PWA polish, LCSC enrichment,
  Vercel/Neon deploy

## License

[MIT](LICENSE) — free to use, modify, and distribute with attribution.
