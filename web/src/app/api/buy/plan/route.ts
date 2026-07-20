import { NextResponse } from "next/server";
import { z } from "zod";

import { digikeySearchCandidates } from "@/lib/distributors/digikey";
import { lcscSearchCandidates } from "@/lib/distributors/lcsc";
import { formatDigikeyBulkAdd, isJellybeanDescriptor } from "@/lib/domain/buyLinks";
import {
  componentIdentity,
  evaluateJellybeanCompatibility,
  normalizePartIdentifier,
} from "@/lib/domain/jellybeanMatch";
import {
  descriptorToQuery,
  type PartCandidate,
  unitPriceAtQuantity,
} from "@/lib/domain/jellybeanQuery";
import { chooseSupplier } from "@/lib/domain/purchasePlanning";
import { getPurchaseConfig } from "@/lib/repo/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  items: z
    .array(
      z.object({
        partKey: z.string().trim().min(1).max(256),
        reference: z.string().trim().max(256).optional().default(""),
        quantity: z.number().int().positive().max(1_000_000),
      }),
    )
    .min(1)
    .max(200),
});

function prepared(candidate: PartCandidate, quantity: number): PartCandidate {
  return {
    ...candidate,
    unitPrice: unitPriceAtQuantity(candidate.priceBreaks, quantity) || candidate.unitPrice,
  };
}

function availabilityPool(
  candidates: PartCandidate[],
  quantity: number,
  inStockOnly: boolean,
): PartCandidate[] {
  return candidates
    .map((candidate) => prepared(candidate, quantity))
    .filter((candidate) => !inStockOnly || candidate.stock >= quantity);
}

function exactBest(
  partKey: string,
  candidates: PartCandidate[],
  quantity: number,
  inStockOnly: boolean,
): PartCandidate | null {
  const key = normalizePartIdentifier(partKey);
  return (
    availabilityPool(candidates, quantity, inStockOnly)
      .filter(
        (candidate) =>
          normalizePartIdentifier(candidate.mpn) === key ||
          normalizePartIdentifier(candidate.partNumber) === key,
      )
      .sort(
        (a, b) =>
          Number(a.unitPrice <= 0) - Number(b.unitPrice <= 0) ||
          a.unitPrice - b.unitPrice ||
          b.stock - a.stock,
      )[0] ?? null
  );
}

function jellybeanBest(
  descriptor: string,
  reference: string,
  candidates: PartCandidate[],
  quantity: number,
  inStockOnly: boolean,
): PartCandidate | null {
  const query = descriptorToQuery(descriptor);
  const wanted = componentIdentity({
    mpn: descriptor,
    value: descriptor,
    package: descriptor,
    description: descriptor,
    designators: reference,
  });
  const qualified = availabilityPool(candidates, quantity, inStockOnly)
    .map((candidate) => ({
      candidate,
      compatibility: evaluateJellybeanCompatibility(
        wanted,
        componentIdentity({
          mpn: candidate.mpn,
          value: candidate.value,
          package: candidate.packageText,
          description: candidate.description,
          category: candidate.category,
        }),
      ),
    }))
    .filter(
      (
        row,
      ): row is {
        candidate: PartCandidate;
        compatibility: NonNullable<typeof row.compatibility>;
      } => row.compatibility !== null,
    )
    .sort(
      (a, b) =>
        b.compatibility.score - a.compatibility.score ||
        Number(a.candidate.unitPrice <= 0) - Number(b.candidate.unitPrice <= 0) ||
        a.candidate.unitPrice - b.candidate.unitPrice ||
        b.candidate.stock - a.candidate.stock,
    );
  if (qualified.length > 0) return qualified[0].candidate;

  // Descriptors that cannot be fully parsed still require the requested
  // footprint. This fallback never crosses a known package boundary.
  if (wanted.kind && wanted.valueKey) return null;
  const packageCode = query.packageCode.toLowerCase();
  return (
    availabilityPool(candidates, quantity, inStockOnly)
      .filter(
        (candidate) =>
          !packageCode || candidate.packageText.toLowerCase().includes(packageCode),
      )
      .sort(
        (a, b) =>
          Number(a.unitPrice <= 0) - Number(b.unitPrice <= 0) ||
          a.unitPrice - b.unitPrice ||
          b.stock - a.stock,
      )[0] ?? null
  );
}

interface PublicOffer {
  partNumber: string;
  mpn: string;
  manufacturer: string;
  unitPrice: number;
  totalPrice: number;
  stock: number;
  productUrl: string;
}

