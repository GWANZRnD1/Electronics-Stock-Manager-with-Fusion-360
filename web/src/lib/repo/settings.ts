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
