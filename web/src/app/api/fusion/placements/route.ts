import { NextResponse } from "next/server";

import { replacePlacements, upsertBoard } from "@/lib/repo/boards";
import { placementsImportSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Machine-to-machine placements import for the Fusion add-in. Mirrors
 * /api/fusion/bom: authenticated with FUSION_API_TOKEN (Bearer); open if unset
 * (dev only). Same payload as the browser /api/boards/placements route.
 */
export async function POST(request: Request) {
  const token = process.env.FUSION_API_TOKEN;
  if (token && request.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = placementsImportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  const board = await upsertBoard(parsed.data.board);
  await replacePlacements(board.id, parsed.data.outline, parsed.data.placements);
  return NextResponse.json(
    { boardId: board.id, name: board.name, placements: parsed.data.placements.length },
    { status: 200 },
  );
}
