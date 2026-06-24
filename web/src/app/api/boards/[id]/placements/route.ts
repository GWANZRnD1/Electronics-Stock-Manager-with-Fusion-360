import { NextResponse } from "next/server";

import { getBoard, getPlacements, replacePlacements } from "@/lib/repo/boards";
import { getBoardImages } from "@/lib/repo/boardImages";
import { placementsImportSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Import placements onto THIS board (board-scoped — the file's board.name is
 * ignored, the path id wins). Accepts the extract-placements.ulp JSON and
 * replaces this board's placements + outline bbox.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const boardId = Number((await params).id);
  if (!Number.isInteger(boardId)) {
    return NextResponse.json({ error: "invalid board id" }, { status: 400 });
  }
  if (!(await getBoard(boardId))) {
    return NextResponse.json({ error: "board not found" }, { status: 404 });
  }
  const parsed = placementsImportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "not a valid placements file" }, { status: 400 });
  }
  await replacePlacements(boardId, parsed.data.outline, parsed.data.placements);
  return NextResponse.json({ ok: true, placements: parsed.data.placements.length });
}

/**
 * Everything the Assembly view needs in one call: the board's outline bbox, its
 * component placements, and which side images exist (with pixel dimensions and
 * any calibration override). Image bytes are fetched separately from
 * /api/boards/[id]/image?side=.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const boardId = Number((await params).id);
  if (!Number.isInteger(boardId)) {
    return NextResponse.json({ error: "invalid board id" }, { status: 400 });
  }
  const board = await getBoard(boardId);
  if (!board) return NextResponse.json({ error: "board not found" }, { status: 404 });

  const [placements, images] = await Promise.all([
    getPlacements(boardId),
    getBoardImages(boardId),
  ]);

  return NextResponse.json({
    outline:
      board.outlineMinX != null
        ? {
            minX: Number(board.outlineMinX),
            minY: Number(board.outlineMinY),
            maxX: Number(board.outlineMaxX),
            maxY: Number(board.outlineMaxY),
          }
        : null,
    placements: placements.map((p) => ({
      id: p.id,
      designator: p.designator,
      x: Number(p.x),
      y: Number(p.y),
      angle: Number(p.angle),
      side: p.side as "top" | "bottom",
      package: p.package,
      mpn: p.mpn,
    })),
    images: images.map((im) => ({
      side: im.side as "top" | "bottom",
      width: im.width,
      height: im.height,
      calibration: im.calibration ? JSON.parse(im.calibration) : null,
    })),
  });
}
