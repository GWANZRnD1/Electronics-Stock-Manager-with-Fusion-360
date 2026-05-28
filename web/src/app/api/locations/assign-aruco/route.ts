import { NextResponse } from "next/server";

import { dictCapacity } from "@/lib/aruco/marker";
import { assignArucoCodes } from "@/lib/repo/inventory";
import { getArucoConfig } from "@/lib/repo/settings";
import { assignArucoSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bulk-assign the next free marker ids to the given locations that lack one. */
export async function POST(request: Request) {
  const parsed = assignArucoSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const { dict } = await getArucoConfig();
  const result = await assignArucoCodes(parsed.data.ids, dictCapacity(dict));
  return NextResponse.json(result);
}
