/** App-wide settings, stored as key/value rows in `app_settings`. */
import { eq } from "drizzle-orm";

import { ARUCO_DICT_NAMES, type ArucoDictName } from "@/lib/aruco/marker";
import { getDb } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";

async function getRaw(key: string): Promise<string | null> {
  const [row] = await getDb().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key));
  return row?.value ?? null;
}

async function setRaw(key: string, value: string): Promise<void> {
  await getDb()
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

export interface ArucoConfig {
  dict: ArucoDictName; // which ArUco dictionary all location markers belong to
  sizeMm: number; // default printed marker size (the black square), in millimetres
}

const ARUCO_KEY = "aruco";
export const DEFAULT_ARUCO: ArucoConfig = { dict: "6X6_250", sizeMm: 25 };

/** Read the ArUco config, falling back to defaults for missing/invalid values. */
export async function getArucoConfig(): Promise<ArucoConfig> {
  const raw = await getRaw(ARUCO_KEY);
  if (!raw) return DEFAULT_ARUCO;
  try {
    const p = JSON.parse(raw) as Partial<ArucoConfig>;
    const dict = ARUCO_DICT_NAMES.includes(p.dict as ArucoDictName)
      ? (p.dict as ArucoDictName)
      : DEFAULT_ARUCO.dict;
    const sizeMm = typeof p.sizeMm === "number" && p.sizeMm > 0 ? p.sizeMm : DEFAULT_ARUCO.sizeMm;
    return { dict, sizeMm };
  } catch {
    return DEFAULT_ARUCO;
  }
}

export async function setArucoConfig(cfg: ArucoConfig): Promise<void> {
  await setRaw(ARUCO_KEY, JSON.stringify(cfg));
}

export type PreferredPurchaseSupplier = "digikey" | "lcsc";

export interface PurchaseConfig {
  preferredSupplier: PreferredPurchaseSupplier;
  priceDifferenceThresholdPercent: number;
  normallyStockingOnly: boolean;
  excludeMarketplace: boolean;
  inStockOnly: boolean;
  minimumBoardCount: number;
  bulkOrderQuantities: number[];
  inexpensiveLineLimitUsd: number;
  takeNoExtraCostBreaks: boolean;
}

const PURCHASE_KEY = "purchasing";
export const DEFAULT_PURCHASE_CONFIG: PurchaseConfig = {
  preferredSupplier: "digikey",
  priceDifferenceThresholdPercent: 10,
  normallyStockingOnly: true,
  excludeMarketplace: true,
  inStockOnly: true,
  minimumBoardCount: 3,
  bulkOrderQuantities: [25, 50, 100],
  inexpensiveLineLimitUsd: 2,
  takeNoExtraCostBreaks: true,
};

/** Purchasing comparison/filter preferences with safe defaults for old DBs. */
export async function getPurchaseConfig(): Promise<PurchaseConfig> {
  const raw = await getRaw(PURCHASE_KEY);
  if (!raw) return DEFAULT_PURCHASE_CONFIG;
  try {
    const parsed = JSON.parse(raw) as Partial<PurchaseConfig>;
    return {
      preferredSupplier:
        parsed.preferredSupplier === "lcsc" ? "lcsc" : DEFAULT_PURCHASE_CONFIG.preferredSupplier,
      priceDifferenceThresholdPercent:
        typeof parsed.priceDifferenceThresholdPercent === "number" &&
        parsed.priceDifferenceThresholdPercent >= 0 &&
        parsed.priceDifferenceThresholdPercent <= 100
          ? parsed.priceDifferenceThresholdPercent
          : DEFAULT_PURCHASE_CONFIG.priceDifferenceThresholdPercent,
      normallyStockingOnly:
        typeof parsed.normallyStockingOnly === "boolean"
          ? parsed.normallyStockingOnly
          : DEFAULT_PURCHASE_CONFIG.normallyStockingOnly,
      excludeMarketplace:
        typeof parsed.excludeMarketplace === "boolean"
          ? parsed.excludeMarketplace
          : DEFAULT_PURCHASE_CONFIG.excludeMarketplace,
      inStockOnly:
        typeof parsed.inStockOnly === "boolean"
          ? parsed.inStockOnly
          : DEFAULT_PURCHASE_CONFIG.inStockOnly,
      minimumBoardCount:
        Number.isInteger(parsed.minimumBoardCount) &&
        parsed.minimumBoardCount! >= 1 &&
        parsed.minimumBoardCount! <= 100
          ? parsed.minimumBoardCount!
          : DEFAULT_PURCHASE_CONFIG.minimumBoardCount,
      bulkOrderQuantities:
        Array.isArray(parsed.bulkOrderQuantities) &&
        parsed.bulkOrderQuantities.length <= 10 &&
        parsed.bulkOrderQuantities.every(
          (quantity) => Number.isInteger(quantity) && quantity >= 1 && quantity <= 1_000_000,
        )
          ? [...new Set(parsed.bulkOrderQuantities)].sort((a, b) => a - b)
          : DEFAULT_PURCHASE_CONFIG.bulkOrderQuantities,
      inexpensiveLineLimitUsd:
        typeof parsed.inexpensiveLineLimitUsd === "number" &&
        parsed.inexpensiveLineLimitUsd >= 0 &&
        parsed.inexpensiveLineLimitUsd <= 10_000
          ? parsed.inexpensiveLineLimitUsd
          : DEFAULT_PURCHASE_CONFIG.inexpensiveLineLimitUsd,
      takeNoExtraCostBreaks:
        typeof parsed.takeNoExtraCostBreaks === "boolean"
          ? parsed.takeNoExtraCostBreaks
          : DEFAULT_PURCHASE_CONFIG.takeNoExtraCostBreaks,
    };
  } catch {
    return DEFAULT_PURCHASE_CONFIG;
  }
}

export async function setPurchaseConfig(config: PurchaseConfig): Promise<void> {
  await setRaw(PURCHASE_KEY, JSON.stringify(config));
}
