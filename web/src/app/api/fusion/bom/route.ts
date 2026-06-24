import { NextResponse } from "next/server";

import { replaceBom, replacePlacements, upsertBoard } from "@/lib/repo/boards";
import { boardImportSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Receives a BOM (or combined BOM + placements) from the Fusion 360 add-in and
 * upserts the board, replacing its BOM and — when present — its placements.
 * Machine-to-machine: authenticated with FUSION_API_TOKEN (Bearer). If that env
 * var is unset the endpoint is open (dev only) — set it in production.
 */
export async function POST(request: Request) {
  const token = process.env.FUSION_API_TOKEN;
  if (token && request.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = boardImportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
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
