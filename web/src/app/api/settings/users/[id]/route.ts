import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/lib/auth/current";
import {
  DuplicatePinError,
  DuplicateUserNameError,
  updateManagedUser,
  UserNotFoundError,
} from "@/lib/auth/session";

export const runtime = "nodejs";

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(64).optional(),
    pin: z.string().regex(/^\d{4,12}$/).optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "locked" }, { status: 401 });
  if (!actor.isRoot) {
    return NextResponse.json({ error: "root access required" }, { status: 403 });
  }
  const id = Number((await params).id);
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!Number.isInteger(id) || id <= 0 || !parsed.success) {
    return NextResponse.json({ error: "invalid user update" }, { status: 400 });
  }
  try {
    return NextResponse.json({ user: await updateManagedUser(id, parsed.data) });
  } catch (error) {
    if (error instanceof UserNotFoundError) {
      return NextResponse.json({ error: "user not found" }, { status: 404 });
    }
    if (error instanceof DuplicatePinError) {
      return NextResponse.json({ error: "That PIN is already in use." }, { status: 409 });
    }
    if (error instanceof DuplicateUserNameError) {
      return NextResponse.json({ error: "That user name is already in use." }, { status: 409 });
    }
    throw error;
  }
}
