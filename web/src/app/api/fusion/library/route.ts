import { NextResponse } from "next/server";

import { upsertParts } from "@/lib/repo/inventory";
import { librarySyncSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mirror the Fusion Electronics component library into the app's part catalog.
 * Machine-to-machine: FUSION_API_TOKEN (Bearer); open if the env var is unset (dev).
 * Idempotent — re-running upserts by MPN, so it never creates duplicates.
 */
export async function POST(request: Request) {
  const token = process.env.FUSION_API_TOKEN;
  if (token && request.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = librarySyncSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const count = await upsertParts(parsed.data.parts);
  return NextResponse.json({ count });
}
