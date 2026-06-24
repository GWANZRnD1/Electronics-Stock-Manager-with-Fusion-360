import { NextResponse } from "next/server";

import { replaceBom, replacePlacements, upsertBoard } from "@/lib/repo/boards";
import { boardImportSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Browser-facing board import (behind the PIN gate). Accepts the JSON from either
 * `extract-bom.ulp` (`{ board, lines }`) or the combined `extract-board.ulp`
 * (`{ board, lines, outline, placements }`). Upserts the board, replaces its BOM,
 * and — when the file carries them — its placements too, so one upload does both.
 */
export async function POST(request: Request) {
  const parsed = boardImportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "not a valid board file" }, { status: 400 });
  }

  const board = await upsertBoard(parsed.data.board);
  await replaceBom(board.id, parsed.data.lines);

  let placements = 0;
  if (parsed.data.outline && parsed.data.placements?.length) {
    await replacePlacements(board.id, parsed.data.outline, parsed.data.placements);
    placements = parsed.data.placements.length;
  }

  return NextResponse.json(
    { boardId: board.id, name: board.name, lines: parsed.data.lines.length, placements },
    { status: 200 },
  );
}
