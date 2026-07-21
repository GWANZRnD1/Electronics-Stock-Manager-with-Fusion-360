export interface RankedStockLocation {
  location: string;
  quantity: number;
  lastConfirmedAt: Date | string | null;
  projectLocation?: boolean;
}

function locationKey(value: string): string {
  return value.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isProjectLocation(boardName: string, locationName: string): boolean {
  const board = locationKey(boardName);
  const location = locationKey(locationName);
  if (!board || !location) return false;
  return (
    board === location ||
    (Math.min(board.length, location.length) >= 6 &&
      (board.includes(location) || location.includes(board)))
  );
}

function verifiedTime(value: Date | string | null): number {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

/** Project match, then freshest physical verification, then usable quantity. */
export function stockLocationOrder(a: RankedStockLocation, b: RankedStockLocation): number {
  return (
    Number(Boolean(b.projectLocation)) - Number(Boolean(a.projectLocation)) ||
    verifiedTime(b.lastConfirmedAt) - verifiedTime(a.lastConfirmedAt) ||
    b.quantity - a.quantity ||
    a.location.localeCompare(b.location)
  );
}
