/**
 * Drizzle schema. Indexes are chosen so stock lookups stay fast on large
 * datasets: lookups by MPN (parts), summed on-hand per part (stock_items by
 * part_id), and BOM rows by board. Change stock only by appending an
 * inventory_txns row; keep stock_items.quantity as the materialized sum.
 */
import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const parts = pgTable(
  "parts",
  {
    id: serial("id").primaryKey(),
    mpn: text("mpn").notNull(),
    manufacturer: text("manufacturer").notNull().default(""),
    name: text("name").notNull().default(""), // human label, e.g. "RES 47 OHM 1% 0603"
    category: text("category").notNull().default(""), // e.g. "Resistor", "Capacitor", "IC"
    package: text("package").notNull().default(""), // size/footprint, e.g. "0603", "SOIC-14", "TH"
    description: text("description").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("parts_mpn_uq").on(t.mpn),
    index("parts_category_idx").on(t.category),
    index("parts_package_idx").on(t.package),
  ],
);

export const locations = pgTable(
  "locations",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
  },
  (t) => [uniqueIndex("locations_name_uq").on(t.name)],
);

export const stockItems = pgTable(
  "stock_items",
  {
    id: serial("id").primaryKey(),
    partId: integer("part_id")
      .notNull()
      .references(() => parts.id),
    locationId: integer("location_id")
      .notNull()
      .references(() => locations.id),
    quantity: integer("quantity").notNull().default(0),
  },
  (t) => [
    uniqueIndex("stock_part_location_uq").on(t.partId, t.locationId),
    index("stock_part_idx").on(t.partId),
  ],
);

export const inventoryTxns = pgTable(
  "inventory_txns",
  {
    id: serial("id").primaryKey(),
    partId: integer("part_id")
      .notNull()
      .references(() => parts.id),
    locationId: integer("location_id").references(() => locations.id),
    delta: integer("delta").notNull(), // + added, - removed
    reason: text("reason").notNull().default(""), // receive | build | adjust | ...
    ref: text("ref").notNull().default(""),
    actor: text("actor").notNull().default(""), // who did it (no accounts, but useful)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("txn_part_idx").on(t.partId), index("txn_created_idx").on(t.createdAt)],
);

export const boards = pgTable(
  "boards",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    fusionDocId: text("fusion_doc_id"),
    revision: text("revision").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("boards_fusion_doc_idx").on(t.fusionDocId)],
);

export const bomLines = pgTable(
  "bom_lines",
  {
    id: serial("id").primaryKey(),
    boardId: integer("board_id")
      .notNull()
      .references(() => boards.id),
    value: text("value").notNull().default(""),
    package: text("package").notNull().default(""),
    designators: text("designators").notNull().default(""), // comma-separated refdes
    qtyPerBoard: integer("qty_per_board").notNull().default(1),
    partMpn: text("part_mpn"),
    matchedPartId: integer("matched_part_id").references(() => parts.id),
  },
  (t) => [index("bom_board_idx").on(t.boardId), index("bom_mpn_idx").on(t.partMpn)],
);

export const builds = pgTable(
  "builds",
  {
    id: serial("id").primaryKey(),
    boardId: integer("board_id")
      .notNull()
      .references(() => boards.id),
    quantity: integer("quantity").notNull().default(1),
    status: text("status").notNull().default("planned"), // planned | completed | cancelled
    notes: text("notes").notNull().default(""),
    actor: text("actor").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("builds_board_idx").on(t.boardId)],
);

export const buildConsumptions = pgTable(
  "build_consumptions",
  {
    id: serial("id").primaryKey(),
    buildId: integer("build_id")
      .notNull()
      .references(() => builds.id),
    partId: integer("part_id")
      .notNull()
      .references(() => parts.id),
    locationId: integer("location_id").references(() => locations.id),
    quantity: integer("quantity").notNull().default(0),
  },
  (t) => [index("bc_build_idx").on(t.buildId)],
);
