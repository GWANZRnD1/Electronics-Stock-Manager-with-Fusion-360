import { NextResponse } from "next/server";

import { createBoard, listBoards } from "@/lib/repo/boards";
import { createBoardSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listBoards());
}

export async function POST(request: Request) {
  const parsed = createBoardSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const board = await createBoard(parsed.data);
  return NextResponse.json(board, { status: 201 });
}
