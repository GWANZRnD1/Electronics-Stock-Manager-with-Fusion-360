/**
 * Database client (Drizzle + postgres.js).
 *
 * Lazy singleton so importing this module never crashes when DATABASE_URL is
 * absent (e.g. during build). `prepare: false` is required for Neon's pooled
 * (PgBouncer) connection string — use the host containing "-pooler".
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

let cached: PostgresJsDatabase<typeof schema> | undefined;

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set (copy web/.env.example to web/.env.local)");
  }
  const client = postgres(url, { prepare: false });
  cached = drizzle(client, { schema });
  return cached;
}

export { schema };
