import { NextResponse } from "next/server";

import { getBoard, replacePlacements } from "@/lib/repo/boards";
import { parsePickAndPlace } from "@/lib/gerber/placements";
import { renderGerber, unzipArchive } from "@/lib/gerber/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Render a Gerber zip to top/bottom SVG and import any pick-and-place placements.
 * The SVGs are RETURNED to the client (not stored): the browser rasterizes them
 * to a compact WebP and uploads that via /api/boards/[id]/image, then sets the
 * render's mm bbox as calibration. Rasterizing client-side keeps this function
 * well under the serverless memory limit (resvg+sharp here OOM'd it).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const boardId = Number((await params).id);
  if (!Number.isInteger(boardId)) {
    return NextResponse.json({ error: "invalid board id" }, { status: 400 });
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

  let files: Record<string, Uint8Array>;
  let render;
  try {
    files = unzipArchive(new Uint8Array(await file.arrayBuffer()));
    render = await renderGerber(files);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "could not render the Gerbers" },
      { status: 400 },
    );
  }

  const renders = (["top", "bottom"] as const)
    .map((side) => ({ side, rendered: side === "top" ? render.top : render.bottom }))
    .filter((r) => r.rendered)
    .map((r) => ({ side: r.side, svg: r.rendered!.svg, mmBbox: r.rendered!.mmBbox }));

  if (renders.length === 0) {
    return NextResponse.json(
      { error: "no renderable copper/outline layers were found in the zip" },
      { status: 400 },
    );
  }

  // If the zip also carried a pick-and-place / centroid file, import placements
  // (same board coordinate space as the render) so highlighting works too.
  let placements = 0;
  const pnp = parsePickAndPlace(files);
  const bbox = render.top?.mmBbox ?? render.bottom?.mmBbox;
  if (pnp.length && bbox) {
    await replacePlacements(boardId, bbox, pnp);
    placements = pnp.length;
  }

  return NextResponse.json({
    ok: true,
    layers: render.layerCount,
    ignored: render.ignored,
    placements,
    renders,
  });
}
