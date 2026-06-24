import { NextResponse } from "next/server";

import { getBoard, getBoardBom, getBoardBomDetailed, replaceBom } from "@/lib/repo/boards";
import { replaceBomSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const boardId = Number((await params).id);
  if (!Number.isInteger(boardId)) {
    return NextResponse.json({ error: "invalid board id" }, { status: 400 });
  }
  if (!(await getBoard(boardId))) {
    return NextResponse.json({ error: "board not found" }, { status: 404 });
  }
  // ?detail=1 enriches each line with catalog (manufacturer/supplier/SPN/cost) + stock.
  const detail = new URL(req.url).searchParams.get("detail");
  return NextResponse.json(detail ? await getBoardBomDetailed(boardId) : await getBoardBom(boardId));
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
