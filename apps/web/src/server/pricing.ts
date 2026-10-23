import { cache } from "react";
import { and, db, eq, inArray, isNull, or, priceList, sql, variantPrice } from "@qvashop/db";
import { pricesIn } from "@/lib/exchange";
import type { PriceRow } from "@/lib/pricing";
import { getStoreCurrencies, type StoreCurrency } from "./currencies";
import { storeFeatures } from "./subscriptions";

/** The store's currencies (with base and rates), read once per request. */
export const storeCurrencies = cache(
  async (storeId: string): Promise<StoreCurrency[]> => (await getStoreCurrencies([storeId])).get(storeId) ?? [],
);

/** Target currency + the base it converts from (both null when the store does not sell in it). */
async function fxPair(storeId: string, currencyCode: string) {
  const currencies = await storeCurrencies(storeId);
  const target = currencies.find((c) => c.code === currencyCode);
  if (!target) return null;
  return { target, base: currencies.find((c) => c.isBase) ?? target };
}

/**
 * Price rows of some variants of ONE store in ONE currency, ready for resolvePrice():
 * regular prices plus the prices of price lists that are active right now (status active and
 * inside their dates). Promotions in draft or outside their dates are left out here, and all
 * of them when the company's plan does not include promotions (the rows are kept).
 * Rows the variant has no manual prices for in this currency are converted from the base
 * currency at the store's rate (src/lib/exchange.ts).
 */
export async function loadPriceRows(
  storeId: string,
  variantIds: string[],
  currencyCode: string,
): Promise<Map<string, PriceRow[]>> {
  const result = new Map<string, PriceRow[]>();
  if (variantIds.length === 0) return result;
  const fx = await fxPair(storeId, currencyCode);
  if (!fx) return result;
  const codes = fx.target.rate !== null && fx.base.code !== fx.target.code ? [fx.target.code, fx.base.code] : [fx.target.code];
  const promotions = (await storeFeatures(storeId)).includes("promotions");

  const rows = await db
    .select({
      variantId: variantPrice.variantId,
      currencyCode: variantPrice.currencyCode,
      amountMinor: variantPrice.amountMinor,
      compareAtMinor: variantPrice.compareAtMinor,
      minQuantity: variantPrice.minQuantity,
      priceListId: variantPrice.priceListId,
      priceListKind: priceList.kind,
    })
    .from(variantPrice)
    .leftJoin(
      priceList,
      and(eq(priceList.id, variantPrice.priceListId), eq(priceList.tenantId, variantPrice.tenantId)),
    )
    .where(
      and(
        eq(variantPrice.storeId, storeId),
        inArray(variantPrice.currencyCode, codes),
        inArray(variantPrice.variantId, variantIds),
        promotions
          ? or(
              isNull(variantPrice.priceListId),
              and(
                eq(priceList.status, "active"),
                sql`(${priceList.startsAt} is null or ${priceList.startsAt} <= now())`,
                sql`(${priceList.endsAt} is null or ${priceList.endsAt} > now())`,
              ),
            )
          : isNull(variantPrice.priceListId),
      ),
    );

  const byVariant = new Map<string, typeof rows>();
  for (const row of rows) byVariant.set(row.variantId, [...(byVariant.get(row.variantId) ?? []), row]);
  for (const [variantId, own] of byVariant) {
    result.set(
      variantId,
      pricesIn(own, fx.target, fx.base).map((row) => ({
        amountMinor: row.amountMinor,
        compareAtMinor: row.compareAtMinor,
        minQuantity: row.minQuantity,
        priceListId: row.priceListId,
        priceListKind: row.priceListId ? (row.priceListKind as "sale" | "override") : null,
      })),
    );
  }
  return result;
}

/** A variant's regular price for 1 unit in one currency, and whether it follows the rate. */
export type RegularPrice = { amountMinor: number; compareAtMinor: number | null; auto: boolean };

/**
 * Regular prices for 1 unit of some variants in EVERY currency of the store (merchant side:
 * the products table and the promotions form): variant id -> currency code -> price. A
 * currency is missing when the variant is not sold in it (no manual price and no rate).
 */
export async function loadRegularPrices(
  scope: { tenantId: string; storeId: string },
  variantIds: string[],
): Promise<Map<string, Map<string, RegularPrice>>> {
  const result = new Map<string, Map<string, RegularPrice>>();
  if (variantIds.length === 0) return result;
  const currencies = await storeCurrencies(scope.storeId);
  const base = currencies.find((c) => c.isBase);

  const rows = await db
    .select({
      variantId: variantPrice.variantId,
      currencyCode: variantPrice.currencyCode,
      amountMinor: variantPrice.amountMinor,
      compareAtMinor: variantPrice.compareAtMinor,
      minQuantity: variantPrice.minQuantity,
      priceListId: variantPrice.priceListId,
    })
    .from(variantPrice)
    .where(
      and(
        eq(variantPrice.tenantId, scope.tenantId),
        eq(variantPrice.storeId, scope.storeId),
        inArray(variantPrice.variantId, variantIds),
        isNull(variantPrice.priceListId),
        eq(variantPrice.minQuantity, 1),
      ),
    );

  const byVariant = new Map<string, typeof rows>();
  for (const row of rows) byVariant.set(row.variantId, [...(byVariant.get(row.variantId) ?? []), row]);
  for (const [variantId, own] of byVariant) {
    const prices = new Map<string, RegularPrice>();
    for (const target of currencies) {
      const [row] = pricesIn(own, target, base ?? target);
      if (row) prices.set(target.code, { amountMinor: row.amountMinor, compareAtMinor: row.compareAtMinor, auto: row.auto });
    }
    result.set(variantId, prices);
  }
  return result;
}
