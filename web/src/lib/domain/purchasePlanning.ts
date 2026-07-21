import { unitPriceAtQuantity, type PartCandidate } from "./jellybeanQuery";

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

export interface QuantityRecommendation {
  minimumQuantity: number;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  reason: "minimum" | "bulk_under_two_dollars" | "price_break_no_extra_cost";
}

export interface PurchaseQuantityPolicy {
  minimumBoardCount: number;
  bulkOrderQuantities: number[];
  inexpensiveLineLimitUsd: number;
  takeNoExtraCostBreaks: boolean;
}

export const DEFAULT_QUANTITY_POLICY: PurchaseQuantityPolicy = {
  minimumBoardCount: 3,
  bulkOrderQuantities: [25, 50, 100],
  inexpensiveLineLimitUsd: 2,
  takeNoExtraCostBreaks: true,
};

/**
 * Keep a configurable number of boards in reserve, then test the configured
 * price-break quantities. Larger quantities are accepted only below the cheap
 * line limit or, when enabled, when they cost no more than the true minimum.
 */
export function recommendPurchaseQuantity(
  candidate: PartCandidate,
  shortage: number,
  qtyPerBoard: number,
  inStockOnly = true,
  policy: PurchaseQuantityPolicy = DEFAULT_QUANTITY_POLICY,
): QuantityRecommendation {
  const minimumQuantity = Math.max(1, shortage, qtyPerBoard * policy.minimumBoardCount);
  const priceAt = (quantity: number) =>
    unitPriceAtQuantity(candidate.priceBreaks, quantity) || candidate.unitPrice;
  const baseUnitPrice = priceAt(minimumQuantity);
  const baseTotal = baseUnitPrice > 0 ? baseUnitPrice * minimumQuantity : Number.POSITIVE_INFINITY;
  const options = [minimumQuantity, ...policy.bulkOrderQuantities]
    .filter((quantity, index, values) => quantity >= minimumQuantity && values.indexOf(quantity) === index)
    .filter((quantity) => !inStockOnly || candidate.stock >= quantity)
    .sort((a, b) => a - b);

  let quantity = options[0] ?? minimumQuantity;
  let unitPrice = priceAt(quantity);
  let totalPrice = unitPrice > 0 ? unitPrice * quantity : 0;
  for (const option of options.slice(1)) {
    const optionUnitPrice = priceAt(option);
    if (optionUnitPrice <= 0) continue;
    const optionTotal = optionUnitPrice * option;
    const underLineLimit = optionTotal <= policy.inexpensiveLineLimitUsd + 0.000001;
    const noExtraCost =
      policy.takeNoExtraCostBreaks && optionTotal <= baseTotal + 0.000001;
    if (underLineLimit || noExtraCost) {
      quantity = option;
      unitPrice = optionUnitPrice;
      totalPrice = optionTotal;
    }
  }

  return {
    minimumQuantity,
    quantity,
    unitPrice,
    totalPrice,
    reason:
      quantity === minimumQuantity
        ? "minimum"
        : totalPrice <= policy.inexpensiveLineLimitUsd
          ? "bulk_under_two_dollars"
          : "price_break_no_extra_cost",
  };
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
