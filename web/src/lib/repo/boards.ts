/** Boards, their BOM lines, and shortage computation (uses the indexed stock sum). */
import { and, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { boards, bomLines, buildConsumptions, builds, parts, stockItems } from "@/lib/db/schema";
import { type BomLine, computeShortage, type ShortageReport } from "@/lib/domain/shortage";

export function listBoards() {
  return getDb().select().from(boards).orderBy(boards.name);
}

/**
 * Create a new board revision. (name + revision) must be unique — if that pair
 * already exists we return it with `created: false` so the caller can report the
 * clash instead of silently adding a duplicate.
 */
export async function createBoard(input: { name: string; revision: string }) {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(boards)
    .where(and(eq(boards.name, input.name), eq(boards.revision, input.revision)));
  if (existing) return { board: existing, created: false };

  const [row] = await db
    .insert(boards)
    .values({ name: input.name, revision: input.revision })
    .returning();
  return { board: row, created: true };
}

/**
 * Find a board by Fusion doc id (preferred) or by name + revision, updating it;
 * create if absent. A re-import always un-archives the board. Distinct revisions
 * of the same name coexist as separate rows (grouped by name in the UI), so
 * importing a board whose revision differs creates a new revision rather than
 * overwriting the old one.
 */
export async function upsertBoard(input: {
  name: string;
  fusionDocId?: string | null;
  revision?: string;
}) {
  const db = getDb();
  const revision = input.revision ?? "";

  if (input.fusionDocId) {
    const [byDoc] = await db.select().from(boards).where(eq(boards.fusionDocId, input.fusionDocId));
    if (byDoc) {
      await db
        .update(boards)
        .set({ name: input.name, revision, archived: false })
        .where(eq(boards.id, byDoc.id));
      return { ...byDoc, name: input.name, revision, archived: false };
    }
  }

  const [match] = await db
    .select()
    .from(boards)
    .where(and(eq(boards.name, input.name), eq(boards.revision, revision)));
  if (match) {
    const fusionDocId = input.fusionDocId ?? match.fusionDocId;
    await db.update(boards).set({ fusionDocId, archived: false }).where(eq(boards.id, match.id));
    return { ...match, fusionDocId, archived: false };
  }

  const [created] = await db
    .insert(boards)
    .values({ name: input.name, fusionDocId: input.fusionDocId ?? null, revision })
    .returning();
  return created;
}

export async function getBoard(id: number) {
  const [row] = await getDb().select().from(boards).where(eq(boards.id, id));
  return row ?? null;
}

/** Relabel a single revision (one board row). */
export async function updateBoardRevision(id: number, revision: string) {
  await getDb().update(boards).set({ revision }).where(eq(boards.id, id));
}

/** Rename the whole family — every revision sharing this board's current name. */
export async function renameBoardFamily(id: number, name: string) {
  const db = getDb();
  const current = await getBoard(id);
  if (!current) return;
  await db.update(boards).set({ name }).where(eq(boards.name, current.name));
}

/** Archive/unarchive the whole family (every revision under this board's name). */
export async function setBoardFamilyArchived(id: number, archived: boolean) {
  const db = getDb();
  const current = await getBoard(id);
  if (!current) return;
  await db.update(boards).set({ archived }).where(eq(boards.name, current.name));
}

/** Delete one revision and everything that hangs off it (BOM, builds, consumptions). */
export async function deleteBoard(id: number) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const buildRows = await tx.select({ id: builds.id }).from(builds).where(eq(builds.boardId, id));
    const buildIds = buildRows.map((b) => b.id);
    if (buildIds.length > 0) {
      await tx.delete(buildConsumptions).where(inArray(buildConsumptions.buildId, buildIds));
    }
    await tx.delete(builds).where(eq(builds.boardId, id));
    await tx.delete(bomLines).where(eq(bomLines.boardId, id));
    await tx.delete(boards).where(eq(boards.id, id));
  });
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
