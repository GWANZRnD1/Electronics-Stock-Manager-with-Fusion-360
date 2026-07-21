import { NextResponse } from "next/server";

import { isForeignKeyViolation } from "@/lib/http";
import {
  addStockLocation,
  getPartStock,
  removeStockLocation,
  setStockQuantity,
} from "@/lib/repo/inventory";
import { addStockLocationSchema, adjustStockSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const boardIdParam = new URL(request.url).searchParams.get("boardId");
  const boardId = boardIdParam ? Number(boardIdParam) : undefined;
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid part id" }, { status: 400 });
  }
  if (boardId !== undefined && (!Number.isInteger(boardId) || boardId <= 0)) {
    return NextResponse.json({ error: "invalid board id" }, { status: 400 });
  }
  return NextResponse.json(await getPartStock(id, boardId));
}

// Assign a catalog part to a location with an optional zero starting count.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid part id" }, { status: 400 });
  }
  const parsed = addStockLocationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  try {
    const result = await addStockLocation(id, parsed.data.locationId, parsed.data.quantity);
    if (!result) {
      return NextResponse.json({ error: "part is already assigned to that location" }, { status: 409 });
    }
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    if (isForeignKeyViolation(e)) {
      return NextResponse.json({ error: "part or location not found" }, { status: 404 });
    }
    throw e;
  }
}

// Set an existing part+location count to an absolute quantity (inline stock edit).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid part id" }, { status: 400 });
  }
  const parsed = adjustStockSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const result = await setStockQuantity(id, parsed.data.locationId, parsed.data.quantity);
  if (!result) {
    return NextResponse.json({ error: "stock not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}

// Remove a part/location assignment, balancing any remaining count to zero.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const locationId = Number(new URL(request.url).searchParams.get("locationId"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid part id" }, { status: 400 });
  }
  if (!Number.isInteger(locationId) || locationId <= 0) {
    return NextResponse.json({ error: "invalid location id" }, { status: 400 });
  }
  const result = await removeStockLocation(id, locationId);
  if (!result) {
    return NextResponse.json({ error: "stock entry not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}
