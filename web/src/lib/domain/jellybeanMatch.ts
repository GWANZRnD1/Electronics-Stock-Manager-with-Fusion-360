/**
 * Electrical identity matching for generic ("jellybean") resistors and
 * capacitors. Inventory rows often use a descriptive pseudo-MPN while a board
 * BOM uses a different spelling (µ/u, Ohm/Ω, Fusion footprint names), so plain
 * string equality is not enough.
 *
 * Resistance/capacitance value is the primary jellybean identity. A known,
 * different physical package and an under-rated capacitor voltage remain hard
 * blockers. Power, tolerance, dielectric, and missing package/rating metadata
 * affect ranking and produce visible reminders rather than making a scanned
 * part impossible to select.
 */

export type JellybeanKind = "resistor" | "capacitor";

export interface ComponentIdentityInput {
  mpn?: string | null;
  spn?: string | null;
  value?: string | null;
  package?: string | null;
  category?: string | null;
  description?: string | null;
  designators?: string | null;
  supplier?: string | null;
}

export interface ComponentIdentity {
  kind: JellybeanKind | null;
  valueKey: string;
  packageCode: string;
  voltage: number | null;
  dielectric: string;
  tolerance: number | null;
  powerWatts: number | null;
  normalizedMpn: string;
}

export interface JellybeanCompatibility {
  score: number;
  notes: string[];
}

const METRIC_TO_IMPERIAL: Record<string, string> = {
  "0603": "0201",
  "1005": "0402",
  "1608": "0603",
  "2012": "0805",
  "3216": "1206",
  "3225": "1210",
  "3224": "1210",
  "4532": "1812",
  "5025": "2010",
  "6332": "2512",
};

const IMPERIAL_PACKAGES = [
  "0201",
  "0402",
  "0603",
  "0805",
  "1206",
  "1210",
  "1806",
  "1808",
  "1812",
  "2010",
  "2512",
];

function normalizedText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[µμ]/g, "u")
    .replace(/[ΩΩ]/g, " ohm ")
    .replace(/[–—−]/g, "-")
    .toUpperCase();
}

/** Case/unit-insensitive identifier equality (not fuzzy electrical matching). */
export function normalizePartIdentifier(value: string | null | undefined): string {
  return normalizedText(value ?? "")
    .replace(/OHMS/g, "OHM")
    .replace(/[^A-Z0-9.+/%-]/g, "");
}

function finiteKey(value: number): string {
  // SI values involved here are comfortably represented at 12 significant
  // digits. Exponential form avoids floating-point spelling differences.
  return value.toExponential(12);
}

function capacitance(text: string): string {
  const match = text.match(/(\d+(?:\.\d+)?)\s*([PNUM]?)\s*F\b/);
  if (!match) return "";
  const scale: Record<string, number> = { P: 1e-12, N: 1e-9, U: 1e-6, M: 1e-3, "": 1 };
  return `C:${finiteKey(Number(match[1]) * scale[match[2]])}`;
}

function resistance(text: string): string {
  // 4K7 / 1R0 / 2M2 notation.
  const embedded = text.match(/\b(\d+)([RKM])(\d+)\b/);
  if (embedded) {
    const scale = embedded[2] === "R" ? 1 : embedded[2] === "K" ? 1e3 : 1e6;
    return `R:${finiteKey(Number(`${embedded[1]}.${embedded[3]}`) * scale)}`;
  }

  // 10 kOhm, 100 Ohms, 12R.
  const withUnit = text.match(/\b(\d+(?:\.\d+)?)\s*([KMG]?)\s*(?:OHMS?|R)\b/);
  if (withUnit) {
    const scale: Record<string, number> = { "": 1, K: 1e3, M: 1e6, G: 1e9 };
    return `R:${finiteKey(Number(withUnit[1]) * scale[withUnit[2]])}`;
  }

  // Board values are often only "22k"; only call this after the row has been
  // identified as a resistor by its designator/category.
  const shorthand = text.match(/\b(\d+(?:\.\d+)?)\s*([KMG])\b/);
  if (shorthand) {
    const scale: Record<string, number> = { K: 1e3, M: 1e6, G: 1e9 };
    return `R:${finiteKey(Number(shorthand[1]) * scale[shorthand[2]])}`;
  }
  return "";
}

