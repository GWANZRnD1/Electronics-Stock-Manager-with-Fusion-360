/** Boards, their BOM lines, and shortage computation (uses the indexed stock sum). */
import { eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { boards, bomLines, parts, stockItems } from "@/lib/db/schema";
import { type BomLine, computeShortage, type ShortageReport } from "@/lib/domain/shortage";

export function listBoards() {
  return getDb().select().from(boards).orderBy(boards.name);
}

export async function createBoard(input: { name: string }) {
  const [row] = await getDb().insert(boards).values({ name: input.name }).returning();
  return row;
}

/** Find a board by Fusion doc id (preferred) or name, updating it; create if absent. */
export async function upsertBoard(input: {
  name: string;
  fusionDocId?: string | null;
  revision?: string;
}) {
  const db = getDb();

  if (input.fusionDocId) {
    const [byDoc] = await db.select().from(boards).where(eq(boards.fusionDocId, input.fusionDocId));
    if (byDoc) {
      const revision = input.revision ?? byDoc.revision;
      await db.update(boards).set({ name: input.name, revision }).where(eq(boards.id, byDoc.id));
      return { ...byDoc, name: input.name, revision };
    }
  }

  const [byName] = await db.select().from(boards).where(eq(boards.name, input.name));
  if (byName) {
    const fusionDocId = input.fusionDocId ?? byName.fusionDocId;
    const revision = input.revision ?? byName.revision;
    await db.update(boards).set({ fusionDocId, revision }).where(eq(boards.id, byName.id));
    return { ...byName, fusionDocId, revision };
  }

  const [created] = await db
    .insert(boards)
    .values({
      name: input.name,
      fusionDocId: input.fusionDocId ?? null,
      revision: input.revision ?? "",
    })
    .returning();
  return created;
}

export async function getBoard(id: number) {
  const [row] = await getDb().select().from(boards).where(eq(boards.id, id));
  return row ?? null;
}

export function getBoardBom(boardId: number) {
  return getDb().select().from(bomLines).where(eq(bomLines.boardId, boardId)).orderBy(bomLines.id);
}

export interface BomLineInput {
  partMpn?: string | null;
  value?: string;
  package?: string;
  designators?: string;
  qtyPerBoard: number;
}

export async function replaceBom(boardId: number, lines: BomLineInput[]) {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(bomLines).where(eq(bomLines.boardId, boardId));
    if (lines.length > 0) {
      await tx.insert(bomLines).values(
        lines.map((l) => ({
          boardId,
          partMpn: l.partMpn?.trim() || null,
          value: l.value ?? "",
          package: l.package ?? "",
          designators: l.designators ?? "",
          qtyPerBoard: l.qtyPerBoard,
        })),
      );
    }
  });
}

/** Summed on-hand quantity per MPN (the indexed lookup we benchmarked at ~6ms/50k). */
async function stockByMpns(mpns: string[]): Promise<Record<string, number>> {
  if (mpns.length === 0) return {};
  const rows = await getDb()
    .select({
      mpn: parts.mpn,
      available: sql<number>`COALESCE(SUM(${stockItems.quantity}), 0)`,
    })
    .from(parts)
    .leftJoin(stockItems, eq(stockItems.partId, parts.id))
    .where(inArray(parts.mpn, mpns))
    .groupBy(parts.mpn);

  const map: Record<string, number> = {};
  for (const r of rows) map[r.mpn] = Number(r.available);
  return map;
}

export async function getBoardShortage(
  boardId: number,
  boardCount: number,
): Promise<ShortageReport> {
  const lines = await getBoardBom(boardId);
  const bom: BomLine[] = lines.map((l) => ({
    // Key by MPN when present (so it matches stock); otherwise a synthetic key
    // with no stock — i.e. an unmatched part shows as fully short (MPN missing).
    partKey: l.partMpn || (l.value ? `${l.value}|${l.package}` : `line-${l.id}`),
    qtyPerBoard: l.qtyPerBoard,
    reference: l.designators || l.value || l.partMpn || "",
  }));
  const mpns = lines.map((l) => l.partMpn).filter((m): m is string => Boolean(m));
  const stock = await stockByMpns(mpns);
  return computeShortage(bom, boardCount, stock);
}
