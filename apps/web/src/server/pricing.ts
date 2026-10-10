import { and, db, eq, inArray, isNull, or, priceList, sql, variantPrice } from "@qvashop/db";
import type { PriceRow } from "@/lib/pricing";

/**
 * Price rows of some variants of ONE store in ONE currency, ready for resolvePrice():
 * regular prices plus the prices of price lists that are active right now (status active and
 * inside their dates). Promotions in draft or outside their dates are left out here.
 */
export async function loadPriceRows(
  storeId: string,
  variantIds: string[],
  currencyCode: string,
): Promise<Map<string, PriceRow[]>> {
  const result = new Map<string, PriceRow[]>();
  if (variantIds.length === 0) return result;

  const rows = await db
    .select({
      variantId: variantPrice.variantId,
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
        eq(variantPrice.currencyCode, currencyCode),
        inArray(variantPrice.variantId, variantIds),
        or(
          isNull(variantPrice.priceListId),
          and(
            eq(priceList.status, "active"),
            sql`(${priceList.startsAt} is null or ${priceList.startsAt} <= now())`,
            sql`(${priceList.endsAt} is null or ${priceList.endsAt} > now())`,
          ),
        ),
      ),
    );

  for (const row of rows) {
    const list = result.get(row.variantId) ?? [];
    list.push({
      amountMinor: row.amountMinor,
      compareAtMinor: row.compareAtMinor,
      minQuantity: row.minQuantity,
      priceListId: row.priceListId,
      priceListKind: row.priceListId ? (row.priceListKind as "sale" | "override") : null,
    });
    result.set(row.variantId, list);
  }
  return result;
}
