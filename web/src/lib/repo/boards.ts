/** Boards, their BOM lines, and shortage computation (uses the indexed stock sum). */
import { and, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  boardImages,
  boards,
  bomLines,
  buildConsumptions,
  builds,
  componentPlacements,
  parts,
} from "@/lib/db/schema";
import { type BomLine, computeShortage, type ShortageReport } from "@/lib/domain/shortage";
import { resolveBoardBom } from "@/lib/repo/jellybeans";

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
    await tx.delete(componentPlacements).where(eq(componentPlacements.boardId, id));
    await tx.delete(boardImages).where(eq(boardImages.boardId, id));
    await tx.delete(boards).where(eq(boards.id, id));
  });
}

export interface PlacementInput {
  designator?: string;
  x: number;
  y: number;
  angle?: number;
  side?: "top" | "bottom";
  package?: string;
  mpn?: string | null;
}

export interface Outline {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Replace all placements for a board and store the outline bbox on the board. */
export async function replacePlacements(
  boardId: number,
  outline: Outline,
  placements: PlacementInput[],
) {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(boards)
      .set({
        outlineMinX: String(outline.minX),
        outlineMinY: String(outline.minY),
        outlineMaxX: String(outline.maxX),
        outlineMaxY: String(outline.maxY),
      })
      .where(eq(boards.id, boardId));
    await tx.delete(componentPlacements).where(eq(componentPlacements.boardId, boardId));
    if (placements.length > 0) {
      await tx.insert(componentPlacements).values(
        placements.map((p) => ({
          boardId,
          designator: p.designator ?? "",
          x: String(p.x),
          y: String(p.y),
          angle: String(p.angle ?? 0),
          side: p.side ?? "top",
          package: p.package ?? "",
          mpn: p.mpn?.trim() || null,
        })),
      );
    }
  });
}

export function getPlacements(boardId: number) {
  return getDb()
    .select()
    .from(componentPlacements)
    .where(eq(componentPlacements.boardId, boardId))
    .orderBy(componentPlacements.id);
}

export function getBoardBom(boardId: number) {
  return getDb().select().from(bomLines).where(eq(bomLines.boardId, boardId)).orderBy(bomLines.id);
}

/**
 * BOM lines enriched with catalog details (manufacturer, supplier + supplier
 * part number, unit cost) and current on-hand stock, matched by MPN. Powers the
 * Assembly view's component detail card. Lines without a catalog match (blank or
 * unknown MPN) simply carry empty catalog fields and zero stock.
 */
export async function getBoardBomDetailed(boardId: number) {
  const lines = await resolveBoardBom(boardId);
  return lines.map((l) => {
    const c = l.resolvedPart;
    return {
      id: l.id,
      boardId: l.boardId,
      value: l.value,
      package: l.package,
      designators: l.designators,
      qtyPerBoard: l.qtyPerBoard,
      partMpn: l.partMpn,
      matchedPartId: l.matchedPartId,
      manufacturer: c?.manufacturer ?? "",
      supplier: c?.supplier ?? "",
      spn: c?.spn ?? "",
      unitCost: c?.unitCost ?? null,
      onHand: c?.onHand ?? 0,
      resolvedPartId: c?.id ?? null,
      resolvedMpn: c?.mpn ?? null,
      matchType: l.matchType,
      matchNotes: l.matchNotes,
      stockLocations: c?.stockLocations ?? [],
      projectQuantity: c?.projectQuantity ?? 0,
      alternatives: l.alternatives,
    };
  });
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

/** Catalog `supplier` per MPN (for routing shortages to a buy distributor). */
export async function suppliersByMpns(mpns: string[]): Promise<Record<string, string>> {
  if (mpns.length === 0) return {};
  const rows = await getDb()
    .select({ mpn: parts.mpn, supplier: parts.supplier })
    .from(parts)
    .where(inArray(parts.mpn, mpns));
  const map: Record<string, string> = {};
  for (const r of rows) map[r.mpn] = r.supplier;
  return map;
}

export async function getBoardShortage(
  boardId: number,
  boardCount: number,
): Promise<ShortageReport> {
  const lines = await resolveBoardBom(boardId);
  const bom: BomLine[] = lines.map((l) => ({
    // Key by MPN when present (so it matches stock); otherwise a synthetic key
    // with no stock — i.e. an unmatched part shows as fully short (MPN missing).
    partKey:
      l.resolvedPart?.mpn ||
      l.partMpn ||
      (l.value ? `${l.value}|${l.package}` : `line-${l.id}`),
    qtyPerBoard: l.qtyPerBoard,
    reference: l.designators || l.value || l.partMpn || "",
  }));
  const stock: Record<string, number> = {};
  for (const line of lines) {
    if (line.resolvedPart) stock[line.resolvedPart.mpn] = line.resolvedPart.onHand;
  }
  return computeShortage(bom, boardCount, stock);
}
