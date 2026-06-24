import { NextResponse } from "next/server";

import { getBoard } from "@/lib/repo/boards";
import {
  type BoardSide,
  deleteBoardImageRow,
  getBoardImage,
  upsertBoardImage,
} from "@/lib/repo/boardImages";
import { downloadObject, removeObject, storageConfigured, uploadObject } from "@/lib/storage/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseSide(v: string | null): BoardSide | null {
  return v === "top" || v === "bottom" ? v : null;
}

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Serve the stored image bytes for ?side=top|bottom (proxied behind the gate). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const boardId = Number((await params).id);
  const side = parseSide(new URL(req.url).searchParams.get("side"));
  if (!Number.isInteger(boardId) || !side) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const row = await getBoardImage(boardId, side);
  if (!row) return NextResponse.json({ error: "no image" }, { status: 404 });

  const obj = await downloadObject(row.storagePath);
  if (!obj) return NextResponse.json({ error: "image bytes missing" }, { status: 404 });

  return new NextResponse(obj.body, {
    status: 200,
    headers: {
      "content-type": row.mime || obj.contentType,
      "cache-control": "private, max-age=60",
    },
  });
}

/** Upload (or replace) the image for a side. multipart/form-data: file, side, width, height. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const boardId = Number((await params).id);
  if (!Number.isInteger(boardId)) {
    return NextResponse.json({ error: "invalid board id" }, { status: 400 });
  }
  if (!storageConfigured()) {
    return NextResponse.json(
      { error: "image storage isn't configured — set SUPABASE_SERVICE_ROLE_KEY in web/.env.local" },
      { status: 503 },
    );
  }
  if (!(await getBoard(boardId))) {
    return NextResponse.json({ error: "board not found" }, { status: 404 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const side = parseSide(typeof form?.get("side") === "string" ? (form.get("side") as string) : null);
  const width = Number(form?.get("width"));
  const height = Number(form?.get("height"));
  if (!(file instanceof Blob) || !side) {
    return NextResponse.json({ error: "file and side are required" }, { status: 400 });
  }
  const mime = file.type || "image/png";
  const ext = EXT[mime];
  if (!ext) {
    return NextResponse.json({ error: "image must be PNG, JPEG, or WebP" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "image is larger than 10 MB" }, { status: 400 });
  }

  const path = `boards/${boardId}/${side}.${ext}`;
  await uploadObject(path, await file.arrayBuffer(), mime);
  await upsertBoardImage({
    boardId,
    side,
    storagePath: path,
    mime,
    width: Number.isFinite(width) ? Math.round(width) : 0,
    height: Number.isFinite(height) ? Math.round(height) : 0,
  });

  return NextResponse.json({ ok: true, side });
}

/** Remove the image for ?side=top|bottom. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const boardId = Number((await params).id);
  const side = parseSide(new URL(req.url).searchParams.get("side"));
  if (!Number.isInteger(boardId) || !side) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const row = await getBoardImage(boardId, side);
  if (row) {
    await removeObject(row.storagePath).catch(() => {});
    await deleteBoardImageRow(boardId, side);
  }
  return NextResponse.json({ ok: true });
}
