import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { GATE_COOKIE, gateEnabled } from "@/lib/auth/gate";
import { SESSION_MAX_AGE_SECONDS, authenticatePin, createSession } from "@/lib/auth/session";
import { unlockSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = unlockSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const user = await authenticatePin(parsed.data.pin);
  if (!user) {
    return NextResponse.json({ error: "incorrect PIN" }, { status: 401 });
  }
  if (gateEnabled()) {
    const token = await createSession(user);
    const store = await cookies();
    store.set(GATE_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
  }
  return NextResponse.json({ ok: true, user });
}
