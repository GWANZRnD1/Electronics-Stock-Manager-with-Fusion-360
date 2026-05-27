/**
 * Inventory data access. Stock is always changed by appending an inventory_txns
 * row; stock_items.quantity is kept as the running total via an upsert.
 */
import { and, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { getDb } from "@/lib/db";
import { lookupPart } from "@/lib/distributors";
import { inventoryTxns, locations, parts, stockItems } from "@/lib/db/schema";
import { bundleCategories, categoryKey } from "@/lib/domain/categories";
import { deriveField, deriveValue } from "@/lib/domain/enrich";
import type { NormalizedRow } from "@/lib/domain/inventoryCsv";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Editable part metadata shared by create and update. unitCost is per-unit money. */
export interface PartFields {
  mpn?: string;
  manufacturer?: string;
  name?: string;
  category?: string;
  package?: string;
  description?: string;
  supplier?: string;
  spn?: string;
  value?: string;
  unitCost?: number | null;
}

/** numeric columns round-trip as strings in drizzle; null stays null. */
const money = (n: number | null | undefined): string | null =>
  n === null || n === undefined ? null : String(n);

/**
 * Postgres expression that mirrors `categoryKey` in domain/categories: lower,
 * trim, collapse whitespace, de-pluralize. Keep the two in lockstep so a
 * canonical dropdown value matches every spelling variant stored in the table.
 */
function categoryKeySql(col: PgColumn): SQL<string> {
  return sql<string>`regexp_replace(regexp_replace(regexp_replace(lower(btrim(${col})), '\\s+', ' ', 'g'), 'ies$', 'y'), '([^s])s$', '\\1')`;
}

export function listParts(limit = 200) {
  return getDb().select().from(parts).orderBy(parts.mpn).limit(limit);
}

export async function createPart(input: PartFields & { mpn: string }) {
  const [row] = await getDb()
    .insert(parts)
    .values({
      mpn: input.mpn,
      manufacturer: input.manufacturer ?? "",
      name: input.name ?? "",
      category: input.category ?? "",
      package: input.package ?? "",
      description: input.description ?? "",
      supplier: input.supplier ?? "",
      spn: input.spn ?? "",
      value: input.value ?? "",
      unitCost: money(input.unitCost),
    })
    .returning();
  return row;
}

/** Update a part's editable metadata. Returns the row, or null if no such id. */
export async function updatePart(id: number, patch: PartFields) {
  const set: Partial<typeof parts.$inferInsert> = {};
  if (patch.mpn !== undefined) set.mpn = patch.mpn;
  if (patch.manufacturer !== undefined) set.manufacturer = patch.manufacturer;
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.package !== undefined) set.package = patch.package;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.supplier !== undefined) set.supplier = patch.supplier;
  if (patch.spn !== undefined) set.spn = patch.spn;
  if (patch.value !== undefined) set.value = patch.value;
  if (patch.unitCost !== undefined) set.unitCost = money(patch.unitCost);

  if (Object.keys(set).length === 0) {
    const [row] = await getDb().select().from(parts).where(eq(parts.id, id));
    return row ?? null;
  }
  const [row] = await getDb()
    .update(parts)
    .set({ ...set, updatedAt: sql`now()` })
    .where(eq(parts.id, id))
    .returning();
  return row ?? null;
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
  manufacturer?: string;
  name?: string;
  category?: string;
  package?: string;
}) {
  const db = getDb();
  return db.transaction(async (tx) => {
    let [part] = await tx.select().from(parts).where(eq(parts.mpn, input.mpn));
    if (!part) {
      [part] = await tx
        .insert(parts)
        .values({
          mpn: input.mpn,
          manufacturer: input.manufacturer ?? "",
          name: input.name ?? "",
          category: input.category ?? "",
          package: input.package ?? "",
        })
        .returning();
    } else {
      // Backfill any missing metadata without clobbering existing values.
      const patch: Partial<typeof parts.$inferInsert> = {};
      if (!part.manufacturer && input.manufacturer) patch.manufacturer = input.manufacturer;
      if (!part.name && input.name) patch.name = input.name;
      if (!part.category && input.category) patch.category = input.category;
      if (!part.package && input.package) patch.package = input.package;
      if (Object.keys(patch).length > 0) {
        await tx.update(parts).set(patch).where(eq(parts.id, part.id));
      }
    }

    await tx
      .insert(stockItems)
      .values({
        partId: part.id,
        locationId: input.locationId,
        quantity: input.quantity,
        lastConfirmedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [stockItems.partId, stockItems.locationId],
        set: { quantity: sql`${stockItems.quantity} + ${input.quantity}`, lastConfirmedAt: sql`now()` },
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
        targetWhere: sql`${parts.mpn} <> ''`, // matches the partial unique index
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
  // Match the selected category against every spelling variant (Resistor/Resistors).
  if (f.category?.trim()) conds.push(sql`${categoryKeySql(parts.category)} = ${categoryKey(f.category)}`);
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
      supplier: parts.supplier,
      spn: parts.spn,
      manufacturer: parts.manufacturer,
      mpn: parts.mpn,
      name: parts.name,
      description: parts.description,
      package: parts.package,
      value: parts.value,
      unitCost: parts.unitCost,
      totalQuantity: sql<number>`COALESCE(SUM(${stockItems.quantity}), 0)`,
      numLocations: sql<number>`COUNT(DISTINCT CASE WHEN ${stockItems.quantity} > 0 THEN ${stockItems.locationId} END)`,
      locations: sql<string>`COALESCE(STRING_AGG(DISTINCT CASE WHEN ${stockItems.quantity} > 0 THEN ${locations.name} END, ', '), '')`,
    })
    .from(parts)
    .leftJoin(stockItems, eq(stockItems.partId, parts.id))
    .leftJoin(locations, eq(locations.id, stockItems.locationId))
    .where(where)
    .groupBy(parts.id)
    .orderBy(categoryKeySql(parts.category), parts.mpn)
    .limit(f.limit ?? 500);

  // Bundle spelling variants so every row of one category shows the same label.
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  const { byKey } = bundleCategories([...counts].map(([label, count]) => ({ label, count })));
  return rows.map((r) => {
    const unitCost = r.unitCost === null ? null : Number(r.unitCost);
    const totalQuantity = Number(r.totalQuantity);
    return {
      ...r,
      unitCost,
      totalQuantity,
      numLocations: Number(r.numLocations),
      stockValue: unitCost === null ? null : Number((unitCost * totalQuantity).toFixed(4)),
      category: r.category ? byKey.get(categoryKey(r.category)) ?? r.category : r.category,
    };
  });
}

/** Per-location stock detail for one part (the expandable row). */
export async function getPartStock(partId: number) {
  return getDb()
    .select({
      locationId: stockItems.locationId,
      location: locations.name,
      quantity: stockItems.quantity,
      lastConfirmedAt: stockItems.lastConfirmedAt,
    })
    .from(stockItems)
    .innerJoin(locations, eq(locations.id, stockItems.locationId))
    .where(eq(stockItems.partId, partId))
    .orderBy(locations.name);
}

/** Mark a part+location count as physically confirmed now. Returns false if missing. */
export async function confirmStock(partId: number, locationId: number): Promise<boolean> {
  const rows = await getDb()
    .update(stockItems)
    .set({ lastConfirmedAt: sql`now()` })
    .where(and(eq(stockItems.partId, partId), eq(stockItems.locationId, locationId)))
    .returning({ id: stockItems.id });
  return rows.length > 0;
}

/** Total stock value (Σ qty × unit cost), quantity, and part count per bundled category. */
export async function categorySummary() {
  const rows = await getDb()
    .select({
      category: parts.category,
      value: sql<string>`COALESCE(SUM(${parts.unitCost} * ${stockItems.quantity}), 0)`,
      quantity: sql<number>`COALESCE(SUM(${stockItems.quantity}), 0)`,
      partCount: sql<number>`COUNT(DISTINCT ${parts.id})`,
    })
    .from(parts)
    .leftJoin(stockItems, eq(stockItems.partId, parts.id))
    .groupBy(parts.category);

  // Fold spelling variants into one representative label, summing across variants.
  const { byKey } = bundleCategories(
    rows.filter((r) => r.category).map((r) => ({ label: r.category, count: Number(r.partCount) })),
  );
  const merged = new Map<string, { category: string; value: number; quantity: number; partCount: number }>();
  for (const r of rows) {
    const label = r.category ? byKey.get(categoryKey(r.category)) ?? r.category : "(uncategorized)";
    const cur = merged.get(label) ?? { category: label, value: 0, quantity: 0, partCount: 0 };
    cur.value += Number(r.value);
    cur.quantity += Number(r.quantity);
    cur.partCount += Number(r.partCount);
    merged.set(label, cur);
  }
  return [...merged.values()]
    .map((m) => ({ ...m, value: Number(m.value.toFixed(2)) }))
    .sort((a, b) => b.value - a.value);
}

/** Non-empty categories for the search dropdown, with spelling variants bundled. */
export async function listCategories(): Promise<string[]> {
  const rows = await getDb()
    .select({ category: parts.category, count: sql<number>`count(*)` })
    .from(parts)
    .where(sql`${parts.category} <> ''`)
    .groupBy(parts.category);
  return bundleCategories(rows.map((r) => ({ label: r.category, count: Number(r.count) }))).labels;
}

/** Full reset: wipe all inventory + board data and restart identity counters. */
export async function purgeAll(): Promise<void> {
  await getDb().execute(
    sql`TRUNCATE TABLE build_consumptions, builds, bom_lines, boards, inventory_txns, stock_items, parts, locations RESTART IDENTITY CASCADE`,
  );
}

/** Collapse the rows that share a part identity into one part's column values. */
function buildPartValues(group: NormalizedRow[]): typeof parts.$inferInsert {
  const firstNonEmpty = (sel: (r: NormalizedRow) => string) => group.map(sel).find((v) => v) ?? "";
  // Prefer the unit cost from the most recently confirmed row that has one.
  let unitCost: number | null = null;
  let bestTime = -Infinity;
  for (const r of group) {
    if (r.unitCost === null) continue;
    const t = r.lastConfirmedAt ? r.lastConfirmedAt.getTime() : 0;
    if (unitCost === null || t > bestTime) {
      unitCost = r.unitCost;
      bestTime = t;
    }
  }
  return {
    mpn: firstNonEmpty((r) => r.mpn),
    manufacturer: firstNonEmpty((r) => r.manufacturer),
    category: firstNonEmpty((r) => r.category),
    description: firstNonEmpty((r) => r.description),
    supplier: firstNonEmpty((r) => r.supplier),
    spn: firstNonEmpty((r) => r.spn),
    value: firstNonEmpty((r) => r.value),
    unitCost: money(unitCost),
  };
}

export interface ImportResult {
  parts: number;
  stockEntries: number;
  locations: number;
  totalQuantity: number;
}

/**
 * Bulk-load normalized CSV rows. Locations are merged case-insensitively (keeping
 * the most common spelling); blank-location rows with stock land in "Unspecified".
 * Rows are grouped into parts by MPN (or description when the MPN is blank), and
 * same part+location rows have their quantities summed. Runs in one transaction.
 */
export async function importInventory(rows: NormalizedRow[]): Promise<ImportResult> {
  const UNSPECIFIED = "Unspecified";
  const db = getDb();
  return db.transaction(async (tx) => {
    // 1. Canonical location names (case-insensitive → most common spelling).
    const variants = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const key = r.location.trim().toLowerCase();
      if (!key) continue;
      const m = variants.get(key) ?? new Map<string, number>();
      m.set(r.location.trim(), (m.get(r.location.trim()) ?? 0) + 1);
      variants.set(key, m);
    }
    const repByKey = new Map<string, string>();
    for (const [key, m] of variants) {
      repByKey.set(
        key,
        [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
      );
    }
    const repNames = new Set(repByKey.values());
    if (rows.some((r) => !r.location.trim() && r.quantity > 0)) repNames.add(UNSPECIFIED);

    const locId = new Map<string, number>();
    for (const part of chunk([...repNames], 500)) {
      const inserted = await tx
        .insert(locations)
        .values(part.map((name) => ({ name })))
        .returning({ id: locations.id, name: locations.name });
      for (const row of inserted) locId.set(row.name, row.id);
    }
    const locIdFor = (raw: string): number | null => {
      const key = raw.trim().toLowerCase();
      const name = key ? repByKey.get(key) : UNSPECIFIED;
      return name ? locId.get(name) ?? null : null;
    };

    // 2. Group rows into parts (MPN, else description).
    const groups = new Map<string, NormalizedRow[]>();
    for (const r of rows) {
      const key = r.mpn ? `MPN::${r.mpn.toUpperCase()}` : `DESC::${r.description.toUpperCase()}`;
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    }
    const groupList = [...groups.values()];

    // 3. Insert parts, capturing ids in insertion order.
    const partIds: number[] = [];
    for (const part of chunk(groupList.map(buildPartValues), 500)) {
      const inserted = await tx.insert(parts).values(part).returning({ id: parts.id });
      partIds.push(...inserted.map((r) => r.id));
    }

    // 4. Build stock entries, summing same part+location and keeping the latest date.
    const acc = new Map<string, typeof stockItems.$inferInsert>();
    groupList.forEach((group, i) => {
      const partId = partIds[i];
      for (const r of group) {
        if (r.quantity <= 0) continue;
        const locationId = locIdFor(r.location);
        if (locationId === null) continue;
        const k = `${partId}:${locationId}`;
        const cur = acc.get(k);
        if (cur) {
          cur.quantity = (cur.quantity ?? 0) + r.quantity;
          if (r.lastConfirmedAt && (!cur.lastConfirmedAt || r.lastConfirmedAt > cur.lastConfirmedAt)) {
            cur.lastConfirmedAt = r.lastConfirmedAt;
          }
        } else {
          acc.set(k, { partId, locationId, quantity: r.quantity, lastConfirmedAt: r.lastConfirmedAt });
        }
      }
    });
    const stockValues = [...acc.values()];
    for (const part of chunk(stockValues, 1000)) {
      await tx.insert(stockItems).values(part);
    }

    return {
      parts: groupList.length,
      stockEntries: stockValues.length,
      locations: repNames.size,
      totalQuantity: stockValues.reduce((s, v) => s + (v.quantity ?? 0), 0),
    };
  });
}

// Parts eligible for distributor value enrichment: blank value, a real MPN, not a jellybean.
const enrichWhere = () =>
  and(eq(parts.value, ""), sql`${parts.mpn} <> ''`, sql`lower(${parts.supplier}) <> 'jellybean'`);

/** Count of parts still missing a component value (for the enrich UI). */
export async function enrichableCount(): Promise<number> {
  const [row] = await getDb().select({ n: sql<number>`count(*)` }).from(parts).where(enrichWhere());
  return Number(row?.n ?? 0);
}

export interface EnrichBatchResult {
  processed: number;
  updated: number;
  nextAfterId: number | null; // pass back as `afterId` for the next batch; null = sweep complete
}

/**
 * One resumable batch of distributor enrichment. Sweeps parts by ascending id
 * (so value-less parts like ICs aren't retried endlessly), filling blank value
 * /category/package from DigiKey/Mouser. Sequential with a delay between parts to
 * respect rate limits; lookupPart caches. Drive it with a loop, passing the
 * returned nextAfterId until it comes back null.
 */
export async function enrichValues(
  opts: { limit?: number; delayMs?: number; afterId?: number } = {},
): Promise<EnrichBatchResult> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 200);
  const delayMs = opts.delayMs ?? 300;
  const afterId = opts.afterId ?? 0;
  const db = getDb();

  const targets = await db
    .select({
      id: parts.id,
      mpn: parts.mpn,
      description: parts.description,
      category: parts.category,
      package: parts.package,
    })
    .from(parts)
    .where(and(enrichWhere(), sql`${parts.id} > ${afterId}`))
    .orderBy(parts.id)
    .limit(limit);

  let updated = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    let offers;
    try {
      ({ offers } = await lookupPart(t.mpn));
    } catch {
      continue; // transient distributor error — leave it for a later sweep
    }
    const patch: Partial<typeof parts.$inferInsert> = {};
    const value = deriveValue(offers, t.description);
    if (value) patch.value = value;
    if (!t.category) {
      const c = deriveField(offers, "category");
      if (c) patch.category = c;
    }
    if (!t.package) {
      const p = deriveField(offers, "package");
      if (p) patch.package = p;
    }
    if (Object.keys(patch).length > 0) {
      await db.update(parts).set({ ...patch, updatedAt: sql`now()` }).where(eq(parts.id, t.id));
      updated++;
    }
    if (i < targets.length - 1) await sleep(delayMs);
  }

  return { processed: targets.length, updated, nextAfterId: targets.at(-1)?.id ?? null };
}
