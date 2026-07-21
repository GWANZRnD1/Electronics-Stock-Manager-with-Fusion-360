import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import { and, eq, gt, lt, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { authSessions, authUsers } from "@/lib/db/schema";

import { checkPin, gateEnabled } from "./gate";

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface CurrentUser {
  id: number | null;
  userKey: string;
  name: string;
  isRoot: boolean;
}

export interface ManagedUser {
  id: number;
  name: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ROOT_USER: CurrentUser = {
  id: null,
  userKey: "root",
  name: "Root",
  isRoot: true,
};

function tokenDigest(token: string): string {
  return createHash("sha256").update(`ecsm-session:v1:${token}`).digest("hex");
}

function derivePin(pin: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pin, salt, 32, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derivePin(pin, salt);
  return `scrypt-v1$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPin(pin: string, encoded: string): Promise<boolean> {
  const [version, saltText, keyText, extra] = encoded.split("$");
  if (version !== "scrypt-v1" || !saltText || !keyText || extra !== undefined) return false;
  try {
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(keyText, "base64url");
    if (salt.length !== 16 || expected.length !== 32) return false;
    const actual = await derivePin(pin, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function publicUser(row: typeof authUsers.$inferSelect): ManagedUser {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function authenticatePin(pin: string): Promise<CurrentUser | null> {
  if (!gateEnabled() || checkPin(pin)) return ROOT_USER;
  const rows = await getDb().select().from(authUsers).where(eq(authUsers.active, true));
  const matches = await Promise.all(rows.map(async (row) => ((await verifyPin(pin, row.pinHash)) ? row : null)));
  const row = matches.find((candidate) => candidate !== null);
  return row
    ? { id: row.id, userKey: `user:${row.id}`, name: row.name, isRoot: false }
    : null;
}

export async function createSession(user: CurrentUser): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(authSessions).where(lt(authSessions.expiresAt, new Date()));
    await tx.insert(authSessions).values({
      tokenHash: tokenDigest(token),
      userId: user.id,
      isRoot: user.isRoot,
      expiresAt,
    });
  });
  return token;
}

export async function sessionForToken(token: string | null | undefined): Promise<CurrentUser | null> {
  if (!gateEnabled()) return ROOT_USER;
  if (!token) return null;
  const [row] = await getDb()
    .select({
      userId: authSessions.userId,
      isRoot: authSessions.isRoot,
      name: authUsers.name,
      active: authUsers.active,
    })
    .from(authSessions)
    .leftJoin(authUsers, eq(authUsers.id, authSessions.userId))
    .where(
      and(
        eq(authSessions.tokenHash, tokenDigest(token)),
        gt(authSessions.expiresAt, new Date()),
      ),
    );
  if (!row) return null;
  if (row.isRoot && row.userId === null) return ROOT_USER;
  if (!row.isRoot && row.userId !== null && row.active && row.name) {
    return {
      id: row.userId,
      userKey: `user:${row.userId}`,
      name: row.name,
      isRoot: false,
    };
  }
  return null;
}

export async function revokeSession(token: string | null | undefined): Promise<void> {
  if (!token || !gateEnabled()) return;
  await getDb().delete(authSessions).where(eq(authSessions.tokenHash, tokenDigest(token)));
}

export async function listManagedUsers(): Promise<ManagedUser[]> {
  const rows = await getDb().select().from(authUsers).orderBy(authUsers.name);
  return rows.map(publicUser);
}

async function pinIsAlreadyUsed(pin: string, rows: (typeof authUsers.$inferSelect)[], exceptId?: number) {
  if (checkPin(pin)) return true;
  const matches = await Promise.all(
    rows.filter((row) => row.id !== exceptId).map((row) => verifyPin(pin, row.pinHash)),
  );
  return matches.some(Boolean);
}

export class DuplicatePinError extends Error {}
export class DuplicateUserNameError extends Error {}
export class UserNotFoundError extends Error {}

/**
 * Serialize credential changes with a transaction-scoped advisory lock. PIN
 * hashes are salted, so this lock is what prevents two simultaneous root tabs
 * from creating the same code before either insert becomes visible.
 */
export async function createManagedUser(name: string, pin: string): Promise<ManagedUser> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(1470183321)`);
    const rows = await tx.select().from(authUsers);
    if (rows.some((row) => row.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0)) {
      throw new DuplicateUserNameError();
    }
    if (await pinIsAlreadyUsed(pin, rows)) throw new DuplicatePinError();
    const [created] = await tx
      .insert(authUsers)
      .values({ name, pinHash: await hashPin(pin) })
      .returning();
    return publicUser(created);
  });
}

export async function updateManagedUser(
  id: number,
  patch: { name?: string; pin?: string; active?: boolean },
): Promise<ManagedUser> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(1470183321)`);
    const rows = await tx.select().from(authUsers);
    const current = rows.find((row) => row.id === id);
    if (!current) throw new UserNotFoundError();
    if (
      patch.name &&
      rows.some(
        (row) =>
          row.id !== id &&
          row.name.localeCompare(patch.name!, undefined, { sensitivity: "accent" }) === 0,
      )
    ) {
      throw new DuplicateUserNameError();
    }
    if (patch.pin && (await pinIsAlreadyUsed(patch.pin, rows, id))) throw new DuplicatePinError();

    const [updated] = await tx
      .update(authUsers)
      .set({
        ...(patch.name ? { name: patch.name } : {}),
        ...(patch.pin ? { pinHash: await hashPin(patch.pin) } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        updatedAt: new Date(),
      })
      .where(eq(authUsers.id, id))
      .returning();

    // A code reset or deactivation takes effect immediately on every device.
    if (patch.pin || patch.active === false) {
      await tx.delete(authSessions).where(eq(authSessions.userId, id));
    }
    return publicUser(updated);
  });
}
