import { NextResponse } from "next/server";

import { getArucoConfig, setArucoConfig } from "@/lib/repo/settings";
import { arucoConfigSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getArucoConfig());
}

export async function PUT(request: Request) {
  const parsed = arucoConfigSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  await setArucoConfig(parsed.data);
  return NextResponse.json(parsed.data);
}
