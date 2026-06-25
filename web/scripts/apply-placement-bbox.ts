/**
 * Apply the additive footprint-bbox columns to component_placements (idempotent;
 * no data loss). Run: npm run db:apply-placement-bbox
 *
 *   - component_placements.bx1/by1/bx2/by2  (exact footprint bbox in board mm)
 *
 * These store each placed component's true bounding box (from EAGLE's
 * UL_ELEMENT.area), letting the Assembly view outline the footprint and make the
 * whole rectangle the click/highlight target instead of a centroid dot. Nullable —
 * pick-and-place imports (centroid only) leave them empty and fall back to a dot.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const appUrl = process.env.DATABASE_URL;
  if (!appUrl) throw new Error("DATABASE_URL not set (web/.env.local)");
  // Session pooler (5432) for DDL — the transaction pooler (6543) rejects direct DDL.
  const url = process.env.DIRECT_URL || appUrl.replace(":6543", ":5432");
  const client = postgres(url, { prepare: false });
  const db = drizzle(client);

  // A paused free-tier project takes a minute or two to wake; ride it out.
  for (let attempt = 1; ; attempt++) {
    try {
      await db.execute(sql`select 1`);
      break;
    } catch (e) {
      if (attempt >= 20) throw e;
      console.log(`DB not ready (attempt ${attempt}) — waiting for resume…`);
      await delay(10_000);
    }
  }

  console.log("Adding component_placements footprint-bbox columns (idempotent)…");
  for (const c of ["bx1", "by1", "bx2", "by2"]) {
    await db.execute(
      sql.raw(`ALTER TABLE component_placements ADD COLUMN IF NOT EXISTS ${c} numeric(12,4)`),
    );
  }

  const cols = await db.execute(
    sql`SELECT column_name FROM information_schema.columns
        WHERE table_name='component_placements' AND column_name IN ('bx1','by1','bx2','by2')`,
  );
  console.log(`footprint bbox columns present: ${cols.length}/4`);

  await client.end();
  if (cols.length !== 4) throw new Error("verification failed");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
