import { NextResponse } from "next/server";

import { dictCapacity } from "@/lib/aruco/marker";
import { isUniqueViolation, uniqueViolationConstraint } from "@/lib/http";
import { createLocation, listLocations, nextFreeAruco } from "@/lib/repo/inventory";
import { getArucoConfig } from "@/lib/repo/settings";
import { createLocationSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listLocations());
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = createLocationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  // `aruco` omitted → auto-assign the next free id in the active dictionary; an
  // explicit null leaves the location without a marker.
  let aruco = parsed.data.aruco;
  if (aruco === undefined) {
    const { dict } = await getArucoConfig();
    aruco = await nextFreeAruco(dictCapacity(dict));
  }
  try {
    const location = await createLocation({ ...parsed.data, aruco });
    return NextResponse.json(location, { status: 201 });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const which = uniqueViolationConstraint(e)?.includes("aruco") ? "ArUco id" : "name";
      return NextResponse.json({ error: `location ${which} already in use` }, { status: 409 });
    }
    throw e;
  }
}
