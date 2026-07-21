import { describe, expect, it } from "vitest";

import { isProjectLocation, stockLocationOrder } from "./stockRanking";

describe("stock location ranking", () => {
  it("recognises a board/project location despite punctuation", () => {
    expect(isProjectLocation("Solex Controller", "Solex-Controller stock")).toBe(true);
  });

  it("orders project match, verification date, quantity in that priority", () => {
    const rows = [
      { location: "Large stale", quantity: 500, lastConfirmedAt: "2025-01-01", projectLocation: false },
      { location: "Fresh", quantity: 2, lastConfirmedAt: "2026-01-01", projectLocation: false },
      { location: "Project", quantity: 1, lastConfirmedAt: null, projectLocation: true },
    ].sort(stockLocationOrder);
    expect(rows.map((row) => row.location)).toEqual(["Project", "Fresh", "Large stale"]);
  });
});
