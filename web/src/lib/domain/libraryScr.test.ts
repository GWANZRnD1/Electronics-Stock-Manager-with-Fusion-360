import { describe, expect, it } from "vitest";

import { buildApplyScr, type LibraryRow } from "./libraryScr";

function row(over: Partial<LibraryRow> = {}): LibraryRow {
  return {
    deviceset: "0.068_OHMS",
    variant: "0603(1608METRIC)",
    package: "RESC1608X60",
    technology: "0603(1608METRIC)",
    attributes: {},
    ...over,
  };
}

describe("buildApplyScr", () => {
  it("renaming an attribute key sets the new name and deletes the old", () => {
    const baseline = [row({ attributes: { DIGIKEY: "273-ND" } })];
    const edited = [row({ attributes: { SPN: "273-ND" } })];
    const { scr, setCount, deleteCount, blocks } = buildApplyScr(baseline, edited);
    expect([setCount, deleteCount, blocks]).toEqual([1, 1, 1]);
    expect(scr).toContain("ATTRIBUTE SPN '273-ND';");
    expect(scr).toContain("ATTRIBUTE DIGIKEY DELETE;");
    expect(scr).toContain("EDIT '0.068_OHMS.dev';");
    expect(scr).toContain("PACKAGE '0603(1608METRIC)';");
  });

  it("filling a blank attribute is a single set", () => {
    const baseline = [row({ attributes: { MFR: "" } })];
    const edited = [row({ attributes: { MFR: "Ohmite" } })];
    const { setCount, deleteCount, scr } = buildApplyScr(baseline, edited);
    expect([setCount, deleteCount]).toEqual([1, 0]);
    expect(scr).toContain("ATTRIBUTE MFR 'Ohmite';");
  });

  it("no changes produce no blocks", () => {
    const baseline = [row({ attributes: { SPN: "273-ND" } })];
    const edited = [row({ attributes: { SPN: "273-ND" } })];
    expect(buildApplyScr(baseline, edited).blocks).toBe(0);
  });

  it("unnamed variant and technology omit navigation", () => {
    const base = row({ variant: "", technology: "", attributes: { DIGIKEY: "x" } });
    const edited = [row({ variant: "", technology: "", attributes: { SPN: "x" } })];
    const { scr } = buildApplyScr([base], edited);
    expect(scr).not.toContain("PACKAGE");
    expect(scr).not.toContain("TECHNOLOGY");
    expect(scr).toContain("EDIT '0.068_OHMS.dev';");
  });

  it("purge deletes a column entirely, even when empty", () => {
    const baseline = [row({ attributes: { DIGIKEY: "", SPN: "273-ND" } })];
    const edited = [row({ attributes: { DIGIKEY: "", SPN: "273-ND" } })];
    const { scr, deleteCount } = buildApplyScr(baseline, edited, new Set(["DIGIKEY"]));
    expect(deleteCount).toBe(1);
    expect(scr).toContain("ATTRIBUTE DIGIKEY DELETE;");
  });

  it("escapes embedded apostrophes by doubling", () => {
    const edited = [row({ attributes: { MFR: "O'Brien" } })];
    const { scr } = buildApplyScr([row()], edited);
    expect(scr).toContain("ATTRIBUTE MFR 'O''Brien';");
  });
});
