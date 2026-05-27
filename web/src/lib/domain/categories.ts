/**
 * Category bundling. Inventory categories drift in spelling — "Resistor" vs
 * "Resistors", "led" vs "LED" — so we group variants by a normalized key and
 * pick one representative spelling per group for display and filtering. Stored
 * values are left untouched; all bundling happens at read time. The SQL side
 * (see `categoryKeySql` in repo/inventory) must mirror `categoryKey` exactly so
 * a dropdown selection matches every variant in the database.
 */

/**
 * Comparison key: case-insensitive, whitespace-collapsed, reduced to the
 * leading segment, then de-pluralized. The leading-segment step folds the
 * verbose distributor names ("Connectors, Interconnects", "Crystals,
 * Oscillators, Resonators", "RF and Wireless") into the short form a user
 * types ("Connectors", "Crystals", "RF") by cutting at the first separator
 * (comma, slash, "(", " and ", " & ").
 */
export function categoryKey(raw: string): string {
  const head = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .split(/\s*(?:,|\/|\(| and | & )/)[0]
    .trim();
  return head
    .replace(/ies$/, "y") // batteries -> battery
    .replace(/([^s])s$/, "$1"); // resistors -> resistor (keeps "glass", "ICs" -> "ic")
}

/**
 * Pick the representative spelling for a group of variants that share a key.
 * Shortest (cleanest) wins — so the short form users type ("Connectors") beats
 * a distributor's verbose name ("Connectors, Interconnects") even when the
 * verbose one is more common; ties break toward the more frequent, then
 * alphabetical. Preserves the casing the user typed, so acronyms like "IC" or
 * "LED" survive instead of being Title-cased.
 */
export function pickCategoryLabel(variants: { label: string; count: number }[]): string {
  return (
    [...variants].sort(
      (a, b) =>
        a.label.length - b.label.length ||
        b.count - a.count ||
        a.label.localeCompare(b.label),
    )[0]?.label ?? ""
  );
}

/**
 * Reduce raw (label, count) pairs to a `key -> representative label` map plus
 * the sorted list of representative labels (for the filter dropdown / datalist).
 */
export function bundleCategories(rows: { label: string; count: number }[]): {
  byKey: Map<string, string>;
  labels: string[];
} {
  const groups = new Map<string, { label: string; count: number }[]>();
  for (const r of rows) {
    const label = r.label.trim();
    if (!label) continue;
    const key = categoryKey(label);
    const list = groups.get(key) ?? [];
    list.push({ label, count: r.count });
    groups.set(key, list);
  }
  const byKey = new Map<string, string>();
  for (const [key, variants] of groups) byKey.set(key, pickCategoryLabel(variants));
  const labels = [...byKey.values()].sort((a, b) => a.localeCompare(b));
  return { byKey, labels };
}
