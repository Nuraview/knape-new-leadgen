// Volume / tier pricing for proposal line items.
// A tier = { minQty, unitPrice }. The effective unit price for a given quantity
// is the tier with the HIGHEST minQty that is <= qty; below the smallest tier
// (or with no tiers) the line's base unitPrice applies.

export interface PriceTier {
  minQty: number;
  unitPrice: number;
}

export function tierUnitPrice(
  baseUnit: number,
  qty: number,
  tiers?: PriceTier[] | null,
): number {
  if (!Array.isArray(tiers) || tiers.length === 0) return baseUnit;
  let price = baseUnit;
  let bestMin = -1;
  for (const t of tiers) {
    const min = Number(t?.minQty);
    const up = Number(t?.unitPrice);
    if (!Number.isFinite(min) || !Number.isFinite(up)) continue;
    if (qty >= min && min > bestMin) {
      bestMin = min;
      price = up;
    }
  }
  return price;
}

/** Normalize + sort tiers for storage/display (drop blanks, ascending). */
export function normalizeTiers(tiers?: PriceTier[] | null): PriceTier[] {
  if (!Array.isArray(tiers)) return [];
  return tiers
    .map((t) => ({ minQty: Number(t?.minQty), unitPrice: Number(t?.unitPrice) }))
    .filter((t) => Number.isFinite(t.minQty) && t.minQty > 0 && Number.isFinite(t.unitPrice) && t.unitPrice >= 0)
    .sort((a, b) => a.minQty - b.minQty);
}
