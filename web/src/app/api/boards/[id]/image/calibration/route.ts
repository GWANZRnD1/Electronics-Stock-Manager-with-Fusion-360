import { NextResponse } from "next/server";

import { getBoardImage, setCalibration } from "@/lib/repo/boardImages";
import { boardImageCalibrationSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Set (or clear) the two-point manual alignment override for a side's image.
 * Body: { side, calibration: [p1, p2] | null }. Clearing reverts to auto-crop.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const boardId = Number((await params).id);
  if (!Number.isInteger(boardId)) {
    return NextResponse.json({ error: "invalid board id" }, { status: 400 });
  }
  const parsed = boardImageCalibrationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (!(await getBoardImage(boardId, parsed.data.side))) {
    return NextResponse.json({ error: "no image for that side" }, { status: 404 });
  }
  await setCalibration(
    boardId,
    parsed.data.side,
    parsed.data.calibration ? JSON.stringify(parsed.data.calibration) : null,
  );
  return NextResponse.json({ ok: true });
}
