import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { GATE_COOKIE, checkPin, expectedToken } from "@/lib/auth/gate";
import { unlockSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = unlockSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (!checkPin(parsed.data.pin)) {
    return NextResponse.json({ error: "incorrect PIN" }, { status: 401 });
  }
  const token = await expectedToken();
  if (token) {
    const store = await cookies();
    store.set(GATE_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
  }
  return NextResponse.json({ ok: true });
}
