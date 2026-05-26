import { NextResponse } from "next/server";

import {
  digikeySearchUrl,
  lcscSearchUrl,
  mouserProductUrl,
} from "@/lib/domain/buyLinks";
import { hasShortage, maxBuildable, type ShortageLine } from "@/lib/domain/shortage";
import { getBoard, getBoardShortage } from "@/lib/repo/boards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A real MPN key (not the synthetic "value|package" / "line-N" used for unmatched lines).
function isMpn(partKey: string): boolean {
  return !partKey.includes("|") && !partKey.startsWith("line-");
}

function buyLinksFor(line: ShortageLine) {
  if (!isMpn(line.partKey)) return null;
  return {
    digikey: digikeySearchUrl(line.partKey),
    mouser: mouserProductUrl(line.partKey),
    lcsc: lcscSearchUrl(line.partKey),
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const boardId = Number((await params).id);
  if (!Number.isInteger(boardId)) {
    return NextResponse.json({ error: "invalid board id" }, { status: 400 });
  }
  if (!(await getBoard(boardId))) {
    return NextResponse.json({ error: "board not found" }, { status: 404 });
  }

  const count = Number(new URL(request.url).searchParams.get("count") ?? "1");
  if (!Number.isInteger(count) || count < 0) {
    return NextResponse.json({ error: "invalid count" }, { status: 400 });
  }

  const report = await getBoardShortage(boardId, count);
  const shortages = report.lines
    .filter((l) => l.shortage > 0)
    .map((l) => ({ ...l, buyLinks: buyLinksFor(l) }));

  return NextResponse.json({
    boardCount: report.boardCount,
    hasShortage: hasShortage(report),
    maxBuildable: maxBuildable(report),
    lines: report.lines,
    shortages,
  });
}
