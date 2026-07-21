/** Build (assemble) a board: check stock, consume it (logging txns), record history. */
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  boardPopulationProgress,
  buildConsumptions,
  builds,
  inventoryTxns,
  parts,
  stockItems,
} from "@/lib/db/schema";
import { resolveBoardBom } from "@/lib/repo/jellybeans";

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
 * are tracked/consumed (lines without an MPN are counted as "untracked"). With
 * `onlyMpns`, just those MPNs are required/consumed. Blocks (no consumption) if a
 * tracked-and-selected part is short; otherwise consumes stock greedily across
 * locations, logging an inventory_txn + build_consumption per draw.
 */
export async function buildBoard(
  boardId: number,
  quantity: number,
  actor: string,
  onlyMpns?: string[],
  userKey?: string,
) {
  const db = getDb();
  const lines = await resolveBoardBom(boardId);

  // When a selection is given, only those MPNs are required and consumed; the
  // shortage check below then blocks only on the *selected* parts.
  const only = onlyMpns && onlyMpns.length > 0 ? new Set(onlyMpns) : null;

  const requiredByPart = new Map<number, { mpn: string; required: number }>();
  const unresolvedRequired = new Map<string, number>();
  let untracked = 0;
  for (const line of lines) {
    const resolved = line.resolvedPart;
    const mpn = (resolved?.mpn ?? line.partMpn ?? "").trim();
    if (only) {
      const selected =
        (resolved && only.has(resolved.mpn)) ||
        Boolean(line.partMpn && only.has(line.partMpn));
      if (selected && resolved) {
        const current = requiredByPart.get(resolved.id);
        requiredByPart.set(resolved.id, {
          mpn: resolved.mpn,
          required: (current?.required ?? 0) + line.qtyPerBoard * quantity,
        });
      } else if (selected && mpn) {
        unresolvedRequired.set(
          mpn,
          (unresolvedRequired.get(mpn) ?? 0) + line.qtyPerBoard * quantity,
        );
      }
      continue;
    }
    if (!resolved) {
      if (mpn) {
        unresolvedRequired.set(
          mpn,
          (unresolvedRequired.get(mpn) ?? 0) + line.qtyPerBoard * quantity,
        );
      } else {
        untracked += 1;
      }
      continue;
    }
    if (!mpn) {
      untracked += 1;
      continue;
    }
    const current = requiredByPart.get(resolved.id);
    requiredByPart.set(resolved.id, {
      mpn: resolved.mpn,
      required: (current?.required ?? 0) + line.qtyPerBoard * quantity,
    });
  }

  const partIds = [...requiredByPart.keys()];

  return db.transaction(async (tx) => {
    // Stock must be checked only after all relevant rows are locked. Otherwise
    // two assemblers can both pass a pre-transaction availability check and
    // consume the same physical units.
    const lockedStock = partIds.length
      ? await tx
          .select()
          .from(stockItems)
          .where(inArray(stockItems.partId, partIds))
          .orderBy(stockItems.id)
          .for("update")
      : [];
    const availByPart = new Map<number, number>();
    for (const row of lockedStock) {
      availByPart.set(row.partId, (availByPart.get(row.partId) ?? 0) + row.quantity);
    }
    const shortages: ShortageItem[] = [];
    for (const [pid, requirement] of requiredByPart) {
      const available = availByPart.get(pid) ?? 0;
      if (available < requirement.required) {
        shortages.push({ mpn: requirement.mpn, required: requirement.required, available });
      }
    }
    for (const [mpn, required] of unresolvedRequired) {
      shortages.push({ mpn, required, available: 0 });
    }
    if (shortages.length > 0) throw new BuildShortageError(shortages);

    const [build] = await tx
      .insert(builds)
      .values({ boardId, quantity, status: "completed", actor, completedAt: new Date() })
      .returning();

    const consumed: { mpn: string; qty: number }[] = [];
    for (const [pid, requirement] of requiredByPart) {
      const { mpn, required } = requirement;
      let remaining = required;
      const rows = lockedStock
        .filter((row) => row.partId === pid && row.quantity > 0)
        .sort((a, b) => b.quantity - a.quantity || a.id - b.id);
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

    if (userKey) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userKey}), ${boardId})`);
      await tx.delete(boardPopulationProgress).where(
        and(
          eq(boardPopulationProgress.userKey, userKey),
          eq(boardPopulationProgress.boardId, boardId),
        ),
      );
    }

    return { build, consumed, untracked, progressReset: Boolean(userKey) };
  });
}

export class NoBuildError extends Error {
  constructor() {
    super("no build to cancel");
    this.name = "NoBuildError";
  }
}

export interface CancelResult {
  buildId: number;
  reversed: { mpn: string; qty: number }[];
  fullyCancelled: boolean;
}

/**
 * Reverse the most recent completed build: re-credit the consumed stock to the
 * exact part+location it was drawn from, logging a "build-cancel" txn per draw.
 * With `onlyMpns`, only those parts are restored (a partial cancel); the build is
 * marked "cancelled" once nothing is left to reverse.
 */
export async function cancelLastBuild(
  boardId: number,
  onlyMpns: string[] | undefined,
  actor: string,
): Promise<CancelResult> {
  const db = getDb();
  const [latest] = await db
    .select()
    .from(builds)
    .where(and(eq(builds.boardId, boardId), eq(builds.status, "completed")))
    .orderBy(desc(builds.createdAt))
    .limit(1);
  if (!latest) throw new NoBuildError();

  const cons = await db
    .select({
      id: buildConsumptions.id,
      partId: buildConsumptions.partId,
      locationId: buildConsumptions.locationId,
      quantity: buildConsumptions.quantity,
      mpn: parts.mpn,
    })
    .from(buildConsumptions)
    .innerJoin(parts, eq(parts.id, buildConsumptions.partId))
    .where(eq(buildConsumptions.buildId, latest.id));

  const only = onlyMpns && onlyMpns.length > 0 ? new Set(onlyMpns) : null;
  const target = only ? cons.filter((c) => only.has(c.mpn)) : cons;
  if (target.length === 0) throw new NoBuildError();

  return db.transaction(async (tx) => {
    const reversedByMpn = new Map<string, number>();
    for (const c of target) {
      if (c.locationId != null) {
        await tx
          .update(stockItems)
          .set({ quantity: sql`${stockItems.quantity} + ${c.quantity}` })
          .where(and(eq(stockItems.partId, c.partId), eq(stockItems.locationId, c.locationId)));
      }
      await tx.insert(inventoryTxns).values({
        partId: c.partId,
        locationId: c.locationId,
        delta: c.quantity,
        reason: "build-cancel",
        ref: `build:${latest.id}`,
        actor,
      });
      await tx.delete(buildConsumptions).where(eq(buildConsumptions.id, c.id));
      reversedByMpn.set(c.mpn, (reversedByMpn.get(c.mpn) ?? 0) + c.quantity);
    }

    const [{ remaining }] = await tx
      .select({ remaining: sql<number>`COUNT(*)` })
      .from(buildConsumptions)
      .where(eq(buildConsumptions.buildId, latest.id));
    const fullyCancelled = Number(remaining) === 0;
    if (fullyCancelled) {
      await tx.update(builds).set({ status: "cancelled" }).where(eq(builds.id, latest.id));
    }

    return {
      buildId: latest.id,
      reversed: [...reversedByMpn].map(([mpn, qty]) => ({ mpn, qty })),
      fullyCancelled,
    };
  });
}
