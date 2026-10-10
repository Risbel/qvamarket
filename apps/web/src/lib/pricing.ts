// Price resolution for ONE variant in ONE currency. Pure: the server loads the rows
// (src/server/pricing.ts) and every amount shown or charged comes from here.
//
// Rows:
//  - regular prices: price_list_id null; min_quantity 1 is THE price, higher min_quantity
//    rows are volume tiers ("from 10 units: ...").
//  - promotion prices: rows of price lists that are active right now (the loader filters
//    out drafts and lists outside their dates). They can also have tiers.
// A variant is not sold in a currency unless it has a regular price for 1 unit there.

export type PriceRow = {
  amountMinor: number;
  compareAtMinor: number | null;
  minQuantity: number;
  /** null = regular price; otherwise the (active) price list it belongs to */
  priceListId: string | null;
  priceListKind: "sale" | "override" | null;
};

export type ResolvedPrice = {
  /** price per unit for this quantity */
  unitMinor: number;
  /** "was" price to show struck through, only when higher than unitMinor */
  compareAtMinor: number | null;
  /** a promotion (price list) set the price */
  promotion: boolean;
  /** the tier that applied (1 = regular price, no tier) */
  tierMinQuantity: number;
};

export type VolumeTier = { minQuantity: number; unitMinor: number };

/** The row with the highest min_quantity that the quantity reaches (cheapest on a tie). */
function pick(rows: PriceRow[], quantity: number): PriceRow | undefined {
  return rows
    .filter((row) => row.minQuantity <= quantity)
    .sort((a, b) => b.minQuantity - a.minQuantity || a.amountMinor - b.amountMinor)[0];
}

export function resolvePrice(rows: PriceRow[], quantity: number): ResolvedPrice | null {
  const q = Math.max(1, Math.floor(quantity));
  const regularRows = rows.filter((row) => row.priceListId === null);
  if (!regularRows.some((row) => row.minQuantity === 1)) return null; // not sold in this currency

  const regular = pick(regularRows, q)!;
  const promo = pick(rows.filter((row) => row.priceListId !== null), q);

  // An "override" list always wins; a "sale" only when it is actually cheaper
  const usePromo =
    promo !== undefined &&
    (promo.priceListKind === "override" || promo.amountMinor < regular.amountMinor);

  if (usePromo) {
    const was =
      promo.priceListKind === "sale"
        ? Math.max(regular.amountMinor, regular.compareAtMinor ?? 0)
        : promo.compareAtMinor;
    return {
      unitMinor: promo.amountMinor,
      compareAtMinor: was !== null && was > promo.amountMinor ? was : null,
      promotion: true,
      tierMinQuantity: promo.minQuantity,
    };
  }

  return {
    unitMinor: regular.amountMinor,
    compareAtMinor:
      regular.compareAtMinor !== null && regular.compareAtMinor > regular.amountMinor
        ? regular.compareAtMinor
        : null,
    promotion: false,
    tierMinQuantity: regular.minQuantity,
  };
}

/**
 * The volume tiers a customer can see ("from 10 units: X each"), i.e. the quantities at which
 * the resolved unit price goes down, compared with buying 1 unit.
 */
export function volumeTiers(rows: PriceRow[]): VolumeTier[] {
  const base = resolvePrice(rows, 1);
  if (!base) return [];
  const thresholds = [...new Set(rows.map((row) => row.minQuantity).filter((m) => m > 1))].sort(
    (a, b) => a - b,
  );
  const tiers: VolumeTier[] = [];
  let last = base.unitMinor;
  for (const minQuantity of thresholds) {
    const price = resolvePrice(rows, minQuantity);
    if (price && price.unitMinor < last) {
      tiers.push({ minQuantity, unitMinor: price.unitMinor });
      last = price.unitMinor;
    }
  }
  return tiers;
}
