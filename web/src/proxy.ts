/**
 * Proxy (formerly "middleware" pre-Next.js 16). Enforces the shared-PIN gate:
 * unauthenticated page requests are redirected to /unlock, API requests get 401.
 * Disabled automatically when ACCESS_PIN is unset.
 */
import { NextResponse, type NextRequest } from "next/server";

import { GATE_COOKIE, expectedToken } from "@/lib/auth/gate";

// /api/cron and /api/fusion bypass the PIN gate (machine-to-machine); they are
// protected by CRON_SECRET / FUSION_API_TOKEN respectively.
const PUBLIC_PATHS = ["/unlock", "/api/unlock", "/api/cron", "/api/fusion"];

export async function proxy(request: NextRequest) {
  const expected = await expectedToken();
  if (!expected) return NextResponse.next(); // gate disabled (no ACCESS_PIN)

  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  if (request.cookies.get(GATE_COOKIE)?.value === expected) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "locked" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/unlock";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals and static asset files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|webmanifest)$).*)"],
};
