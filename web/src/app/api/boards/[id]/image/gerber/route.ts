import { NextResponse } from "next/server";

import { getBoard } from "@/lib/repo/boards";
import { type BoardSide, setCalibration, upsertBoardImage } from "@/lib/repo/boardImages";
import { type MmBbox, renderGerberZip } from "@/lib/gerber/render";
import { storageConfigured, uploadObject } from "@/lib/storage/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Encode a rendered side's mm bounding box as the existing 2-point calibration
 * (image corner ↔ board-mm corner) so the Assembly view's mapper aligns the
 * highlights to the render automatically. The bottom render is mirrored, so its
 * top-left corner maps to board (maxX, maxY) rather than (minX, maxY).
 */
function bboxToCalibration(side: BoardSide, b: MmBbox) {
  return side === "bottom"
    ? [
        { frac: { x: 0, y: 0 }, mm: { x: b.maxX, y: b.maxY } },
        { frac: { x: 1, y: 1 }, mm: { x: b.minX, y: b.minY } },
      ]
    : [
        { frac: { x: 0, y: 0 }, mm: { x: b.minX, y: b.maxY } },
        { frac: { x: 1, y: 1 }, mm: { x: b.maxX, y: b.minY } },
      ];
}

/** Upload a Gerber zip; render top/bottom to SVG and store them as board images. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const boardId = Number((await params).id);
  if (!Number.isInteger(boardId)) {
    return NextResponse.json({ error: "invalid board id" }, { status: 400 });
  }
  if (!storageConfigured()) {
    return NextResponse.json(
      { error: "image storage isn't configured — set SUPABASE_SECRET_KEY in web/.env.local" },
      { status: 503 },
    );
  }
  if (!(await getBoard(boardId))) {
    return NextResponse.json({ error: "board not found" }, { status: 404 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "a Gerber .zip file is required" }, { status: 400 });
  }
  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "zip is larger than 25 MB" }, { status: 400 });
  }

  let render;
  try {
    render = await renderGerberZip(new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "could not render the Gerbers" },
      { status: 400 },
    );
  }

  const sides: { side: BoardSide; rendered: typeof render.top }[] = [
    { side: "top", rendered: render.top },
    { side: "bottom", rendered: render.bottom },
  ];
  const done: BoardSide[] = [];
  for (const { side, rendered } of sides) {
    if (!rendered) continue;
    const path = `boards/${boardId}/${side}.svg`;
    await uploadObject(path, new TextEncoder().encode(rendered.svg), "image/svg+xml");
    await upsertBoardImage({
      boardId,
      side,
      storagePath: path,
      mime: "image/svg+xml",
      width: rendered.widthPx,
      height: rendered.heightPx,
    });
    // upsert clears any prior calibration; set the render-derived alignment.
    await setCalibration(boardId, side, JSON.stringify(bboxToCalibration(side, rendered.mmBbox)));
    done.push(side);
  }

  if (done.length === 0) {
    return NextResponse.json(
      { error: "no renderable copper/outline layers were found in the zip" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, sides: done, layers: render.layerCount });
}
