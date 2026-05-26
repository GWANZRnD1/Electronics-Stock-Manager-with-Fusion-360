import { NextResponse } from "next/server";

import { isUniqueViolation } from "@/lib/http";
import { createLocation, listLocations } from "@/lib/repo/inventory";
import { createLocationSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listLocations());
}

export async function POST(request: Request) {
  const parsed = createLocationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  try {
    const location = await createLocation(parsed.data);
    return NextResponse.json(location, { status: 201 });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return NextResponse.json({ error: "location name already exists" }, { status: 409 });
    }
    throw e;
  }
}
