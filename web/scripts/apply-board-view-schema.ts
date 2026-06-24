/**
 * Apply the additive Assembly-view schema to the database (idempotent; no data
 * loss). Run: npm run db:apply-board-view
 *
 *   - boards.outline_min_x/min_y/max_x/max_y  (board outline bbox in mm)
 *   - component_placements                    (one row per placed component)
 *   - board_images                            (image metadata; bytes in Storage)
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
  // Use the session pooler (port 5432) for DDL — same reasoning as drizzle.config.ts;
  // the transaction pooler (6543) can reject the tenant for direct DDL connections.
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

  console.log("Applying additive Assembly-view schema (idempotent)…");

  // Board outline bbox columns (numeric, nullable until placements imported).
  for (const c of ["outline_min_x", "outline_min_y", "outline_max_x", "outline_max_y"]) {
    await db.execute(sql.raw(`ALTER TABLE boards ADD COLUMN IF NOT EXISTS ${c} numeric(12,4)`));
  }

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS component_placements (
      id serial PRIMARY KEY NOT NULL,
      board_id integer NOT NULL REFERENCES boards(id),
      designator text NOT NULL DEFAULT '',
      x numeric(12,4) NOT NULL,
      y numeric(12,4) NOT NULL,
      angle numeric(7,2) NOT NULL DEFAULT '0',
      side text NOT NULL DEFAULT 'top',
      package text NOT NULL DEFAULT '',
      mpn text
    )
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS placements_board_idx ON component_placements USING btree (board_id)`,
  );

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS board_images (
      id serial PRIMARY KEY NOT NULL,
      board_id integer NOT NULL REFERENCES boards(id),
      side text NOT NULL,
      storage_path text NOT NULL,
      mime text NOT NULL DEFAULT 'image/png',
      width integer NOT NULL DEFAULT 0,
      height integer NOT NULL DEFAULT 0,
      calibration text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS board_images_board_side_uq ON board_images USING btree (board_id, side)`,
  );

  // Verify.
  const col = await db.execute(
    sql`SELECT column_name FROM information_schema.columns WHERE table_name='boards' AND column_name='outline_min_x'`,
  );
  const t1 = await db.execute(
    sql`SELECT table_name FROM information_schema.tables WHERE table_name='component_placements'`,
  );
  const t2 = await db.execute(
    sql`SELECT table_name FROM information_schema.tables WHERE table_name='board_images'`,
  );
  console.log("boards.outline_min_x column:", col.length ? "OK" : "MISSING");
  console.log("component_placements table:", t1.length ? "OK" : "MISSING");
  console.log("board_images table:", t2.length ? "OK" : "MISSING");

  await client.end();
  if (!col.length || !t1.length || !t2.length) throw new Error("verification failed");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
