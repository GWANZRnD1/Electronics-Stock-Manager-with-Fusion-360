/**
 * Inventory data access. Stock is always changed by appending an inventory_txns
 * row; stock_items.quantity is kept as the running total via an upsert.
 */
import { and, eq, ilike, or, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { inventoryTxns, locations, parts, stockItems } from "@/lib/db/schema";

export function listParts(limit = 200) {
  return getDb().select().from(parts).orderBy(parts.mpn).limit(limit);
}

export async function createPart(input: {
  mpn: string;
  manufacturer?: string;
  name?: string;
  category?: string;
  package?: string;
  description?: string;
}) {
  const [row] = await getDb()
    .insert(parts)
    .values({
      mpn: input.mpn,
      manufacturer: input.manufacturer ?? "",
      name: input.name ?? "",
      category: input.category ?? "",
      package: input.package ?? "",
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

export interface CatalogFilters {
  q?: string;
  category?: string;
  name?: string;
  manufacturer?: string;
  mpn?: string;
  pkg?: string;
  location?: string;
  limit?: number;
}

/**
 * Catalog with per-attribute search. Each filter is a case-insensitive substring
 * match; `q` matches any text field. `location` matches parts that have stock in a
 * location whose name matches. Returns total stock + a summary of stocked locations.
 */
export async function searchCatalog(f: CatalogFilters = {}) {
  const conds = [];
  if (f.q?.trim()) {
    const q = `%${f.q.trim()}%`;
    conds.push(
      or(
        ilike(parts.mpn, q),
        ilike(parts.name, q),
        ilike(parts.manufacturer, q),
        ilike(parts.category, q),
        ilike(parts.package, q),
        ilike(parts.description, q),
      ),
    );
  }
  if (f.category?.trim()) conds.push(ilike(parts.category, `%${f.category.trim()}%`));
  if (f.name?.trim()) conds.push(ilike(parts.name, `%${f.name.trim()}%`));
  if (f.manufacturer?.trim()) conds.push(ilike(parts.manufacturer, `%${f.manufacturer.trim()}%`));
  if (f.mpn?.trim()) conds.push(ilike(parts.mpn, `%${f.mpn.trim()}%`));
  if (f.pkg?.trim()) conds.push(ilike(parts.package, `%${f.pkg.trim()}%`));
  if (f.location?.trim()) {
    const loc = `%${f.location.trim()}%`;
    conds.push(
      sql`EXISTS (SELECT 1 FROM stock_items si JOIN locations loc ON loc.id = si.location_id
                  WHERE si.part_id = ${parts.id} AND si.quantity > 0 AND loc.name ILIKE ${loc})`,
    );
  }
  const where = conds.length > 0 ? and(...conds) : undefined;

  const rows = await getDb()
    .select({
      id: parts.id,
      category: parts.category,
      name: parts.name,
      manufacturer: parts.manufacturer,
      mpn: parts.mpn,
      package: parts.package,
      stock: sql<number>`COALESCE(SUM(${stockItems.quantity}), 0)`,
      locations: sql<string>`COALESCE(STRING_AGG(DISTINCT CASE WHEN ${stockItems.quantity} > 0 THEN ${locations.name} END, ', '), '')`,
    })
    .from(parts)
    .leftJoin(stockItems, eq(stockItems.partId, parts.id))
    .leftJoin(locations, eq(locations.id, stockItems.locationId))
    .where(where)
    .groupBy(parts.id)
    .orderBy(parts.category, parts.mpn)
    .limit(f.limit ?? 500);
  return rows.map((r) => ({ ...r, stock: Number(r.stock) }));
}