/** Convert Fusion/DigiKey package spellings to an imperial SMD size. */
export function packageCode(...values: Array<string | null | undefined>): string {
  const text = normalizedText(values.filter(Boolean).join(" "));

  // Explicit "(1608 Metric)" and Fusion package names such as RESC1608X60 or
  // CAPC1608X85 are unambiguous and must win over a stray imperial-looking
  // number elsewhere in a description.
  const metricParen = text.match(/\b(0603|1005|1608|2012|3216|3224|3225|4532|5025|6332)\s*METRIC\b/);
  if (metricParen) return METRIC_TO_IMPERIAL[metricParen[1]] ?? "";

  const fusionMetric = text.match(/\b(?:RESC|CAPC)(0603|1005|1608|2012|3216|3224|3225|4532|5025|6332)X/);
  if (fusionMetric) return METRIC_TO_IMPERIAL[fusionMetric[1]] ?? "";

  for (const code of IMPERIAL_PACKAGES) {
    if (new RegExp(`(^|[^0-9])${code}([^0-9]|$)`).test(text)) return code;
  }
  return "";
}

function componentKind(input: ComponentIdentityInput, text: string, pkg: string): JellybeanKind | null {
  const category = normalizedText(input.category ?? "");
  if (category.includes("RESIST")) return "resistor";
  if (category.includes("CAPACIT")) return "capacitor";
  if (/\b(?:VARISTOR|THERMISTOR|FERRITE|INDUCTOR)\b/.test(text)) return null;
  if (/\b(?:RESISTOR|OHMS?|[0-9]R[0-9])\b/.test(text)) return "resistor";
  if (/\b(?:CAPACITOR|[0-9]\s*[PNUM]F)\b/.test(text.replace(/\s+/g, " "))) return "capacitor";

  // Designator inference is limited to standard chip packages so R1/C1-like
  // names on varistors, trimmers, and unusual assemblies are not substituted.
  if (pkg && /(?:^|[\s,])R\d+/i.test(input.designators ?? "")) return "resistor";
  if (pkg && /(?:^|[\s,])C\d+/i.test(input.designators ?? "")) return "capacitor";
  return null;
}

function firstNumber(text: string, re: RegExp): number | null {
  const match = text.match(re);
  return match ? Number(match[1]) : null;
}

export function componentIdentity(input: ComponentIdentityInput): ComponentIdentity {
  const text = normalizedText(
    [input.value, input.mpn, input.description, input.package, input.category].filter(Boolean).join(" "),
  ).replace(/\s+/g, " ");
  const pkg = packageCode(input.package, input.mpn, input.description);
  const kind = componentKind(input, text, pkg);
  const valueKey = kind === "capacitor" ? capacitance(text) : kind === "resistor" ? resistance(text) : "";

  const voltageMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(KV|V)\b/);
  const voltage = voltageMatch
    ? Number(voltageMatch[1]) * (voltageMatch[2] === "KV" ? 1000 : 1)
    : null;
  const dielectric = text.match(/\b(X5R|X7R|X6S|X8R|C0G|NP0|Y5V|Z5U)\b/)?.[1] ?? "";
  const tolerance = firstNumber(text, /(?:±|\+\/-)?\s*(\d+(?:\.\d+)?)\s*%/);
  const fractionalPower = text.match(/\b(\d+)\s*\/\s*(\d+)\s*W\b/);
  const powerWatts = fractionalPower
    ? Number(fractionalPower[1]) / Number(fractionalPower[2])
    : firstNumber(text, /(?<![/\d])(\d+(?:\.\d+)?)\s*W\b/);

  return {
    kind,
    valueKey,
    packageCode: pkg,
    voltage,
    dielectric: dielectric === "NP0" ? "C0G" : dielectric,
    tolerance,
    powerWatts,
    normalizedMpn: normalizePartIdentifier(input.mpn),
  };
}

