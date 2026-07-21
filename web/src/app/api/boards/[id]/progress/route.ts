import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/lib/auth/current";
import {
  getBoardProgress,
  InvalidProgressLineError,
  setBoardProgress,
} from "@/lib/repo/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  lineIds: z.array(z.number().int().positive()).max(1_000),
  populated: z.boolean(),
});

async function context(params: Promise<{ id: string }>) {
  const boardId = Number((await params).id);
  if (!Number.isInteger(boardId) || boardId <= 0) {
    return { response: NextResponse.json({ error: "invalid board id" }, { status: 400 }) };
  }
  const user = await currentUser();
  if (!user) return { response: NextResponse.json({ error: "locked" }, { status: 401 }) };
  return { boardId, user };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await context(params);
  if ("response" in auth) return auth.response;
  return NextResponse.json({
    lineIds: await getBoardProgress(auth.user.userKey, auth.boardId),
    user: { name: auth.user.name, isRoot: auth.user.isRoot },
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await context(params);
  if ("response" in auth) return auth.response;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid progress update" }, { status: 400 });
  }
  try {
    return NextResponse.json({
      lineIds: await setBoardProgress(
        auth.user.userKey,
        auth.boardId,
        parsed.data.lineIds,
        parsed.data.populated,
      ),
    });
  } catch (error) {
    if (error instanceof InvalidProgressLineError) {
      return NextResponse.json({ error: "a BOM line no longer belongs to this board" }, { status: 409 });
    }
    throw error;
  }
}
