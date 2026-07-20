import { NextResponse } from "next/server";
import { z } from "zod";

import { lookupPart } from "@/lib/distributors";
import { getBoard } from "@/lib/repo/boards";
import { identifyBoardPart } from "@/lib/repo/jellybeans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const identifySchema = z.object({
  identifiers: z.array(z.string().trim().min(1).max(512)).min(1).max(4),
});

/** Resolve a scanned real label to exact or compatible jellybean BOM lines. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const boardId = Number((await params).id);
  if (!Number.isInteger(boardId)) {
    return NextResponse.json({ error: "invalid board id" }, { status: 400 });
  }
  if (!(await getBoard(boardId))) {
    return NextResponse.json({ error: "board not found" }, { status: 404 });
  }
  const parsed = identifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const identifiers = [...new Set(parsed.data.identifiers)];
  let matches = await identifyBoardPart(boardId, identifiers);
  let lookedUp = false;

  // If the label's real MPN has never been imported, use live distributor
  // parametric data to identify its generic value/package on this board.
  if (matches.length === 0) {
    try {
      const lookup = await lookupPart(identifiers[0]);
      const offer = lookup.offers.find(
        (candidate) =>
          !candidate.mock &&
          Boolean(candidate.category || candidate.value || candidate.package),
      );
      if (offer) {
        lookedUp = true;
        matches = await identifyBoardPart(boardId, identifiers, {
          mpn: offer.mpn,
          spn: offer.distributorPartNumber,
          value: offer.value,
          package: offer.package,
          category: offer.category,
          description: offer.description,
        });
      }
    } catch {
      // Identification remains useful from local stock even when a distributor
      // API is unavailable or rate-limited.
    }
  }

  return NextResponse.json({ matches, lookedUp });
}
