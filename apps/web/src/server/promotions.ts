import {
  and,
  asc,
  db,
  desc,
  eq,
  inArray,
  isNull,
  priceList,
  product,
  productVariant,
  sql,
  variantPrice,
} from "@qvashop/db";
import type { PromotionInput } from "@/lib/validation/promotion";

// Promotions = price lists of a store (merchant side). Every function takes the scope from
// requireMerchant() and filters by tenant AND store. Their prices are variant_price rows with
// price_list_id set and min_quantity 1; they apply only while the list is active and inside its
// dates (loadPriceRows + resolvePrice).

type Scope = { tenantId: string; storeId: string };

const listInScope = ({ tenantId, storeId }: Scope) =>
  and(eq(priceList.tenantId, tenantId), eq(priceList.storeId, storeId));

/** All promotions of the store, newest first, with how many products/variants they cover. */
export async function listPromotions(scope: Scope) {
  return db
    .select({
      id: priceList.id,
      name: priceList.name,
      kind: priceList.kind,
      status: priceList.status,
      startsAt: priceList.startsAt,
      endsAt: priceList.endsAt,
      productCount: sql<number>`count(distinct ${productVariant.productId})::int`,
      variantCount: sql<number>`count(distinct ${variantPrice.variantId})::int`,
    })
    .from(priceList)
    .leftJoin(variantPrice, and(eq(variantPrice.priceListId, priceList.id), eq(variantPrice.tenantId, priceList.tenantId)))
    .leftJoin(productVariant, and(eq(productVariant.id, variantPrice.variantId), eq(productVariant.tenantId, variantPrice.tenantId)))
    .where(listInScope(scope))
    .groupBy(priceList.id)
    .orderBy(desc(priceList.createdAt));
}

/** One promotion and its prices, or null when it is not this store's. */
export async function getPromotion(scope: Scope, id: string) {
  const [row] = await db
    .select({
      id: priceList.id,
      name: priceList.name,
      kind: priceList.kind,
      status: priceList.status,
      startsAt: priceList.startsAt,
      endsAt: priceList.endsAt,
    })
    .from(priceList)
    .where(and(listInScope(scope), eq(priceList.id, id)));
  if (!row) return null;
  const prices = await db
    .select({ variantId: variantPrice.variantId, currencyCode: variantPrice.currencyCode, amountMinor: variantPrice.amountMinor })
    .from(variantPrice)
    .where(and(eq(variantPrice.priceListId, id), eq(variantPrice.tenantId, scope.tenantId), eq(variantPrice.minQuantity, 1)));
  return { ...row, prices };
}

export type PromotableProduct = {
  id: string;
  name: string;
  status: string;
  variants: { id: string; title: string | null; regular: Record<string, number> }[];
};

/**
 * Products of the store with each variant's regular price for 1 unit per currency (the form
 * shows it next to the promotion price). Archived ones are included so a promotion that already
 * has them keeps their rows; the form only offers draft and active products to add.
 */
export async function listPromotableProducts(scope: Scope): Promise<PromotableProduct[]> {
  const products = await db
    .select({ id: product.id, name: product.name, status: product.status })
    .from(product)
    .where(and(eq(product.tenantId, scope.tenantId), eq(product.storeId, scope.storeId)))
    .orderBy(asc(product.name));
  if (products.length === 0) return [];

  const variants = await db
    .select({ id: productVariant.id, productId: productVariant.productId, title: productVariant.title })
    .from(productVariant)
    .where(and(eq(productVariant.tenantId, scope.tenantId), eq(productVariant.storeId, scope.storeId)))
    .orderBy(asc(productVariant.position), asc(productVariant.createdAt));
  const prices = await db
    .select({ variantId: variantPrice.variantId, currencyCode: variantPrice.currencyCode, amountMinor: variantPrice.amountMinor })
    .from(variantPrice)
    .where(
      and(
        eq(variantPrice.tenantId, scope.tenantId),
        eq(variantPrice.storeId, scope.storeId),
        isNull(variantPrice.priceListId),
        eq(variantPrice.minQuantity, 1),
      ),
    );

  const regularOf = new Map<string, Record<string, number>>();
  for (const p of prices) regularOf.set(p.variantId, { ...regularOf.get(p.variantId), [p.currencyCode]: p.amountMinor });
  return products.map((p) => ({
    ...p,
    variants: variants
      .filter((v) => v.productId === p.id)
      .map((v) => ({ id: v.id, title: v.title, regular: regularOf.get(v.id) ?? {} })),
  }));
}

