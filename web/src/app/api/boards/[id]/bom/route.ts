import { NextResponse } from "next/server";

import { getBoard, getBoardBom, replaceBom } from "@/lib/repo/boards";
import { replaceBomSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const boardId = Number((await params).id);
  if (!Number.isInteger(boardId)) {
    return NextResponse.json({ error: "invalid board id" }, { status: 400 });
  }
  if (!(await getBoard(boardId))) {
    return NextResponse.json({ error: "board not found" }, { status: 404 });
  }
  return NextResponse.json(await getBoardBom(boardId));
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const boardId = Number((await params).id);
  if (!Number.isInteger(boardId)) {
    return NextResponse.json({ error: "invalid board id" }, { status: 400 });
  }
  if (!(await getBoard(boardId))) {
    return NextResponse.json({ error: "board not found" }, { status: 404 });
  }
  const parsed = replaceBomSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  await replaceBom(boardId, parsed.data.lines);
  return NextResponse.json({ ok: true, count: parsed.data.lines.length });
}
