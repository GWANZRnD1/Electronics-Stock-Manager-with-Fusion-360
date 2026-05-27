import { NextResponse } from "next/server";

import { isUniqueViolation } from "@/lib/http";
import { updatePart } from "@/lib/repo/inventory";
import { updatePartSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid part id" }, { status: 400 });
  }
  const parsed = updatePartSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  try {
    const part = await updatePart(id, parsed.data);
    if (!part) {
      return NextResponse.json({ error: "part not found" }, { status: 404 });
    }
    return NextResponse.json(part);
  } catch (e) {
    if (isUniqueViolation(e)) {
      return NextResponse.json({ error: "MPN already exists" }, { status: 409 });
    }
    throw e;
  }
}