export type SavePromotionResult =
  | { ok: true; id: string }
  | { ok: false; error: "notFound" | "stale" }
  | { ok: false; error: "notCheaper"; rows: { variantId: string; currencyCode: string }[] };

/**
 * Creates (id null) or updates a promotion and replaces its prices. Every price must be for a
 * variant of this store that has a regular price in that currency (otherwise `stale`: the
 * form is out of date), and a "sale" price must be lower than the regular price, or it
 * would never apply (`notCheaper`, with the offending rows).
 */
export async function savePromotion(scope: Scope, id: string | null, input: PromotionInput): Promise<SavePromotionResult> {
  return db.transaction(async (tx) => {
    if (id) {
      const [locked] = await tx.select({ id: priceList.id }).from(priceList).where(and(listInScope(scope), eq(priceList.id, id))).for("update");
      if (!locked) return { ok: false, error: "notFound" } as const;
    }

    const variantIds = [...new Set(input.prices.map((p) => p.variantId))];
    const regular = variantIds.length
      ? await tx
          .select({ variantId: variantPrice.variantId, currencyCode: variantPrice.currencyCode, amountMinor: variantPrice.amountMinor })
          .from(variantPrice)
          .where(
            and(
              eq(variantPrice.tenantId, scope.tenantId),
              eq(variantPrice.storeId, scope.storeId),
              inArray(variantPrice.variantId, variantIds),
              isNull(variantPrice.priceListId),
              eq(variantPrice.minQuantity, 1),
            ),
          )
      : [];
    const regularOf = new Map(regular.map((r) => [`${r.variantId}:${r.currencyCode}`, r.amountMinor]));
    const notCheaper: { variantId: string; currencyCode: string }[] = [];
    for (const price of input.prices) {
      const base = regularOf.get(`${price.variantId}:${price.currencyCode}`);
      // regular rows only exist for this store's variants: anything else is not ours / outdated
      if (base === undefined) return { ok: false, error: "stale" } as const;
      if (input.kind === "sale" && price.amountMinor >= base) notCheaper.push(price);
    }
    if (notCheaper.length) {
      return {
        ok: false,
        error: "notCheaper",
        rows: notCheaper.map(({ variantId, currencyCode }) => ({ variantId, currencyCode })),
      } as const;
    }

    const fields = {
      name: input.name,
      kind: input.kind,
      status: input.status,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    };
    let listId = id;
    if (listId) {
      await tx.update(priceList).set(fields).where(and(listInScope(scope), eq(priceList.id, listId)));
      await tx.delete(variantPrice).where(and(eq(variantPrice.priceListId, listId), eq(variantPrice.tenantId, scope.tenantId)));
    } else {
      const [created] = await tx.insert(priceList).values({ ...scope, ...fields }).returning({ id: priceList.id });
      listId = created.id;
    }
    if (input.prices.length) {
      await tx.insert(variantPrice).values(
        input.prices.map((price) => ({ ...scope, ...price, minQuantity: 1, priceListId: listId })),
      );
    }
    return { ok: true, id: listId } as const;
  });
}

/** Switches a promotion on (active: applies inside its dates) or off (draft). */
export async function setPromotionStatus(scope: Scope, id: string, status: "draft" | "active") {
  const rows = await db
    .update(priceList)
    .set({ status })
    .where(and(listInScope(scope), eq(priceList.id, id)))
    .returning({ id: priceList.id });
  return rows.length === 1;
}

/** Deletes a promotion; its prices go with it (FK cascade). Regular prices are untouched. */
export async function deletePromotion(scope: Scope, id: string) {
  const rows = await db.delete(priceList).where(and(listInScope(scope), eq(priceList.id, id))).returning({ id: priceList.id });
  return rows.length === 1;
}
