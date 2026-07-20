/**
 * Stock-aware BOM resolution for generic resistors/capacitors.
 *
 * A board may call a part "0.1 uF 50V X7R 0603", inventory may call it
 * "0.1 µF 50V X7R 0603", and the reel label may contain a real manufacturer
 * MPN. This repository joins those identities, preferring stock in the board's
 * own project location and returning other locations as pick suggestions.
 */
import { eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { boards, bomLines, locations, parts, stockItems } from "@/lib/db/schema";
import {
  componentIdentity,
  type ComponentIdentity,
  type ComponentIdentityInput,
  evaluateJellybeanCompatibility,
  jellybeanCompatibilityScore,
  normalizePartIdentifier,
} from "@/lib/domain/jellybeanMatch";

export interface StockLocationSuggestion {
  locationId: number;
  location: string;
  quantity: number;
  projectLocation: boolean;
}

export interface ResolvedInventoryPart {
  id: number;
  mpn: string;
  manufacturer: string;
  name: string;
  category: string;
  package: string;
  description: string;
  supplier: string;
  spn: string;
  value: string;
  unitCost: string | null;
  onHand: number;
  projectQuantity: number;
  stockLocations: StockLocationSuggestion[];
}

export type BomMatchType = "explicit" | "exact" | "compatible" | "unmatched";

export interface ResolvedBomLine {
  id: number;
  boardId: number;
  value: string;
  package: string;
  designators: string;
  qtyPerBoard: number;
  partMpn: string | null;
  matchedPartId: number | null;
  matchType: BomMatchType;
  resolvedPart: ResolvedInventoryPart | null;
  alternatives: ResolvedInventoryPart[];
  matchNotes: string[];
}

interface Candidate extends ResolvedInventoryPart {
  identity: ComponentIdentity;
}

function publicCandidate(candidate: Candidate): ResolvedInventoryPart {
  return Object.fromEntries(
    Object.entries(candidate).filter(([field]) => field !== "identity"),
  ) as unknown as ResolvedInventoryPart;
}

function locationKey(value: string): string {
  return value.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isProjectLocation(boardName: string, locationName: string): boolean {
  const board = locationKey(boardName);
  const location = locationKey(locationName);
  if (!board || !location) return false;
  return (
    board === location ||
    (Math.min(board.length, location.length) >= 6 &&
      (board.includes(location) || location.includes(board)))
  );
}

async function inventoryCandidates(boardName: string): Promise<Candidate[]> {
  const db = getDb();
  const [partRows, stockRows] = await Promise.all([
    db.select().from(parts),
    db
      .select({
        partId: stockItems.partId,
        locationId: locations.id,
        location: locations.name,
        quantity: stockItems.quantity,
      })
      .from(stockItems)
      .innerJoin(locations, eq(locations.id, stockItems.locationId))
      .where(sql`${stockItems.quantity} > 0`),
  ]);

  const stockByPart = new Map<number, StockLocationSuggestion[]>();
  for (const row of stockRows) {
    const list = stockByPart.get(row.partId) ?? [];
    list.push({
      locationId: row.locationId,
      location: row.location,
      quantity: row.quantity,
      projectLocation: isProjectLocation(boardName, row.location),
    });
    stockByPart.set(row.partId, list);
  }

  return partRows.map((part) => {
    const stockLocations = (stockByPart.get(part.id) ?? []).sort(
      (a, b) =>
        Number(b.projectLocation) - Number(a.projectLocation) ||
        b.quantity - a.quantity ||
        a.location.localeCompare(b.location),
    );
    const onHand = stockLocations.reduce((sum, row) => sum + row.quantity, 0);
    const projectQuantity = stockLocations
      .filter((row) => row.projectLocation)
      .reduce((sum, row) => sum + row.quantity, 0);
    return {
      ...part,
      onHand,
      projectQuantity,
      stockLocations,
      identity: componentIdentity(part),
    };
  });
}

function lineIdentity(line: typeof bomLines.$inferSelect): ComponentIdentity {
  return componentIdentity({
    mpn: line.partMpn,
    value: line.value,
    package: line.package,
    designators: line.designators,
  });
}

function candidateOrder(
  wanted: ComponentIdentity,
  a: Candidate,
  b: Candidate,
): number {
  const as = jellybeanCompatibilityScore(wanted, a.identity) ?? -1;
  const bs = jellybeanCompatibilityScore(wanted, b.identity) ?? -1;
  return (
    bs - as ||
    Number(b.onHand > 0) - Number(a.onHand > 0) ||
    b.projectQuantity - a.projectQuantity ||
    b.onHand - a.onHand ||
    a.mpn.localeCompare(b.mpn)
  );
}

function resolveLine(
  line: typeof bomLines.$inferSelect,
  candidates: Candidate[],
): ResolvedBomLine {
  const wanted = lineIdentity(line);
  const wantedMpn = normalizePartIdentifier(line.partMpn);
  const explicit = line.matchedPartId
    ? candidates.find((candidate) => candidate.id === line.matchedPartId)
    : undefined;

  const exact = wantedMpn
    ? candidates
        .filter(
          (candidate) =>
            normalizePartIdentifier(candidate.mpn) === wantedMpn ||
            normalizePartIdentifier(candidate.spn) === wantedMpn,
        )
        .sort((a, b) => b.onHand - a.onHand)
    : [];

  const compatible = candidates
    .filter((candidate) => jellybeanCompatibilityScore(wanted, candidate.identity) !== null)
    .sort((a, b) => candidateOrder(wanted, a, b));
  const compatibleInStock = compatible.filter((candidate) => candidate.onHand > 0);
  const exactInStock = exact.find((candidate) => candidate.onHand > 0);

  let resolvedPart: Candidate | undefined;
  let matchType: BomMatchType = "unmatched";
  if (explicit) {
    resolvedPart = explicit;
    matchType = "explicit";
  } else if (exactInStock) {
    resolvedPart = exactInStock;
    matchType = "exact";
  } else if (compatibleInStock.length > 0) {
    // A stocked, electrically compatible jellybean is more useful than an
    // exact catalog row with zero stock.
    resolvedPart = compatibleInStock[0];
    matchType = wantedMpn === resolvedPart.identity.normalizedMpn ? "exact" : "compatible";
  } else if (exact.length > 0) {
    resolvedPart = exact[0];
    matchType = "exact";
  } else if (compatible.length > 0) {
    resolvedPart = compatible[0];
    matchType = "compatible";
  }

  const alternatives = compatibleInStock
    .filter((candidate) => candidate.id !== resolvedPart?.id)
    .slice(0, 4)
    .map(publicCandidate);
  const publicPart = resolvedPart ? publicCandidate(resolvedPart) : null;
  const matchNotes =
    resolvedPart && matchType === "compatible"
      ? (evaluateJellybeanCompatibility(wanted, resolvedPart.identity)?.notes ?? [])
      : [];

  return {
    ...line,
    matchType,
    resolvedPart: publicPart,
    alternatives,
    matchNotes,
  };
}

export async function resolveBoardBom(boardId: number): Promise<ResolvedBomLine[]> {
  const db = getDb();
  const [board] = await db.select().from(boards).where(eq(boards.id, boardId));
  if (!board) return [];
  const [lines, candidates] = await Promise.all([
    db.select().from(bomLines).where(eq(bomLines.boardId, boardId)).orderBy(bomLines.id),
    inventoryCandidates(board.name),
  ]);
  return lines.map((line) => resolveLine(line, candidates));
}

function identifierMatchesPart(part: ResolvedInventoryPart, identifiers: string[]): boolean {
  const keys = identifiers.map(normalizePartIdentifier).filter(Boolean);
  const direct = [part.mpn, part.spn].map(normalizePartIdentifier);
  if (keys.some((key) => direct.includes(key))) return true;

  // Imported jellybean descriptions commonly retain the real DigiKey and
  // manufacturer part numbers. Only use substring matching for reasonably long
  // scan values so a manual "10k" cannot match every 10 kΩ description.
  const description = normalizePartIdentifier(part.description);
  return keys.some((key) => key.length >= 5 && description.includes(key));
}

export interface BoardIdentificationMatch {
  lineId: number;
  designators: string;
  value: string;
  package: string;
  partMpn: string | null;
  resolvedMpn: string | null;
  matchType: "label" | "electrical";
  matchNotes: string[];
}

/**
 * Resolve a scanned label to board BOM lines. Exact label identifiers are tried
 * first; when a catalog/live lookup supplies electrical metadata, safe
 * jellybean compatibility is used as the fallback.
 */
export async function identifyBoardPart(
  boardId: number,
  identifiers: string[],
  scannedSpec?: ComponentIdentityInput,
): Promise<BoardIdentificationMatch[]> {
  const lines = await resolveBoardBom(boardId);
  const keys = identifiers.map(normalizePartIdentifier).filter(Boolean);

  const exact = lines.filter((line) => {
    const original = normalizePartIdentifier(line.partMpn);
    return (
      (original && keys.includes(original)) ||
      (line.resolvedPart && identifierMatchesPart(line.resolvedPart, identifiers))
    );
  });
  if (exact.length > 0) {
    return exact.map((line) => ({
      lineId: line.id,
      designators: line.designators,
      value: line.value,
      package: line.package,
      partMpn: line.partMpn,
      resolvedMpn: line.resolvedPart?.mpn ?? null,
      matchType: "label",
      matchNotes: [],
    }));
  }

  let identity = scannedSpec ? componentIdentity(scannedSpec) : null;
  if (!identity?.kind) {
    // The scanned real MPN may be a separate catalog row. Reuse its parametric
    // metadata to find the generic BOM line even when that row has no stock.
    const board = await getDb().select().from(boards).where(eq(boards.id, boardId));
    const candidates = await inventoryCandidates(board[0]?.name ?? "");
    const scannedPart = candidates.find((part) => identifierMatchesPart(part, identifiers));
    identity = scannedPart?.identity ?? null;
  }
  if (!identity?.kind) return [];

  return lines.flatMap((line) => {
      const wanted = componentIdentity({
        mpn: line.partMpn,
        value: line.value,
        package: line.package,
        designators: line.designators,
      });
      const compatibility = evaluateJellybeanCompatibility(wanted, identity!);
      if (!compatibility) return [];
      return [{
        lineId: line.id,
        designators: line.designators,
        value: line.value,
        package: line.package,
        partMpn: line.partMpn,
        resolvedMpn: line.resolvedPart?.mpn ?? null,
        matchType: "electrical" as const,
        matchNotes: compatibility.notes,
      }];
    });
}
