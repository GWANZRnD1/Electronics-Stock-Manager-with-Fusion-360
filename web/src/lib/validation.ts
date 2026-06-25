/** Zod schemas validating request bodies at the API boundary. */
import { z } from "zod";

const partFieldShape = {
  manufacturer: z.string().trim().max(128).optional(),
  name: z.string().trim().max(256).optional(),
  category: z.string().trim().max(64).optional(),
  package: z.string().trim().max(64).optional(),
  description: z.string().trim().max(512).optional(),
  supplier: z.string().trim().max(64).optional(),
  spn: z.string().trim().max(128).optional(),
  value: z.string().trim().max(64).optional(),
  unitCost: z.number().nonnegative().max(1_000_000).nullable().optional(),
};

export const createPartSchema = z.object({
  mpn: z.string().trim().min(1).max(128),
  ...partFieldShape,
});

export const updatePartSchema = z
  .object({
    mpn: z.string().trim().min(1).max(128).optional(),
    ...partFieldShape,
  })
  .refine((d) => Object.keys(d).length > 0, { message: "no fields to update" });

export const confirmStockSchema = z.object({
  locationId: z.number().int().positive(),
});

export const adjustStockSchema = z.object({
  locationId: z.number().int().positive(),
  quantity: z.number().int().min(0).max(1_000_000),
});

export const purgeSchema = z.object({
  confirm: z.literal("PURGE"),
});

export const syncSchema = z
  .object({
    fillValues: z.boolean().optional(),
    refreshCosts: z.boolean().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    afterId: z.number().int().min(0).optional(),
  })
  .refine((d) => d.fillValues || d.refreshCosts, { message: "select at least one operation" });

// ArUco marker id (0-based). Bounded generously; the real cap is the dictionary
// capacity, enforced server-side. `null` clears the assignment; omitted = auto-assign.
const arucoId = z.number().int().min(0).max(9999);

export const createLocationSchema = z.object({
  name: z.string().trim().min(1).max(64),
  description: z.string().trim().max(256).optional(),
  aruco: arucoId.nullable().optional(),
});

export const updateLocationSchema = z
  .object({
    name: z.string().trim().min(1).max(64).optional(),
    description: z.string().trim().max(256).optional(),
    aruco: arucoId.nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "no fields to update" });

export const assignArucoSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(5000),
});

export const arucoConfigSchema = z.object({
  // Keep in lockstep with ARUCO_DICT_NAMES in lib/aruco/marker.ts.
  dict: z.enum(["4X4_50", "5X5_100", "6X6_250"]),
  sizeMm: z.number().min(5).max(200),
});

export const receiveStockSchema = z.object({
  mpn: z.string().trim().min(1).max(128),
  locationId: z.number().int().positive(),
  quantity: z.number().int().positive().max(1_000_000),
  ref: z.string().trim().max(128).optional(),
  // optional part metadata (auto-read from a scanned label / DigiKey / Mouser)
  manufacturer: z.string().trim().max(128).optional(),
  name: z.string().trim().max(256).optional(),
  category: z.string().trim().max(64).optional(),
  package: z.string().trim().max(64).optional(),
  supplier: z.string().trim().max(64).optional(),
  spn: z.string().trim().max(128).optional(),
});

export const unlockSchema = z.object({
  pin: z.string().min(1).max(128),
});

export const createBoardSchema = z.object({
  name: z.string().trim().min(1).max(128),
  revision: z.string().trim().min(1).max(64), // required: distinguishes revisions of the same board
});

export const updateBoardSchema = z
  .object({
    name: z.string().trim().min(1).max(128).optional(), // renames the whole board family
    revision: z.string().trim().max(64).optional(), // relabels just this revision
    archived: z.boolean().optional(), // archive/unarchive the whole family
  })
  .refine((d) => Object.keys(d).length > 0, { message: "no fields to update" });

