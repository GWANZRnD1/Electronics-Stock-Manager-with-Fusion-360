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

export const purgeSchema = z.object({
  confirm: z.literal("PURGE"),
});

export const createLocationSchema = z.object({
  name: z.string().trim().min(1).max(64),
  description: z.string().trim().max(256).optional(),
});

export const receiveStockSchema = z.object({
  mpn: z.string().trim().min(1).max(128),
  locationId: z.number().int().positive(),
  quantity: z.number().int().positive().max(1_000_000),
  ref: z.string().trim().max(128).optional(),
  // optional part metadata (auto-read from DigiKey/Mouser when receiving)
  manufacturer: z.string().trim().max(128).optional(),
  name: z.string().trim().max(256).optional(),
  category: z.string().trim().max(64).optional(),
  package: z.string().trim().max(64).optional(),
});

export const unlockSchema = z.object({
  pin: z.string().min(1).max(128),
});

export const createBoardSchema = z.object({
  name: z.string().trim().min(1).max(128),
});

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

export const buildSchema = z.object({
  quantity: z.number().int().positive().max(100_000),
  actor: z.string().trim().max(64).optional(),
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
