import { and, db, eq, inArray, isNull, productVariant, sql, variantPrice } from "@qvashop/db";
import { MAX_PRICE_MINOR } from "@/lib/money";
import { getStoreCurrencies } from "./currencies";

// Bulk price changes from the products table (merchant side). Each one is a single SQL
// statement over the regular prices (tiers and "was" prices included; promotions are left
// alone) of the chosen products in ONE currency, scoped by tenant AND store.

type Scope = { tenantId: string; storeId: string };

/** Ids of the variants of these products, as a subquery limited to the store. */
const variantsOf = (scope: Scope, productIds: string[]) =>
  db
    .select({ id: productVariant.id })
    .from(productVariant)
    .where(
      and(
        eq(productVariant.tenantId, scope.tenantId),
        eq(productVariant.storeId, scope.storeId),
        inArray(productVariant.productId, productIds),
      ),
    );

async function storeCurrency(scope: Scope, code: string) {
  const currencies = (await getStoreCurrencies([scope.storeId])).get(scope.storeId) ?? [];
  return currencies.find((c) => c.code === code) ?? null;
}

export type BulkPricesResult =
  | { ok: true; changed: number }
  | { ok: false; error: "notFound" | "isBase" | "noRate" | "tooHigh" };

/**
 * Removes the manual prices of these products in a currency, so they follow the rate again.
 * Refused for the base currency (it is where prices are typed) and for a currency without a
 * rate (the products would stop being sold in it). `changed` = variants that had manual prices.
 */
export async function setPricesAuto(scope: Scope, productIds: string[], currencyCode: string): Promise<BulkPricesResult> {
  const target = await storeCurrency(scope, currencyCode);
  if (!target) return { ok: false, error: "notFound" };
  if (target.isBase) return { ok: false, error: "isBase" };
  if (target.rate === null) return { ok: false, error: "noRate" };

  const deleted = await db
    .delete(variantPrice)
    .where(
      and(
        eq(variantPrice.tenantId, scope.tenantId),
        eq(variantPrice.storeId, scope.storeId),
        eq(variantPrice.currencyCode, currencyCode),
        isNull(variantPrice.priceListId),
        inArray(variantPrice.variantId, variantsOf(scope, productIds)),
      ),
    )
    .returning({ variantId: variantPrice.variantId });
  return { ok: true, changed: new Set(deleted.map((row) => row.variantId)).size };
}

/** Thrown inside the transaction to undo an adjustment that passed the maximum price. */
class TooHigh extends Error {}

/**
 * Raises or lowers by `basisPoints` / 100 % (see parsePercent) the manual regular prices of these products in a
 * currency (in the base currency: their typed prices, which the automatic ones follow).
 * Results are rounded to the currency's step (a positive price never becomes 0); a "was"
 * price that is no longer higher is dropped. Products that follow the rate in that currency
 * have no rows there and are left as they are. Refused as a whole when a price would pass
 * the maximum. `changed` = variants updated.
 */
export async function adjustPrices(
  scope: Scope,
  productIds: string[],
  currencyCode: string,
  basisPoints: number,
): Promise<BulkPricesResult> {
  const target = await storeCurrency(scope, currencyCode);
  if (!target) return { ok: false, error: "notFound" };
  const step = target.isBase ? 1 : (target.roundingMinor ?? 1);
  const factor = 10_000 + basisPoints;

  const scaled = (column: typeof variantPrice.amountMinor | typeof variantPrice.compareAtMinor) =>
    sql`greatest(
      round(${column}::numeric * ${factor} / 10000 / ${step}) * ${step},
      case when ${column} > 0 then ${step} else 0 end
    )::bigint`;
  const where = and(
    eq(variantPrice.tenantId, scope.tenantId),
    eq(variantPrice.storeId, scope.storeId),
    eq(variantPrice.currencyCode, currencyCode),
    isNull(variantPrice.priceListId),
    inArray(variantPrice.variantId, variantsOf(scope, productIds)),
  );

  return db.transaction(async (tx): Promise<BulkPricesResult> => {
    const updated = await tx
      .update(variantPrice)
      .set({
        amountMinor: scaled(variantPrice.amountMinor),
        compareAtMinor: sql`case when ${scaled(variantPrice.compareAtMinor)} > ${scaled(variantPrice.amountMinor)}
          then ${scaled(variantPrice.compareAtMinor)} else null end`,
      })
      .where(where)
      .returning({ variantId: variantPrice.variantId, amountMinor: variantPrice.amountMinor });
    if (updated.some((row) => row.amountMinor > MAX_PRICE_MINOR)) throw new TooHigh();
    return { ok: true, changed: new Set(updated.map((row) => row.variantId)).size };
  }).catch((error: unknown) => {
    if (error instanceof TooHigh) return { ok: false, error: "tooHigh" } as const;
    throw error;
  });
}
