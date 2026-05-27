import { NextResponse } from "next/server";

import { getBoard } from "@/lib/repo/boards";
import { cancelLastBuild, NoBuildError } from "@/lib/repo/builds";
import { cancelBuildSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reverse the board's most recent build, restoring stock for the chosen parts. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const boardId = Number((await params).id);
  if (!Number.isInteger(boardId)) {
    return NextResponse.json({ error: "invalid board id" }, { status: 400 });
  }
  if (!(await getBoard(boardId))) {
    return NextResponse.json({ error: "board not found" }, { status: 404 });
  }
  const parsed = cancelBuildSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  try {
    const result = await cancelLastBuild(boardId, parsed.data.parts, parsed.data.actor ?? "");
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof NoBuildError) {
      return NextResponse.json({ error: "no build to cancel" }, { status: 409 });
    }
    throw e;
  }
}
