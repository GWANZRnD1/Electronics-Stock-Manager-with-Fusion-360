/**
 * Drizzle schema. Indexes are chosen so stock lookups stay fast on large
 * datasets: lookups by MPN (parts), summed on-hand per part (stock_items by
 * part_id), and BOM rows by board. Change stock only by appending an
 * inventory_txns row; keep stock_items.quantity as the materialized sum.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  numeric,
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
    mpn: text("mpn").notNull().default(""), // manufacturer part number; may be blank for generics
    manufacturer: text("manufacturer").notNull().default(""),
    name: text("name").notNull().default(""), // human label, e.g. "RES 47 OHM 1% 0603"
    category: text("category").notNull().default(""), // e.g. "Resistor", "Capacitor", "IC"
    package: text("package").notNull().default(""), // size/footprint, e.g. "0603", "SOIC-14", "TH"
    description: text("description").notNull().default(""),
    supplier: text("supplier").notNull().default(""), // e.g. "DigiKey", "LCSC", "Jellybean"
    spn: text("spn").notNull().default(""), // supplier part number (e.g. DigiKey part number)
    value: text("value").notNull().default(""), // component value, e.g. "47Ω", "0.1µF", "16MHz"
    unitCost: numeric("unit_cost", { precision: 14, scale: 6 }), // per-unit cost; null if unknown
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Partial unique index: real MPNs stay unique, but multiple blank-MPN generics are allowed.
    uniqueIndex("parts_mpn_uq").on(t.mpn).where(sql`${t.mpn} <> ''`),
    index("parts_category_idx").on(t.category),
    index("parts_package_idx").on(t.package),
  ],
);

export const locations = pgTable(
  "locations",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""), // free-form notes for the location
    // ArUco marker id assigned to this physical location (null = none yet). Unique
    // among assigned values so two locations never share a marker.
    aruco: integer("aruco"),
  },
  (t) => [
    uniqueIndex("locations_name_uq").on(t.name),
    uniqueIndex("locations_aruco_uq").on(t.aruco).where(sql`${t.aruco} IS NOT NULL`),
  ],
);

// Simple key/value store for app-wide settings (e.g. the ArUco dictionary + print size).
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
});

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
    // When this part+location count was last physically confirmed (receive/adjust or manual).
    lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }),
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
    // Archived boards collapse out of the main list (kept, not deleted).
    archived: boolean("archived").notNull().default(false),
    // Board outline extents (mm) from the placements export — the coordinate box
    // used to map component (x,y) onto the board image for highlighting. Null
    // until placements are imported.
    outlineMinX: numeric("outline_min_x", { precision: 12, scale: 4 }),
    outlineMinY: numeric("outline_min_y", { precision: 12, scale: 4 }),
    outlineMaxX: numeric("outline_max_x", { precision: 12, scale: 4 }),
    outlineMaxY: numeric("outline_max_y", { precision: 12, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("boards_fusion_doc_idx").on(t.fusionDocId)],
);

// One row per placed component on a board (from extract-placements.ulp). Drives
// the interactive board view: designator + (x,y) mm + side let the app drop a
// highlight marker on the board image. Linked to the BOM by designator/MPN.
export const componentPlacements = pgTable(
  "component_placements",
  {
    id: serial("id").primaryKey(),
    boardId: integer("board_id")
      .notNull()
      .references(() => boards.id),
    designator: text("designator").notNull().default(""), // refdes, e.g. "R1", "U3"
    x: numeric("x", { precision: 12, scale: 4 }).notNull(), // mm, board coordinates
    y: numeric("y", { precision: 12, scale: 4 }).notNull(),
    angle: numeric("angle", { precision: 7, scale: 2 }).notNull().default("0"),
    side: text("side").notNull().default("top"), // "top" | "bottom"
    package: text("package").notNull().default(""),
    mpn: text("mpn"), // manufacturer part number if the element carried one
    // Exact footprint bounding box in board mm (the placed/rotated/mirrored extent
    // from EAGLE's UL_ELEMENT.area). Null for pick-and-place imports (centroid only),
    // in which case the view falls back to a centroid dot.
    bx1: numeric("bx1", { precision: 12, scale: 4 }),
    by1: numeric("by1", { precision: 12, scale: 4 }),
    bx2: numeric("bx2", { precision: 12, scale: 4 }),
    by2: numeric("by2", { precision: 12, scale: 4 }),
  },
  (t) => [index("placements_board_idx").on(t.boardId)],
);

// Uploaded board pictures (one per side). The bytes live in a Supabase Storage
// bucket; this table holds the object path + pixel dimensions (needed to map mm
// -> pixels) and an optional manual calibration override (two reference points).
export const boardImages = pgTable(
  "board_images",
  {
    id: serial("id").primaryKey(),
    boardId: integer("board_id")
      .notNull()
      .references(() => boards.id),
    side: text("side").notNull(), // "top" | "bottom"
    storagePath: text("storage_path").notNull(), // object key within the bucket
    mime: text("mime").notNull().default("image/png"),
    width: integer("width").notNull().default(0),
    height: integer("height").notNull().default(0),
    // Optional 2-point calibration JSON to override the auto-crop alignment when
    // an export has margins: [{frac:{x,y}, mm:{x,y}}, {frac:{x,y}, mm:{x,y}}].
    calibration: text("calibration"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("board_images_board_side_uq").on(t.boardId, t.side)],
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
