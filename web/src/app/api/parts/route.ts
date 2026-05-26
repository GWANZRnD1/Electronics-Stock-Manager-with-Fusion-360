import { NextResponse } from "next/server";

import { isUniqueViolation } from "@/lib/http";
import { createPart, listParts } from "@/lib/repo/inventory";
import { createPartSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listParts());
}

export async function POST(request: Request) {
  const parsed = createPartSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  try {
    const part = await createPart(parsed.data);
    return NextResponse.json(part, { status: 201 });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return NextResponse.json({ error: "MPN already exists" }, { status: 409 });
    }
    throw e;
  }
}
