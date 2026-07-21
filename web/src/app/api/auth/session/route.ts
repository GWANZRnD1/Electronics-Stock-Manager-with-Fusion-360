import { NextResponse } from "next/server";

import { currentUser } from "@/lib/auth/current";
import { gateEnabled } from "@/lib/auth/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "locked" }, { status: 401 });
  return NextResponse.json({ user: { ...user, gateEnabled: gateEnabled() } });
}
