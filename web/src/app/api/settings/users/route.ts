import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/lib/auth/current";
import {
  createManagedUser,
  DuplicatePinError,
  DuplicateUserNameError,
  listManagedUsers,
} from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1).max(64),
  pin: z.string().regex(/^\d{4,12}$/),
});

async function requireRoot() {
  const user = await currentUser();
  if (!user) return { response: NextResponse.json({ error: "locked" }, { status: 401 }) };
  if (!user.isRoot) {
    return { response: NextResponse.json({ error: "root access required" }, { status: 403 }) };
  }
  return { user };
}

export async function GET() {
  const auth = await requireRoot();
  if ("response" in auth) return auth.response;
  return NextResponse.json({ users: await listManagedUsers() });
}

export async function POST(request: Request) {
  const auth = await requireRoot();
  if ("response" in auth) return auth.response;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter a name and a unique 4–12 digit PIN." },
      { status: 400 },
    );
  }
  try {
    const user = await createManagedUser(parsed.data.name, parsed.data.pin);
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicatePinError) {
      return NextResponse.json({ error: "That PIN is already in use." }, { status: 409 });
    }
    if (error instanceof DuplicateUserNameError) {
      return NextResponse.json({ error: "That user name is already in use." }, { status: 409 });
    }
    throw error;
  }
}
