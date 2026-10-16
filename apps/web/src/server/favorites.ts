import { and, count, customer, db, desc, eq, favorite, inArray, product, store } from "@qvashop/db";
import { MAX_FAVORITES } from "@/lib/favorites";
import { ensureCustomer } from "./customer-accounts";

// A signed-in shopper's favorite products on a store. Like customer-accounts.ts this runs for
// visitors of a public store: the store is an active one, tenant_id is read from the rows here
// and never leaves this file. A favorite belongs to the company's customer record of the
// account; the list of a store only holds that store's products (composite FK).

export type AddFavoriteResult = { ok: true } | { ok: false; error: "notFound" | "limitReached" };

/** Product ids the account marked on this store, newest first. */
export async function listFavoriteIds(storeId: string, userId: string): Promise<string[]> {
  const rows = await db
    .select({ productId: favorite.productId })
    .from(favorite)
    .innerJoin(customer, and(eq(customer.id, favorite.customerId), eq(customer.tenantId, favorite.tenantId)))
    .where(and(eq(favorite.storeId, storeId), eq(customer.userId, userId)))
    .orderBy(desc(favorite.createdAt))
    .limit(MAX_FAVORITES);
  return rows.map((row) => row.productId);
}

/**
 * Marks a product of this store as a favorite (already marked = ok). Only public products
 * (active, in an active store) can be added; another store's product id is `notFound`.
 */
export async function addFavorite(
  storeId: string,
  account: { id: string; name: string; email: string },
  productId: string,
): Promise<AddFavoriteResult> {
  const [target] = await db
    .select({ tenantId: product.tenantId })
    .from(product)
    .innerJoin(store, and(eq(store.id, product.storeId), eq(store.tenantId, product.tenantId)))
    .where(
      and(eq(product.id, productId), eq(product.storeId, storeId), eq(product.status, "active"), eq(store.status, "active")),
    )
    .limit(1);
  if (!target) return { ok: false, error: "notFound" };
  const owner = await ensureCustomer(storeId, account);
  if (!owner) return { ok: false, error: "notFound" };

  return db.transaction(async (tx) => {
    // Serializes this customer's adds, so concurrent clicks cannot pass the limit
    await tx.select({ id: customer.id }).from(customer).where(eq(customer.id, owner.id)).for("update");
    const where = and(eq(favorite.customerId, owner.id), eq(favorite.storeId, storeId));
    const [existing] = await tx
      .select({ productId: favorite.productId })
      .from(favorite)
      .where(and(where, eq(favorite.productId, productId)))
      .limit(1);
    if (existing) return { ok: true } as const;
    const [{ total }] = await tx.select({ total: count() }).from(favorite).where(where);
    if (total >= MAX_FAVORITES) return { ok: false, error: "limitReached" } as const;
    await tx
      .insert(favorite)
      .values({ tenantId: target.tenantId, storeId, customerId: owner.id, productId })
      .onConflictDoNothing();
    return { ok: true } as const;
  });
}

/** Removes a favorite of the account on this store (missing = nothing to do). */
export async function removeFavorite(storeId: string, userId: string, productId: string): Promise<void> {
  await db
    .delete(favorite)
    .where(
      and(
        eq(favorite.storeId, storeId),
        eq(favorite.productId, productId),
        inArray(favorite.customerId, db.select({ id: customer.id }).from(customer).where(eq(customer.userId, userId))),
      ),
    );
}
