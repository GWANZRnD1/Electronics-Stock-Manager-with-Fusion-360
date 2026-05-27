import { NextResponse } from "next/server";

import { replaceBom, upsertBoard } from "@/lib/repo/boards";
import { fusionImportSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Browser-facing BOM import (behind the PIN gate). Accepts the JSON that the
 * Fusion `extract-bom.ulp` produces — the same `{ board, lines }` shape as the
 * machine-to-machine `/api/fusion/bom`, but token-free for in-app uploads.
 * Upserts the board (by Fusion doc id / name) and replaces its BOM.
 */
export async function POST(request: Request) {
  const parsed = fusionImportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "not a valid BOM file" }, { status: 400 });
  }

  const board = await upsertBoard(parsed.data.board);
  await replaceBom(board.id, parsed.data.lines);

  return NextResponse.json(
    { boardId: board.id, name: board.name, lines: parsed.data.lines.length },
    { status: 200 },
  );
}
