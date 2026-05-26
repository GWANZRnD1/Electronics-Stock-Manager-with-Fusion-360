# Running locally & deploying to Vercel

## Prerequisites

- Node.js 22+
- A Supabase project (free) — its Postgres connection string
- `web/.env.local` filled in (copy from `web/.env.example`):
  - `DATABASE_URL` — Supabase **Transaction pooler** URI (port **6543**)
  - `ACCESS_PIN` — the shared PIN that gates the app
  - distributor keys are optional (empty ⇒ sandbox/mock)

## Run locally

```powershell
cd web
npm install
npm run db:migrate     # first time only — creates the 8 tables
npm run dev            # http://localhost:3000  (enter the ACCESS_PIN)
```

Useful scripts:

| Script | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run test` | Run the vitest domain-logic tests |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate a new migration after editing `src/lib/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:reset` | **Destructive** — wipe all inventory tables for a clean start |
| `npm run db:seedbench` | Seed 50k parts and benchmark the stock-lookup query |

> The dev DB currently still holds the 50k benchmark seed (+ a `SMOKE-TEST` row). Run
> `npm run db:reset` when you're ready to start with real data.

## Deploy to Vercel

The Next.js app lives in `web/` (a subdirectory), so the **Root Directory** setting matters.

1. **Import the repo** at <https://vercel.com/new> using the account that **owns** the
   GitHub repo (`GWANZRnD1`). A collaborator on a personal repo cannot import it — see
   [docs/ARCHITECTURE.md](ARCHITECTURE.md) notes.
2. **Root Directory** → set to **`web`**. (Framework preset auto-detects Next.js; leave
   build/output commands at their defaults.)
3. **Environment Variables** (Project → Settings → Environment Variables), for Production
   (and Preview if you want preview deploys):
   - `DATABASE_URL` = Supabase **Transaction pooler (6543)** URI
   - `ACCESS_PIN` = your PIN ⚠️ **required** — if unset, the gate is disabled (app is open!)
   - `CRON_SECRET` = any long random string — secures the keep-alive cron endpoint
   - later: `DIGIKEY_CLIENT_ID`, `DIGIKEY_CLIENT_SECRET`, `DIGIKEY_USE_SANDBOX`,
     `MOUSER_API_KEY`, `FUSION_API_TOKEN`
4. **Deploy.** Every push to `main` auto-deploys. HTTPS is automatic (needed later for the
   camera scanner).

Notes:
- The build does **not** need `DATABASE_URL` (the DB client is lazy and route handlers are
  `force-dynamic`), but the runtime does — so set the env vars before expecting it to work.
- Migrations are **not** run during the Vercel build. Apply schema changes by running
  `npm run db:migrate` locally against the same `DATABASE_URL`.
- We use the Supabase **transaction pooler + `prepare: false`**, which is the correct
  setup for serverless functions.

## Housekeeping (recommended)

- **Rotate the Supabase DB password** if it was ever pasted/exposed, then update `.env.local`
  and the Vercel `DATABASE_URL`.
- **Keep-alive**: configured via **Vercel Cron** (`web/vercel.json` → daily hit of
  `/api/cron/keepalive`, which runs `select 1`) so the Supabase free project never reaches
  its 7-day idle pause. Just set the `CRON_SECRET` env var. Activates once deployed.
- **Backups**: Supabase free has no automated backups. `.github/workflows/backup.yml` does a
  weekly `pg_dump` artifact (needs the `DATABASE_URL` repo secret and GitHub Actions enabled).
