/**
 * Wipe all inventory tables (and reset identities) for a clean start.
 * Run: npm run db:reset   (uses web/.env.local DATABASE_URL). Destructive!
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../src/lib/db/schema";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set (web/.env.local)");
  const client = postgres(url, { prepare: false });
  const db = drizzle(client, { schema });

  await db.execute(
    sql`TRUNCATE stock_items, inventory_txns, build_consumptions, builds, bom_lines, boards, parts, locations RESTART IDENTITY CASCADE`,
  );
  console.log("All inventory tables truncated (identities reset).");

  await client.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
