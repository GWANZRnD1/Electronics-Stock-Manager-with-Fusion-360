import { NextResponse } from "next/server";

import { currentUser } from "@/lib/auth/current";
import { getBoard } from "@/lib/repo/boards";
import { BuildShortageError, buildBoard } from "@/lib/repo/builds";
import { buildSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const boardId = Number((await params).id);
  if (!Number.isInteger(boardId)) {
    return NextResponse.json({ error: "invalid board id" }, { status: 400 });
  }
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "locked" }, { status: 401 });
  if (!(await getBoard(boardId))) {
    return NextResponse.json({ error: "board not found" }, { status: 404 });
  }
  const parsed = buildSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  try {
    const result = await buildBoard(
      boardId,
      parsed.data.quantity,
      user.name,
      parsed.data.parts,
      user.userKey,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    if (e instanceof BuildShortageError) {
      return NextResponse.json({ error: "insufficient stock", shortages: e.shortages }, { status: 409 });
    }
    throw e;
  }
}
