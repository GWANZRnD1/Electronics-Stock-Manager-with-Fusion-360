import { NextResponse } from "next/server";

import { isForeignKeyViolation, isUniqueViolation, uniqueViolationConstraint } from "@/lib/http";
import {
  deleteLocation,
  getLocation,
  locationRefCounts,
  updateLocation,
} from "@/lib/repo/inventory";
import { updateLocationSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function parseId(params: Promise<{ id: string }>): Promise<number | null> {
  const id = Number((await params).id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Edit a location's name, notes, or assigned ArUco id (`aruco: null` clears it). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = await parseId(params);
  if (id === null) return NextResponse.json({ error: "invalid location id" }, { status: 400 });
  if (!(await getLocation(id))) {
    return NextResponse.json({ error: "location not found" }, { status: 404 });
  }
  const parsed = updateLocationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  try {
    return NextResponse.json(await updateLocation(id, parsed.data));
  } catch (e) {
    if (isUniqueViolation(e)) {
      const which = uniqueViolationConstraint(e)?.includes("aruco") ? "ArUco id" : "name";
      return NextResponse.json({ error: `location ${which} already in use` }, { status: 409 });
    }
    throw e;
  }
}

/** Delete a location, but only once nothing (stock or history) references it. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = await parseId(params);
  if (id === null) return NextResponse.json({ error: "invalid location id" }, { status: 400 });
  if (!(await getLocation(id))) {
    return NextResponse.json({ error: "location not found" }, { status: 404 });
  }
  const refs = await locationRefCounts(id);
  if (refs.total > 0) {
    return NextResponse.json(
      {
        error: `Can't delete: this location is still referenced by ${refs.stock} stock item(s) and ${refs.txns + refs.consumptions} history record(s). Move or clear them first.`,
      },
      { status: 409 },
    );
  }
  try {
    await deleteLocation(id);
  } catch (e) {
    if (isForeignKeyViolation(e)) {
      return NextResponse.json({ error: "location is still in use" }, { status: 409 });
    }
    throw e;
  }
  return NextResponse.json({ ok: true });
}
