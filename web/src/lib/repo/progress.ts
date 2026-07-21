import { and, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { boardPopulationProgress, bomLines } from "@/lib/db/schema";

export class InvalidProgressLineError extends Error {}

export async function getBoardProgress(userKey: string, boardId: number): Promise<number[]> {
  const rows = await getDb()
    .select({ lineId: boardPopulationProgress.bomLineId })
    .from(boardPopulationProgress)
    .where(
      and(
        eq(boardPopulationProgress.userKey, userKey),
        eq(boardPopulationProgress.boardId, boardId),
      ),
    )
    .orderBy(boardPopulationProgress.bomLineId);
  return rows.map((row) => row.lineId);
}

/**
 * Set an explicit state instead of toggling it. A per-user/per-board advisory
 * lock preserves request order for two tabs using the same identity, and the
 * composite primary key makes retries safe. Different users never block one
 * another or share rows.
 */
export async function setBoardProgress(
  userKey: string,
  boardId: number,
  lineIds: number[],
  populated: boolean,
): Promise<number[]> {
  const uniqueIds = [...new Set(lineIds)];
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userKey}), ${boardId})`);
    if (uniqueIds.length > 0) {
      const valid = await tx
        .select({ id: bomLines.id })
        .from(bomLines)
        .where(and(eq(bomLines.boardId, boardId), inArray(bomLines.id, uniqueIds)));
      if (valid.length !== uniqueIds.length) throw new InvalidProgressLineError();
      if (populated) {
        await tx
          .insert(boardPopulationProgress)
          .values(uniqueIds.map((bomLineId) => ({ userKey, boardId, bomLineId })))
          .onConflictDoNothing();
      } else {
        await tx.delete(boardPopulationProgress).where(
          and(
            eq(boardPopulationProgress.userKey, userKey),
            eq(boardPopulationProgress.boardId, boardId),
            inArray(boardPopulationProgress.bomLineId, uniqueIds),
          ),
        );
      }
    }
    const rows = await tx
      .select({ lineId: boardPopulationProgress.bomLineId })
      .from(boardPopulationProgress)
      .where(
        and(
          eq(boardPopulationProgress.userKey, userKey),
          eq(boardPopulationProgress.boardId, boardId),
        ),
      )
      .orderBy(boardPopulationProgress.bomLineId);
    return rows.map((row) => row.lineId);
  });
}