/**
 * Evaluate a generic substitution. `null` means it crosses a hard electrical
 * or physical boundary. Notes are deliberately user-facing: the assembly view
 * shows them when a looser jellybean is selected.
 */
export function evaluateJellybeanCompatibility(
  wanted: ComponentIdentity,
  candidate: ComponentIdentity,
): JellybeanCompatibility | null {
  if (!wanted.kind || wanted.kind !== candidate.kind) return null;
  if (!wanted.valueKey || wanted.valueKey !== candidate.valueKey) return null;

  let score = 100;
  const notes: string[] = [];

  if (wanted.packageCode && candidate.packageCode) {
    if (wanted.packageCode !== candidate.packageCode) return null;
    score += 30;
  } else if (wanted.packageCode || candidate.packageCode) {
    score -= 10;
    notes.push("Package/footprint could not be confirmed; verify that the part physically fits.");
  }

  if (wanted.kind === "capacitor" && wanted.voltage !== null) {
    if (candidate.voltage === null) {
      score -= 10;
      notes.push(
        `Voltage rating is not recorded; confirm it is at least ${wanted.voltage} V before fitting.`,
      );
    } else {
      if (candidate.voltage < wanted.voltage) return null;
      score += 15;
      if (candidate.voltage > wanted.voltage) {
        score += Math.min(10, Math.round(Math.log2(candidate.voltage / wanted.voltage) * 3));
        notes.push(
          `${candidate.voltage} V stock exceeds the ${wanted.voltage} V BOM requirement; the higher rating is acceptable.`,
        );
      }
    }
  }

  if (wanted.tolerance !== null) {
    if (candidate.tolerance === null) {
      score -= 5;
      notes.push(`Tolerance is not recorded; confirm ±${wanted.tolerance}% is suitable.`);
    } else if (candidate.tolerance <= wanted.tolerance) {
      score += 10;
    } else {
      score -= 5;
      notes.push(
        `Tolerance is ±${candidate.tolerance}% rather than ±${wanted.tolerance}%; confirm the circuit does not require the tighter value.`,
      );
    }
  }

  if (wanted.kind === "resistor" && wanted.powerWatts !== null) {
    if (candidate.powerWatts === null) {
      score -= 5;
      notes.push(
        `Power rating is not recorded; confirm at least ${wanted.powerWatts} W before fitting.`,
      );
    } else if (candidate.powerWatts >= wanted.powerWatts) {
      score += 10;
    } else {
      score -= 10;
      notes.push(
        `Power rating is ${candidate.powerWatts} W rather than ${wanted.powerWatts} W; confirm dissipation is acceptable.`,
      );
    }
  }

  if (wanted.kind === "capacitor" && wanted.dielectric) {
    if (!candidate.dielectric) {
      score -= 5;
      notes.push(
        `Dielectric is not recorded; the BOM calls for ${wanted.dielectric}. Check capacitance and temperature needs.`,
      );
    } else if (wanted.dielectric === candidate.dielectric) {
      score += 15;
    } else {
      notes.push(
        `Dielectric is ${candidate.dielectric} rather than ${wanted.dielectric}; check capacitance and temperature needs.`,
      );
    }
  }

  if (wanted.normalizedMpn && wanted.normalizedMpn === candidate.normalizedMpn) score += 1000;
  return { score, notes };
}

/**
 * Numeric compatibility helper used by ranking and scan matching.
 */
export function jellybeanCompatibilityScore(
  wanted: ComponentIdentity,
  candidate: ComponentIdentity,
): number | null {
  return evaluateJellybeanCompatibility(wanted, candidate)?.score ?? null;
}
