/**
 * Inventory data access. Stock is always changed by appending an inventory_txns
 * row; stock_items.quantity is kept as the running total via an upsert.
 */
import { and, eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { inventoryTxns, locations, parts, stockItems } from "@/lib/db/schema";

export function listParts(limit = 200) {
  return getDb().select().from(parts).orderBy(parts.mpn).limit(limit);
}

export async function createPart(input: {
  mpn: string;
  manufacturer?: string;
  description?: string;
}) {
  const [row] = await getDb()
    .insert(parts)
    .values({
      mpn: input.mpn,
      manufacturer: input.manufacturer ?? "",
      description: input.description ?? "",
    })
    .returning();
  return row;
}

export function listLocations() {
  return getDb().select().from(locations).orderBy(locations.name);
}

export async function createLocation(input: { name: string; description?: string }) {
  const [row] = await getDb()
    .insert(locations)
    .values({ name: input.name, description: input.description ?? "" })
    .returning();
  return row;
}

export function listStock(limit = 500) {
  return getDb()
    .select({
      partId: parts.id,
      mpn: parts.mpn,
      manufacturer: parts.manufacturer,
      locationId: locations.id,
      location: locations.name,
      quantity: stockItems.quantity,
    })
    .from(stockItems)
    .innerJoin(parts, eq(stockItems.partId, parts.id))
    .innerJoin(locations, eq(stockItems.locationId, locations.id))
    .orderBy(parts.mpn)
    .limit(limit);
}

/** Receive `quantity` of `mpn` into a location: find/create the part, bump stock, log a txn. */
export async function receiveStock(input: {
  mpn: string;
  locationId: number;
  quantity: number;
  actor?: string;
  ref?: string;
}) {
  const db = getDb();
  return db.transaction(async (tx) => {
    let [part] = await tx.select().from(parts).where(eq(parts.mpn, input.mpn));
    if (!part) {
      [part] = await tx.insert(parts).values({ mpn: input.mpn }).returning();
    }

    await tx
      .insert(stockItems)
      .values({ partId: part.id, locationId: input.locationId, quantity: input.quantity })
      .onConflictDoUpdate({
        target: [stockItems.partId, stockItems.locationId],
        set: { quantity: sql`${stockItems.quantity} + ${input.quantity}` },
      });

    await tx.insert(inventoryTxns).values({
      partId: part.id,
      locationId: input.locationId,
      delta: input.quantity,
      reason: "receive",
      actor: input.actor ?? "",
      ref: input.ref ?? "",
    });

    const [updated] = await tx
      .select({ quantity: stockItems.quantity })
      .from(stockItems)
      .where(and(eq(stockItems.partId, part.id), eq(stockItems.locationId, input.locationId)));

    return { part, quantity: updated?.quantity ?? input.quantity };
  });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Bulk upsert parts by MPN (the Fusion library sync). Non-empty fields win on update. */
export async function upsertParts(
  items: { mpn: string; manufacturer?: string; description?: string }[],
): Promise<number> {
  const byMpn = new Map<string, { mpn: string; manufacturer: string; description: string }>();
  for (const it of items) {
    const mpn = it.mpn.trim();
    if (mpn) {
      byMpn.set(mpn, {
        mpn,
        manufacturer: (it.manufacturer ?? "").trim(),
        description: (it.description ?? "").trim(),
      });
    }
  }
  const values = [...byMpn.values()];
  if (values.length === 0) return 0;

  const db = getDb();
  for (const part of chunk(values, 1000)) {
    await db
      .insert(parts)
      .values(part)
      .onConflictDoUpdate({
        target: parts.mpn,
        set: {
          manufacturer: sql`CASE WHEN excluded.manufacturer <> '' THEN excluded.manufacturer ELSE ${parts.manufacturer} END`,
          description: sql`CASE WHEN excluded.description <> '' THEN excluded.description ELSE ${parts.description} END`,
          updatedAt: sql`now()`,
        },
      });
  }
  return values.length;
}

/** Every part in the catalog with its total on-hand quantity (0 when never stocked). */
export async function listCatalog(limit = 1000) {
  const rows = await getDb()
    .select({
      id: parts.id,
      mpn: parts.mpn,
      manufacturer: parts.manufacturer,
      description: parts.description,
      stock: sql<number>`COALESCE(SUM(${stockItems.quantity}), 0)`,
    })
    .from(parts)
    .leftJoin(stockItems, eq(stockItems.partId, parts.id))
    .groupBy(parts.id)
    .orderBy(parts.mpn)
    .limit(limit);
  return rows.map((r) => ({ ...r, stock: Number(r.stock) }));
}
