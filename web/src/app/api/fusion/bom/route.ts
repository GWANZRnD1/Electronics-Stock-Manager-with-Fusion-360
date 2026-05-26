import { NextResponse } from "next/server";

import { replaceBom, upsertBoard } from "@/lib/repo/boards";
import { fusionImportSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Receives a BOM from the Fusion 360 add-in and upserts the board + replaces its
 * BOM. Machine-to-machine: authenticated with FUSION_API_TOKEN (Bearer). If that
 * env var is unset the endpoint is open (dev only) — set it in production.
 */
export async function POST(request: Request) {
  const token = process.env.FUSION_API_TOKEN;
  if (token && request.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = fusionImportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const board = await upsertBoard(parsed.data.board);
  await replaceBom(board.id, parsed.data.lines);

  return NextResponse.json(
    { boardId: board.id, name: board.name, lines: parsed.data.lines.length },
    { status: 200 },
  );
}
