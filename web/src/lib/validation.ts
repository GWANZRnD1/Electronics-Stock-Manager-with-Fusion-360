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
