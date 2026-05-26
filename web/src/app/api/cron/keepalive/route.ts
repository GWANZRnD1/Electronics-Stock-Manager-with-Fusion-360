import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Keep-alive endpoint hit by a daily Vercel Cron so the Supabase free project
 * never reaches its 7-day idle pause. Protected by CRON_SECRET: Vercel sends
 * `Authorization: Bearer <CRON_SECRET>` to cron invocations when that env var is set.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await getDb().execute(sql`select 1`);
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