export const bomLineInputSchema = z.object({
  partMpn: z.string().trim().max(128).optional().nullable(),
  value: z.string().trim().max(128).optional(),
  package: z.string().trim().max(64).optional(),
  designators: z.string().trim().max(256).optional(),
  qtyPerBoard: z.number().int().min(1).max(100_000),
});

export const replaceBomSchema = z.object({
  lines: z.array(bomLineInputSchema).max(5_000),
});

// MPNs (shortage partKeys) to act on; omitted/empty means "all tracked parts".
const partKeysSchema = z.array(z.string().trim().min(1)).max(5_000).optional();

export const buildSchema = z.object({
  quantity: z.number().int().positive().max(100_000),
  actor: z.string().trim().max(64).optional(),
  parts: partKeysSchema, // consume only these MPNs (all if omitted)
});

export const cancelBuildSchema = z.object({
  actor: z.string().trim().max(64).optional(),
  parts: partKeysSchema, // restore only these MPNs from the last build (all if omitted)
});

export const librarySyncSchema = z.object({
  parts: z
    .array(
      z.object({
        mpn: z.string().trim().min(1).max(128),
        manufacturer: z.string().trim().max(128).optional(),
        description: z.string().trim().max(512).optional(),
      }),
    )
    .max(10_000),
});

export const fusionImportSchema = z.object({
  board: z.object({
    name: z.string().trim().min(1).max(128),
    fusionDocId: z.string().trim().max(256).optional().nullable(),
    revision: z.string().trim().max(64).optional(),
  }),
  lines: z.array(bomLineInputSchema).max(5_000),
});

const sideSchema = z.enum(["top", "bottom"]);

const placementSchema = z.object({
  designator: z.string().trim().max(64).default(""),
  x: z.number(),
  y: z.number(),
  angle: z.number().optional().default(0),
  side: sideSchema.optional().default("top"),
  package: z.string().trim().max(64).optional().default(""),
  mpn: z.string().trim().max(128).optional().nullable(),
  // Exact footprint bounding box (board mm). Present from the ULP (UL_ELEMENT.area);
  // absent from plain pick-and-place files.
  bx1: z.number().optional().nullable(),
  by1: z.number().optional().nullable(),
  bx2: z.number().optional().nullable(),
  by2: z.number().optional().nullable(),
});

const outlineSchema = z.object({
  minX: z.number(),
  minY: z.number(),
  maxX: z.number(),
  maxY: z.number(),
});

export const placementsImportSchema = z.object({
  board: z.object({
    name: z.string().trim().min(1).max(128),
    fusionDocId: z.string().trim().max(256).optional().nullable(),
    revision: z.string().trim().max(64).optional(),
  }),
  outline: outlineSchema,
  placements: z.array(placementSchema).max(20_000),
});

// Combined board import: BOM lines plus (optionally) outline + placements, from
// extract-board.ulp. `outline`/`placements` are optional so plain extract-bom.ulp
// files (BOM only) keep working through the same endpoint.
export const boardImportSchema = z.object({
  board: z.object({
    name: z.string().trim().min(1).max(128),
    fusionDocId: z.string().trim().max(256).optional().nullable(),
    revision: z.string().trim().max(64).optional(),
  }),
  lines: z.array(bomLineInputSchema).max(5_000),
  outline: outlineSchema.optional(),
  placements: z.array(placementSchema).max(20_000).optional(),
});

// A single fractional/mm reference point for manual image calibration.
const calibrationPointSchema = z.object({
  frac: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  mm: z.object({ x: z.number(), y: z.number() }),
});

export const boardImageCalibrationSchema = z.object({
  side: sideSchema,
  // null clears the override (back to auto-crop alignment); else two points.
  calibration: z.tuple([calibrationPointSchema, calibrationPointSchema]).nullable(),
});

export const digikeyBatchSchema = z.object({
  items: z
    .array(
      z.object({
        partNumber: z.string().trim().min(1).max(128),
        quantity: z.number().int().positive().max(1_000_000),
      }),
    )
    .min(1)
    .max(500),
  listName: z.string().trim().max(64).optional(),
});
