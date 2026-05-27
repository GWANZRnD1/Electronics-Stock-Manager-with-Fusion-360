import { NextResponse } from "next/server";

import {
  deleteBoard,
  getBoard,
  renameBoardFamily,
  setBoardFamilyArchived,
  updateBoardRevision,
} from "@/lib/repo/boards";
import { updateBoardSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Edit a board. `revision` relabels just this row; `name` renames the whole
 * family (every revision under the old name); `archived` archives/unarchives the
 * whole family.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const boardId = Number((await params).id);
  if (!Number.isInteger(boardId)) {
    return NextResponse.json({ error: "invalid board id" }, { status: 400 });
  }
  if (!(await getBoard(boardId))) {
    return NextResponse.json({ error: "board not found" }, { status: 404 });
  }
  const parsed = updateBoardSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const { name, revision, archived } = parsed.data;
  if (revision !== undefined) await updateBoardRevision(boardId, revision);
  if (name !== undefined) await renameBoardFamily(boardId, name);
  if (archived !== undefined) await setBoardFamilyArchived(boardId, archived);

  return NextResponse.json({ ok: true });
}

/** Delete a single revision (and its BOM, builds, and consumptions). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const boardId = Number((await params).id);
  if (!Number.isInteger(boardId)) {
    return NextResponse.json({ error: "invalid board id" }, { status: 400 });
  }
  if (!(await getBoard(boardId))) {
    return NextResponse.json({ error: "board not found" }, { status: 404 });
  }
  await deleteBoard(boardId);
  return NextResponse.json({ ok: true });
}
