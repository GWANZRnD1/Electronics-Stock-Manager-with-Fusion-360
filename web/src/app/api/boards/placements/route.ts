import { NextResponse } from "next/server";

import { replacePlacements, upsertBoard } from "@/lib/repo/boards";
import { placementsImportSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Browser-facing placements import (behind the PIN gate). Accepts the JSON that
 * `extract-placements.ulp` produces: { board, outline, placements }. Upserts the
 * board (so it lines up with a BOM imported under the same name/revision) and
 * replaces its component placements + outline bbox.
 */
export async function POST(request: Request) {
  const parsed = placementsImportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "not a valid placements file" }, { status: 400 });
  }
  const board = await upsertBoard(parsed.data.board);
  await replacePlacements(board.id, parsed.data.outline, parsed.data.placements);
  return NextResponse.json(
    { boardId: board.id, name: board.name, placements: parsed.data.placements.length },
    { status: 200 },
  );
}
