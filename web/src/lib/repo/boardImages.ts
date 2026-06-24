/** Board image metadata rows (bytes live in Supabase Storage). */
import { and, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { boardImages } from "@/lib/db/schema";

export type BoardSide = "top" | "bottom";

export function getBoardImages(boardId: number) {
  return getDb().select().from(boardImages).where(eq(boardImages.boardId, boardId));
}

export async function getBoardImage(boardId: number, side: BoardSide) {
  const [row] = await getDb()
    .select()
    .from(boardImages)
    .where(and(eq(boardImages.boardId, boardId), eq(boardImages.side, side)));
  return row ?? null;
}

/** Insert or update the image row for a board+side. */
export async function upsertBoardImage(input: {
  boardId: number;
  side: BoardSide;
  storagePath: string;
  mime: string;
  width: number;
  height: number;
}) {
  const db = getDb();
  const existing = await getBoardImage(input.boardId, input.side);
  if (existing) {
    await db
      .update(boardImages)
      .set({
        storagePath: input.storagePath,
        mime: input.mime,
        width: input.width,
        height: input.height,
        // A fresh image invalidates any prior manual calibration.
        calibration: null,
      })
      .where(eq(boardImages.id, existing.id));
    return { ...existing, ...input, calibration: null };
  }
  const [row] = await db.insert(boardImages).values(input).returning();
  return row;
}

export async function setCalibration(
  boardId: number,
  side: BoardSide,
  calibration: string | null,
) {
  await getDb()
    .update(boardImages)
    .set({ calibration })
    .where(and(eq(boardImages.boardId, boardId), eq(boardImages.side, side)));
}

export async function deleteBoardImageRow(boardId: number, side: BoardSide) {
  await getDb()
    .delete(boardImages)
    .where(and(eq(boardImages.boardId, boardId), eq(boardImages.side, side)));
}
