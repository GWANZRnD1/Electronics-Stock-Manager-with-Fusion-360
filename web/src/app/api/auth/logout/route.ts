import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { GATE_COOKIE } from "@/lib/auth/gate";
import { revokeSession } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST() {
  const store = await cookies();
  const token = store.get(GATE_COOKIE)?.value;
  await revokeSession(token);
  store.delete(GATE_COOKIE);
  return NextResponse.json({ ok: true });
}
