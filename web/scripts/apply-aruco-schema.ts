/**
 * Apply the additive ArUco schema to the database (idempotent; no data loss).
 * Used instead of `drizzle-kit push` because drizzle-kit's introspection crashes
 * on this DB's CHECK constraints. Run: npm run db:apply-aruco
 *
 *   - app_settings (key/value) table for app-wide settings
 *   - locations.aruco column (nullable) for the assigned marker id
 *   - partial unique index so assigned marker ids stay unique
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set (web/.env.local)");
  const client = postgres(url, { prepare: false });
  const db = drizzle(client);

  console.log("Applying additive ArUco schema (idempotent)…");
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS app_settings (key text PRIMARY KEY NOT NULL, value text NOT NULL DEFAULT '')`,
  );
  await db.execute(sql`ALTER TABLE locations ADD COLUMN IF NOT EXISTS aruco integer`);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS locations_aruco_uq ON locations USING btree (aruco) WHERE aruco IS NOT NULL`,
  );

  // Verify the three objects now exist.
  const col = await db.execute(
    sql`SELECT data_type FROM information_schema.columns WHERE table_name='locations' AND column_name='aruco'`,
  );
  const tbl = await db.execute(
    sql`SELECT table_name FROM information_schema.tables WHERE table_name='app_settings'`,
  );
  const idx = await db.execute(sql`SELECT indexname FROM pg_indexes WHERE indexname='locations_aruco_uq'`);
  console.log("locations.aruco column:", col.length ? `OK (${col[0].data_type})` : "MISSING");
  console.log("app_settings table:", tbl.length ? "OK" : "MISSING");
  console.log("locations_aruco_uq index:", idx.length ? "OK" : "MISSING");

  await client.end();
  if (!col.length || !tbl.length || !idx.length) throw new Error("verification failed");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
