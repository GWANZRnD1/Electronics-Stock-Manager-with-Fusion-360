import type { PartCandidate } from "./jellybeanQuery";

export type PurchaseSupplier = "digikey" | "lcsc";

export interface PurchaseSelectionConfig {
  preferredSupplier: PurchaseSupplier;
  priceDifferenceThresholdPercent: number;
}

export interface SupplierSelection {
  supplier: PurchaseSupplier;
  chosen: PartCandidate;
  alternative: PartCandidate | null;
  savingsPercent: number;
  reason: "only_available" | "preferred_within_threshold" | "cheaper_over_threshold";
}

function total(candidate: PartCandidate, quantity: number): number {
  return candidate.unitPrice > 0 ? candidate.unitPrice * quantity : Number.POSITIVE_INFINITY;
}

/** Choose between two already-qualified, sufficiently stocked offers. */
export function chooseSupplier(
  digikey: PartCandidate | null,
  lcsc: PartCandidate | null,
  quantity: number,
  config: PurchaseSelectionConfig,
): SupplierSelection | null {
  if (!digikey && !lcsc) return null;
  if (!digikey || !lcsc) {
    const supplier: PurchaseSupplier = digikey ? "digikey" : "lcsc";
    return {
      supplier,
      chosen: (digikey ?? lcsc)!,
      alternative: null,
      savingsPercent: 0,
      reason: "only_available",
    };
  }

  const dkTotal = total(digikey, quantity);
  const lcTotal = total(lcsc, quantity);
  const preferred = config.preferredSupplier === "digikey" ? digikey : lcsc;
  const preferredTotal = config.preferredSupplier === "digikey" ? dkTotal : lcTotal;
  const other = config.preferredSupplier === "digikey" ? lcsc : digikey;
  const otherSupplier: PurchaseSupplier =
    config.preferredSupplier === "digikey" ? "lcsc" : "digikey";
  const otherTotal = config.preferredSupplier === "digikey" ? lcTotal : dkTotal;

  if (!Number.isFinite(preferredTotal) && Number.isFinite(otherTotal)) {
    return {
      supplier: otherSupplier,
      chosen: other,
      alternative: preferred,
      savingsPercent: 100,
      reason: "cheaper_over_threshold",
    };
  }
  if (!Number.isFinite(otherTotal) || otherTotal >= preferredTotal) {
    return {
      supplier: config.preferredSupplier,
      chosen: preferred,
      alternative: other,
      savingsPercent: 0,
      reason: "preferred_within_threshold",
    };
  }

  const savingsPercent =
    preferredTotal > 0 ? ((preferredTotal - otherTotal) / preferredTotal) * 100 : 0;
  if (savingsPercent >= config.priceDifferenceThresholdPercent) {
    return {
      supplier: otherSupplier,
      chosen: other,
      alternative: preferred,
      savingsPercent,
      reason: "cheaper_over_threshold",
    };
  }
  return {
    supplier: config.preferredSupplier,
    chosen: preferred,
    alternative: other,
    savingsPercent,
    reason: "preferred_within_threshold",
  };
}
