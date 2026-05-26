/** Given a BOM and a target board count, compute per-part shortage. Pure, no I/O. */

export interface BomLine {
  partKey: string; // canonical key (e.g. MPN or internal id) used to look up stock
  qtyPerBoard: number;
  reference?: string; // display label (value/designators)
}

export interface ShortageLine {
  partKey: string;
  qtyPerBoard: number;
  required: number;
  available: number;
  shortage: number;
  reference: string;
}

export interface ShortageReport {
  boardCount: number;
  lines: ShortageLine[];
}

export type StockMap = Record<string, number> | Map<string, number>;

function readStock(stock: StockMap, key: string): number {
  if (stock instanceof Map) return stock.get(key) ?? 0;
  return stock[key] ?? 0;
}

export function computeShortage(
  bom: BomLine[],
  boardCount: number,
  stock: StockMap,
): ShortageReport {
  if (boardCount < 0) throw new Error("boardCount must be >= 0");

  const perBoard = new Map<string, number>();
  const references = new Map<string, string>();
  for (const line of bom) {
    if (line.qtyPerBoard < 0) {
      throw new Error(`qtyPerBoard must be >= 0 for ${line.partKey}`);
    }
    perBoard.set(line.partKey, (perBoard.get(line.partKey) ?? 0) + line.qtyPerBoard);
    if (line.reference && !references.has(line.partKey)) {
      references.set(line.partKey, line.reference);
    }
  }

  const lines: ShortageLine[] = [];
  for (const partKey of [...perBoard.keys()].sort()) {
    const qtyPerBoard = perBoard.get(partKey)!;
    const required = qtyPerBoard * boardCount;
    const available = Math.max(0, readStock(stock, partKey));
    lines.push({
      partKey,
      qtyPerBoard,
      required,
      available,
      shortage: Math.max(0, required - available),
      reference: references.get(partKey) ?? "",
    });
  }
  return { boardCount, lines };
}

export function shortages(report: ShortageReport): ShortageLine[] {
  return report.lines.filter((line) => line.shortage > 0);
}

export function hasShortage(report: ShortageReport): boolean {
  return report.lines.some((line) => line.shortage > 0);
}

/** How many whole boards current stock supports (0 if any required part is absent). */
export function maxBuildable(report: ShortageReport): number {
  const caps = report.lines
    .filter((line) => line.qtyPerBoard > 0)
    .map((line) => Math.floor(line.available / line.qtyPerBoard));
  return caps.length ? Math.min(...caps) : 0;
}
