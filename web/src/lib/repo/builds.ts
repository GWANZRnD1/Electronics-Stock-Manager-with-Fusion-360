/** Build (assemble) a board: check stock, consume it (logging txns), record history. */
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { bomLines, buildConsumptions, builds, inventoryTxns, parts, stockItems } from "@/lib/db/schema";

export interface ShortageItem {
  mpn: string;
  required: number;
  available: number;
}

export class BuildShortageError extends Error {
  shortages: ShortageItem[];
  constructor(shortages: ShortageItem[]) {
    super("insufficient stock");
    this.name = "BuildShortageError";
    this.shortages = shortages;
  }
}

export function listBuilds(boardId: number) {
  return getDb()
    .select()
    .from(builds)
    .where(eq(builds.boardId, boardId))
    .orderBy(desc(builds.createdAt));
}

/**
 * Build `quantity` units: only BOM lines with an MPN that maps to a catalog part
 * are tracked/consumed (lines without an MPN are counted as "untracked"). Blocks
 * (no consumption) if any tracked part is short; otherwise consumes stock greedily
 * across locations, logging an inventory_txn + build_consumption per draw.
 */
export async function buildBoard(boardId: number, quantity: number, actor: string) {
  const db = getDb();
  const lines = await db.select().from(bomLines).where(eq(bomLines.boardId, boardId));

  const requiredByMpn = new Map<string, number>();
  let untracked = 0;
  for (const line of lines) {
    const mpn = (line.partMpn ?? "").trim();
    if (!mpn) {
      untracked += 1;
      continue;
    }
    requiredByMpn.set(mpn, (requiredByMpn.get(mpn) ?? 0) + line.qtyPerBoard * quantity);
  }

  const mpns = [...requiredByMpn.keys()];
  const partRows = mpns.length
    ? await db.select({ id: parts.id, mpn: parts.mpn }).from(parts).where(inArray(parts.mpn, mpns))
    : [];
  const partIdByMpn = new Map(partRows.map((p) => [p.mpn, p.id]));
  const partIds = partRows.map((p) => p.id);

  const stockRows = partIds.length
    ? await db
        .select({
          partId: stockItems.partId,
          available: sql<number>`COALESCE(SUM(${stockItems.quantity}), 0)`,
        })
        .from(stockItems)
        .where(inArray(stockItems.partId, partIds))
        .groupBy(stockItems.partId)
    : [];
  const availByPart = new Map(stockRows.map((r) => [r.partId, Number(r.available)]));

  const shortages: ShortageItem[] = [];
  for (const [mpn, required] of requiredByMpn) {
    const pid = partIdByMpn.get(mpn);
    const available = pid ? (availByPart.get(pid) ?? 0) : 0;
    if (available < required) shortages.push({ mpn, required, available });
  }
  if (shortages.length > 0) throw new BuildShortageError(shortages);

  return db.transaction(async (tx) => {
    const [build] = await tx
      .insert(builds)
      .values({ boardId, quantity, status: "completed", actor, completedAt: new Date() })
      .returning();

    const consumed: { mpn: string; qty: number }[] = [];
    for (const [mpn, required] of requiredByMpn) {
      const pid = partIdByMpn.get(mpn);
      if (!pid) {
        untracked += 1;
        continue;
      }
      let remaining = required;
      const rows = await tx
        .select()
        .from(stockItems)
        .where(and(eq(stockItems.partId, pid), sql`${stockItems.quantity} > 0`))
        .orderBy(desc(stockItems.quantity));
      for (const row of rows) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, row.quantity);
        await tx.update(stockItems).set({ quantity: row.quantity - take }).where(eq(stockItems.id, row.id));
        await tx.insert(inventoryTxns).values({
          partId: pid,
          locationId: row.locationId,
          delta: -take,
          reason: "build",
          ref: `build:${build.id}`,
          actor,
        });
        await tx.insert(buildConsumptions).values({
          buildId: build.id,
          partId: pid,
          locationId: row.locationId,
          quantity: take,
        });
        remaining -= take;
      }
      consumed.push({ mpn, qty: required });
    }

    return { build, consumed, untracked };
  });
}
