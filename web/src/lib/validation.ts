/** Zod schemas validating request bodies at the API boundary. */
import { z } from "zod";

export const createPartSchema = z.object({
  mpn: z.string().trim().min(1).max(128),
  manufacturer: z.string().trim().max(128).optional(),
  description: z.string().trim().max(512).optional(),
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
