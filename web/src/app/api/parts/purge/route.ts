import { NextResponse } from "next/server";

import { purgeAll } from "@/lib/repo/inventory";
import { purgeSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Irreversible full reset. Requires an explicit { confirm: "PURGE" } body. */
export async function POST(request: Request) {
  const parsed = purgeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'confirmation required: { "confirm": "PURGE" }' }, { status: 400 });
  }
  await purgeAll();
  return NextResponse.json({ ok: true });
}
