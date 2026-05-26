import { NextResponse } from "next/server";

import { getBoard } from "@/lib/repo/boards";
import { listBuilds } from "@/lib/repo/builds";

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
  return NextResponse.json(await listBuilds(boardId));
}
