import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next.js, so load env from .env.local explicitly.
config({ path: ".env.local" });

// The app's DATABASE_URL points at Supabase's transaction pooler (port 6543) with
// prepare:false. drizzle-kit can't disable prepared statements and needs session
// features the transaction pooler lacks, so its introspection reads corrupted
// catalog data and crashes ("Cannot read properties of undefined (reading 'replace')").
// Use DIRECT_URL if set, else the session pooler (same host, port 5432).
const appUrl = process.env.DATABASE_URL ?? "";
const migrationUrl = process.env.DIRECT_URL || appUrl.replace(":6543", ":5432");

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: migrationUrl,
  },
  // Only manage our own schema — never introspect/diff Supabase's system schemas
  // (auth, storage, realtime, vault), which would otherwise show up as "tables to drop".
  schemaFilter: ["public"],
});