function publicOffer(candidate: PartCandidate, quantity: number): PublicOffer {
  return {
    partNumber: candidate.partNumber || candidate.mpn,
    mpn: candidate.mpn,
    manufacturer: candidate.manufacturer,
    unitPrice: candidate.unitPrice,
    totalPrice: candidate.unitPrice > 0 ? candidate.unitPrice * quantity : 0,
    stock: candidate.stock,
    productUrl: candidate.productUrl ?? "",
  };
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid purchasing request" }, { status: 400 });
  }
  const config = await getPurchaseConfig();
  const selections: Array<{
    partKey: string;
    reference: string;
    quantity: number;
    jellybean: boolean;
    supplier: "digikey" | "lcsc";
    chosen: PublicOffer;
    alternative: PublicOffer | null;
    savingsPercent: number;
    reason: string;
  }> = [];
  const unresolved: Array<{ partKey: string; quantity: number; reason: string }> = [];
  const errors: Array<{ partKey: string; distributor: string; message: string }> = [];

  // Deliberately sequential across BOM lines to respect both distributors'
  // quotas; each line searches DigiKey and LCSC concurrently.
  for (const item of parsed.data.items) {
    const descriptor = item.partKey.replace(/\|/g, " ").trim();
    const jellybean = isJellybeanDescriptor(`${descriptor} ${item.reference}`);
    const query = jellybean ? descriptorToQuery(descriptor).keywords : item.partKey;
    const [dkResult, lcscResult] = await Promise.allSettled([
      digikeySearchCandidates(query, 20, {
        quantity: item.quantity,
        inStockOnly: config.inStockOnly,
        excludeMarketplace: config.excludeMarketplace,
        normallyStockingOnly: config.normallyStockingOnly,
      }),
      lcscSearchCandidates(query, {
        quantity: item.quantity,
        exact: !jellybean,
        inStockOnly: config.inStockOnly,
        excludeMarketplace: config.excludeMarketplace,
      }),
    ]);
    const dkCandidates = dkResult.status === "fulfilled" ? dkResult.value : [];
    const lcscCandidates = lcscResult.status === "fulfilled" ? lcscResult.value : [];
    if (dkResult.status === "rejected") {
      errors.push({
        partKey: item.partKey,
        distributor: "DigiKey",
        message: dkResult.reason instanceof Error ? dkResult.reason.message : String(dkResult.reason),
      });
    }
    if (lcscResult.status === "rejected") {
      errors.push({
        partKey: item.partKey,
        distributor: "LCSC",
        message:
          lcscResult.reason instanceof Error ? lcscResult.reason.message : String(lcscResult.reason),
      });
    }

    const dk = jellybean
      ? jellybeanBest(descriptor, item.reference, dkCandidates, item.quantity, config.inStockOnly)
      : exactBest(item.partKey, dkCandidates, item.quantity, config.inStockOnly);
    const lcsc = jellybean
      ? jellybeanBest(descriptor, item.reference, lcscCandidates, item.quantity, config.inStockOnly)
      : exactBest(item.partKey, lcscCandidates, item.quantity, config.inStockOnly);
    const selected = chooseSupplier(dk, lcsc, item.quantity, config);
    if (!selected) {
      unresolved.push({
        partKey: item.partKey,
        quantity: item.quantity,
        reason:
          dkResult.status === "rejected" || lcscResult.status === "rejected"
            ? "Distributor lookup failed"
            : "No qualified in-stock match",
      });
      continue;
    }
    selections.push({
      partKey: item.partKey,
      reference: item.reference,
      quantity: item.quantity,
      jellybean,
      supplier: selected.supplier,
      chosen: publicOffer(selected.chosen, item.quantity),
      alternative: selected.alternative
        ? publicOffer(selected.alternative, item.quantity)
        : null,
      savingsPercent: selected.savingsPercent,
      reason: selected.reason,
    });
  }

  const supplierItems = (supplier: "digikey" | "lcsc") => {
    const totals = new Map<string, { partNumber: string; quantity: number }>();
    for (const selection of selections.filter((row) => row.supplier === supplier)) {
      const key = normalizePartIdentifier(selection.chosen.partNumber);
      const current = totals.get(key);
      if (current) current.quantity += selection.quantity;
      else {
        totals.set(key, {
          partNumber: selection.chosen.partNumber,
          quantity: selection.quantity,
        });
      }
    }
    return [...totals.values()];
  };
  const digikeyItems = supplierItems("digikey");
  const lcscItems = supplierItems("lcsc");

  return NextResponse.json({
    config,
    selections,
    unresolved,
    errors,
    digikeyItems,
    lcscItems,
    digikeyBulkAdd: formatDigikeyBulkAdd(digikeyItems),
    // Kept in the same easy-to-read quantity,part,reference layout. LCSC
    // C-numbers are also returned structurally for future cart API integration.
    lcscBulkAdd: formatDigikeyBulkAdd(lcscItems),
  });
}
